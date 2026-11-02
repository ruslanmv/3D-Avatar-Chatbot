/**
 * L1. The avatar loader says "timed out" after a stall, not after a fixed 20 s. Production on
 * 2026-11-02: a 15 MB VRM over a 3 Mbps phone link showed the timeout at 20 s and loaded at 31 s.
 */
const fs = require('fs');
const path = require('path');
const Watch = require('../src/gltf-viewer/AvatarLoadWatch.js');

function clock() {
    let now = 0;
    let next = 1;
    const timers = new Map();
    return {
        setTimeout: (fn, ms) => (timers.set(next, { fn, at: now + ms }), next++),
        clearTimeout: (id) => timers.delete(id),
        advance(ms) {
            const until = now + ms;
            for (;;) {
                const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) break;
                timers.delete(due[0]);
                now = due[1].at;
                due[1].fn();
            }
            now = until;
        },
    };
}

function watch(extra) {
    const c = clock();
    const seen = { text: [], stalls: 0 };
    const w = Watch.create(
        Object.assign(
            {
                stallMs: 20000,
                setTimeout: c.setTimeout,
                clearTimeout: c.clearTimeout,
                onText: (t) => seen.text.push(t),
                onStall: () => seen.stalls++,
            },
            extra
        )
    );
    return { c, seen, w };
}

test('a slow download that keeps arriving is never called timed out', () => {
    const { c, seen, w } = watch();
    w.start();
    const total = 15096320;
    for (let s = 1; s <= 40; s++) {
        c.advance(1000);
        w.progress(Math.min(total, s * 375000), total); // 3 Mbps
    }
    expect(seen.stalls).toBe(0);
    expect(seen.text.at(-1)).toBe('Loading 3D Avatar... 99% (14 of 14 MB)');
});

test('no bytes for the stall window says timed out, once', () => {
    const { c, seen, w } = watch();
    w.start();
    w.progress(1000000, 15000000);
    c.advance(19999);
    expect(seen.stalls).toBe(0);
    c.advance(1);
    expect(seen.stalls).toBe(1);
    c.advance(60000);
    expect(seen.stalls).toBe(1);
});

test('bytes after a stall bring the progress back; stop() silences everything', () => {
    const { c, seen, w } = watch();
    w.start();
    c.advance(20000);
    expect(seen.stalls).toBe(1);
    w.progress(5 * 1048576, 10 * 1048576);
    expect(seen.text.at(-1)).toBe('Loading 3D Avatar... 50% (5.0 of 10 MB)');
    w.stop();
    w.progress(6 * 1048576, 10 * 1048576);
    c.advance(100000);
    expect(seen.text).toHaveLength(1);
    expect(seen.stalls).toBe(1);
});

test('a backstop still answers a load that trickles forever', () => {
    const { c, seen, w } = watch({ maxMs: 60000 });
    w.start();
    for (let s = 0; s < 70; s++) {
        c.advance(1000);
        w.progress(s, 0);
    }
    expect(seen.stalls).toBe(1);
});

test('the text without a known size', () => {
    expect(Watch.progressText(0, 0)).toBe('Loading 3D Avatar...');
    expect(Watch.progressText(3 * 1048576, 0)).toBe('Loading 3D Avatar... 3.0 MB');
});

test('wired in: AvatarManager reports progress, main.js feeds the watch, index.html loads it', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    expect(read('src/gltf-viewer/AvatarManager.js')).toMatch(/this\.loader\.load\(url, resolve, onProgress, reject\)/);
    expect(read('src/gltf-viewer/AvatarManager.js')).toMatch(/'nexus-avatar-progress'/);
    const main = read('src/main.js');
    expect(main).toMatch(/NEXUS_AVATAR_LOAD_WATCH/);
    expect(main).toMatch(/addEventListener\('nexus-avatar-progress'/);
    expect(read('index.html')).toMatch(/<script defer src="src\/gltf-viewer\/AvatarLoadWatch\.js"><\/script>/);
});
