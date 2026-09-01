/**
 * The clip recorder (B24).
 *
 * The acceptance criterion asks for the trim to be proven **before any UI exists**, which is
 * the only order in which "the saved clip is thirty seconds" can be a claim rather than a
 * hope. So this file is written against `ChunkRing` and `Recorder` directly, with no button
 * anywhere in the repository yet, and the ugly cases — jittery timeslices, a short session,
 * a chunk that straddles the boundary — are ordinary tests rather than afterthoughts.
 *
 * The load-bearing one is `the header survives the trim`. Concatenating WebM clusters
 * without the initialisation segment produces a file that is exactly the right size and that
 * no player will open, which is the worst kind of bug to find in a share sheet.
 */

/* global describe, test, expect */

const fs = require('fs');
const path = require('path');

const EventBus = require('../../src/behavior/EventBus.js');
const ClipRecorder = require('../../src/features/clips/ClipRecorder.js');

const ROOT = path.join(__dirname, '..', '..');
const CLIPS_DIR = path.join(ROOT, 'src', 'features', 'clips');

const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** A blob stand-in that remembers what it was made of, so a test can read the trim. */
function blob(label, size = 1000) {
    return { label, size };
}

function ring(seconds) {
    return new ClipRecorder.ChunkRing(seconds === undefined ? {} : { seconds });
}

/** Fill a ring with `count` one-second chunks labelled by their index. */
function fill(r, count, durationMs = 1000) {
    for (let i = 0; i < count; i++) {
        r.push({ blob: blob(`c${i}`, 1000), durationMs, at: i * durationMs });
    }
    return r;
}

const labels = (chunks) => chunks.map((c) => c.blob.label);

// ── the ring, and the trim ───────────────────────────────────────────────────

describe('the ring holds 35 seconds and no more', () => {
    test('it is 35, and a clip is 30', () => {
        expect(ClipRecorder.RING_SECONDS).toBe(35);
        expect(ClipRecorder.CLIP_SECONDS).toBe(30);
    });

    test('a short session keeps everything', () => {
        const r = fill(ring(), 10);
        expect(r.chunks).toHaveLength(10);
        expect(r.dropped).toBe(0);
    });

    test('a long session stays bounded', () => {
        const r = fill(ring(), 600);
        expect(r.durationMs).toBeLessThanOrEqual(35000);
        expect(r.chunks.length).toBeLessThanOrEqual(36);
    });

    test('memory is bounded by time, not by how long you played', () => {
        const short = fill(ring(), 40);
        const long = fill(ring(), 4000);
        expect(long.chunks.length).toBe(short.chunks.length);
    });

    test('the oldest chunks are the ones that go', () => {
        const r = fill(ring(), 40);
        expect(labels(r.chunks)).not.toContain('c0');
        expect(labels(r.chunks)).toContain('c39');
    });
});

describe('the 30 s trim', () => {
    test('a full ring yields thirty seconds', () => {
        const r = fill(ring(), 100);
        const kept = r.window(30);
        const playing = kept.filter((c) => c !== r.header);
        expect(playing.reduce((t, c) => t + c.durationMs, 0)).toBe(30000);
    });

    test('it takes the last thirty seconds, not the first', () => {
        // The interesting thirty seconds are the ones that just happened.
        const r = fill(ring(), 34);
        const kept = labels(r.window(30));
        expect(kept[kept.length - 1]).toBe('c33');
        expect(kept).toContain('c4');
    });

    test('a session shorter than thirty seconds yields what there is', () => {
        const r = fill(ring(), 12);
        const kept = r.window(30);
        expect(kept).toHaveLength(12);
        expect(kept.reduce((t, c) => t + c.durationMs, 0)).toBe(12000);
    });

    test('an empty ring yields nothing rather than throwing', () => {
        expect(ring().window(30)).toEqual([]);
    });

    test('jittery timeslices still make thirty seconds', () => {
        // A browser under load emits a 1400 ms blob and then a 600 ms one. The slack in the
        // ring is what stops the trim coming up short.
        const r = ring();
        const durations = [];
        for (let i = 0; i < 60; i++) durations.push(i % 2 ? 1400 : 600);
        durations.forEach((d, i) => r.push({ blob: blob(`c${i}`), durationMs: d, at: i }));
        const kept = r.window(30);
        const playing = kept.filter((c) => c !== r.header).reduce((t, c) => t + c.durationMs, 0);
        expect(playing).toBeGreaterThanOrEqual(30000);
        expect(playing).toBeLessThan(32000);
    });

    test('a chunk straddling the boundary is kept whole', () => {
        // 30 s ± one chunk. Cutting a cluster in half produces a file that is the right
        // length and unplayable.
        const r = ring();
        for (let i = 0; i < 20; i++) r.push({ blob: blob(`c${i}`), durationMs: 4000, at: i * 4000 });
        const kept = r.window(30);
        const playing = kept.filter((c) => c !== r.header).reduce((t, c) => t + c.durationMs, 0);
        expect(playing % 4000).toBe(0);
        expect(playing).toBeGreaterThanOrEqual(30000);
    });
});

describe('the header survives the trim', () => {
    test('the first blob ever seen is remembered as the header', () => {
        const r = fill(ring(), 3);
        expect(r.header.blob.label).toBe('c0');
    });

    test('and is never evicted, however long the session runs', () => {
        const r = fill(ring(), 500);
        expect(r.header.blob.label).toBe('c0');
        expect(labels(r.chunks)).not.toContain('c0');
    });

    test('a trim from a long session begins with it', () => {
        // Without this the trim is thirty seconds of WebM clusters with no initialisation
        // segment: exactly the right size, and no player on earth will open it.
        const r = fill(ring(), 200);
        expect(labels(r.window(30))[0]).toBe('c0');
    });

    test('and it is not duplicated when it is still inside the window', () => {
        const r = fill(ring(), 10);
        const kept = labels(r.window(30));
        expect(kept.filter((l) => l === 'c0')).toHaveLength(1);
        expect(kept[0]).toBe('c0');
    });

    test('clearing forgets it, so the next session gets its own', () => {
        const r = fill(ring(), 10);
        r.clear();
        expect(r.header).toBeNull();
        fill(r, 3);
        expect(r.header.blob.label).toBe('c0');
    });

    test('the reported duration excludes the header', () => {
        // The header is an initialisation segment; it contributes no playing time, and
        // counting it would report a 31-second clip.
        const rec = recorder();
        for (let i = 0; i < 200; i++) rec.recorder.ondataavailable({ data: blob(`c${i}`, 1000) });
        expect(rec.rec.save().durationMs).toBe(30000);
    });
});

// ── the recorder ─────────────────────────────────────────────────────────────

/** A MediaRecorder stand-in, and a canvas that counts what was drawn on it. */
function recorder({ start = true, captureStream = true } = {}) {
    const bus = new EventBus();
    const saved = [];
    bus.on('clip:saved', (clip) => saved.push(clip));

    const draws = [];
    const source = {
        width: 1280,
        height: 720,
        captureStream: captureStream ? () => ({ addTrack() {}, getTracks: () => [{ stop() {} }] }) : undefined,
    };
    const composite = {
        width: 1280,
        height: 720,
        getContext: () => ({ drawImage: (...args) => draws.push(args) }),
        captureStream: () => ({ addTrack() {}, getTracks: () => [{ stop() {} }] }),
    };

    let impl = null;
    class FakeRecorder {
        static isTypeSupported(type) {
            return type === 'video/webm;codecs=vp9,opus';
        }
        constructor(stream, options) {
            this.stream = stream;
            this.mimeType = options.mimeType;
            this.state = 'inactive';
            impl = this;
        }
        start(timeslice) {
            this.state = 'recording';
            this.timeslice = timeslice;
        }
        stop() {
            this.state = 'inactive';
        }
    }

    const rec = ClipRecorder.attach({
        bus,
        canvas: source,
        makeCanvas: () => composite,
        RecorderImpl: FakeRecorder,
        makeBlob: (parts, type) => ({ parts, type, size: parts.length }),
        now: () => 1000,
    });
    const result = start ? rec.start() : null;
    return {
        bus,
        rec,
        saved,
        draws,
        result,
        get recorder() {
            return impl;
        },
    };
}

describe('starting and stopping', () => {
    test('it starts and picks the best container the browser admits to', () => {
        const r = recorder();
        expect(r.result.ok).toBe(true);
        expect(r.rec.mimeType).toBe('video/webm;codecs=vp9,opus');
        expect(r.recorder.timeslice).toBe(ClipRecorder.TIMESLICE_MS);
    });

    test('a browser with no MediaRecorder costs a feature, not a session', () => {
        const rec = ClipRecorder.attach({ canvas: { width: 2, height: 2 }, RecorderImpl: null });
        expect(rec.start()).toEqual({ ok: false, why: 'this browser has no MediaRecorder' });
    });

    test('a browser that cannot capture a canvas says so', () => {
        const rec = ClipRecorder.attach({
            canvas: { width: 2, height: 2 },
            RecorderImpl: class {},
        });
        expect(rec.start().why).toBe('this browser cannot capture a canvas');
    });

    test('starting twice is refused rather than doubled', () => {
        const r = recorder();
        expect(r.rec.start()).toEqual({ ok: false, why: 'already recording' });
    });

    test('stopping drops the buffer — thirty seconds of a living room does not outlive the session', () => {
        const r = recorder();
        r.recorder.ondataavailable({ data: blob('c0') });
        expect(r.rec.ring.chunks).toHaveLength(1);
        r.rec.stop();
        expect(r.rec.ring.chunks).toHaveLength(0);
        expect(r.rec.ring.header).toBeNull();
    });

    test('detach stops it', () => {
        const r = recorder();
        r.rec.detach();
        expect(r.rec.recording).toBe(false);
    });

    test('an empty data event is ignored', () => {
        const r = recorder();
        r.recorder.ondataavailable({ data: { size: 0 } });
        r.recorder.ondataavailable({});
        expect(r.rec.ring.chunks).toHaveLength(0);
    });
});

describe('the per-frame cost', () => {
    test('a tick is one drawImage and nothing else', () => {
        const r = recorder();
        r.rec.tick();
        expect(r.draws).toHaveLength(1);
        expect(r.rec.frames).toBe(1);
    });

    test('a tick while not recording costs nothing', () => {
        const r = recorder({ start: false });
        expect(r.rec.tick()).toBe(0);
        expect(r.draws).toHaveLength(0);
    });

    test('under 1 ms a frame, best of five', () => {
        // Best-of-N rather than a mean: the floor is what the code costs, and the spread
        // above it is the machine. The real `drawImage` is the browser's cost, not ours;
        // what is measured here is the bookkeeping the recorder adds around it.
        const r = recorder();
        const runs = [];
        for (let run = 0; run < 5; run++) {
            const started = process.hrtime.bigint();
            for (let i = 0; i < 1000; i++) r.rec.tick();
            runs.push(Number(process.hrtime.bigint() - started) / 1e6 / 1000);
        }
        expect(Math.min(...runs)).toBeLessThan(1);
    });

    test('a source that will not copy is reported once, not every frame', () => {
        const r = recorder();
        let warned = 0;
        const original = console.warn;
        console.warn = () => warned++;
        r.rec.context.drawImage = () => {
            throw new Error('tainted');
        };
        try {
            for (let i = 0; i < 100; i++) r.rec.tick();
        } finally {
            console.warn = original;
        }
        expect(warned).toBe(1);
        expect(r.rec.frames).toBe(0);
    });
});

describe('saving', () => {
    test('it returns a blob and announces itself', () => {
        const r = recorder();
        for (let i = 0; i < 40; i++) r.recorder.ondataavailable({ data: blob(`c${i}`) });
        const clip = r.rec.save();
        expect(clip.blob).toBeTruthy();
        expect(clip.mimeType).toBe('video/webm;codecs=vp9,opus');
        expect(r.saved).toHaveLength(1);
    });

    test('the announcement carries no blob — an event bus is not a place to leave video', () => {
        const r = recorder();
        for (let i = 0; i < 5; i++) r.recorder.ondataavailable({ data: blob(`c${i}`) });
        r.rec.save();
        expect(r.saved[0].blob).toBeUndefined();
        expect(r.saved[0].durationMs).toBe(5000);
    });

    test('nothing buffered yields null rather than an empty file', () => {
        expect(recorder().rec.save()).toBeNull();
    });

    test('this batch produces a blob and stops — no filename, no download, no share', () => {
        const source = codeOf(fs.readFileSync(path.join(CLIPS_DIR, 'ClipRecorder.js'), 'utf8'));
        for (const token of ['createObjectURL', 'download', 'navigator.share', 'showSaveFilePicker']) {
            expect(source).not.toContain(token);
        }
        expect(source).toContain('class Recorder');
    });
});

describe('immersive XR is the mirror view, and says so', () => {
    test('by default the source is the canvas', () => {
        expect(recorder().rec.source).toBe('canvas');
    });

    test('in an immersive session it is the mirror', () => {
        const previous = global.window.NEXUS_VIEWER;
        global.window.NEXUS_VIEWER = { xrSupport: { isPresenting: true } };
        try {
            const r = recorder();
            expect(r.rec.source).toBe('mirror');
            for (let i = 0; i < 3; i++) r.recorder.ondataavailable({ data: blob(`c${i}`) });
            expect(r.rec.save().source).toBe('mirror');
        } finally {
            global.window.NEXUS_VIEWER = previous;
        }
    });

    test('both sources are declared, so a consumer can label the clip', () => {
        expect(ClipRecorder.SOURCES).toEqual(['canvas', 'mirror']);
    });

    test('there is no workaround attempted, because there is none', () => {
        // No API hands a page the composited XR frame, on any platform, by design. A file
        // that pretended otherwise would be reaching for something that does not exist.
        const source = codeOf(fs.readFileSync(path.join(CLIPS_DIR, 'ClipRecorder.js'), 'utf8'));
        for (const token of ['XRWebGLLayer', 'getViewerPose', 'readPixels', 'framebuffer']) {
            expect(source).not.toContain(token);
        }
    });
});

// ── zero network, anywhere under src/features/clips ──────────────────────────

describe('nothing under src/features/clips can reach the network', () => {
    /** Every file in the directory, not just the one this batch added. */
    function clipFiles(dir = CLIPS_DIR) {
        const out = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) out.push(...clipFiles(full));
            else if (entry.name.endsWith('.js')) out.push(full);
        }
        return out;
    }

    const FORBIDDEN = [
        'fetch(',
        'XMLHttpRequest',
        'WebSocket',
        'sendBeacon',
        'EventSource',
        'import(',
        'importScripts',
        'require(',
        'axios',
        'https://',
        'http://',
    ];

    test('the directory is not empty, so this is not vacuous', () => {
        expect(clipFiles().length).toBeGreaterThan(0);
    });

    test('no file names anything that could send bytes anywhere', () => {
        for (const file of clipFiles()) {
            const source = codeOf(fs.readFileSync(file, 'utf8'));
            for (const token of FORBIDDEN) {
                expect({ file: path.relative(ROOT, file), token, found: source.includes(token) }).toEqual({
                    file: path.relative(ROOT, file),
                    token,
                    found: false,
                });
            }
        }
    });

    test('the comment stripper does not hide the code from the check', () => {
        for (const file of clipFiles()) {
            expect(codeOf(fs.readFileSync(file, 'utf8')).trim().length).toBeGreaterThan(200);
        }
    });
});
