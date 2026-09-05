/**
 * Meeting (MS19), the eighth activity.
 *
 * Almost none of this batch is new code, so almost none of these tests are about code. They
 * are about three promises the launcher makes on behalf of every activity, and which an
 * eighth one is the easiest place to break.
 *
 * **It cannot obtain a stream.** No `navigator`, no display or user media call, no canvas.
 * A stream comes from a grant and a grant comes from the consent machine —
 * `capture.test.js` proves that structurally by reading every engine file, and this file
 * proves the consequence: the recorder is *handed* streams rather than opening its own.
 *
 * **Exactly the screen and the microphone, after the choice.** Two dialogs, in that order,
 * and none of them before the user has pressed start.
 *
 * **Revoking stops capture inside a frame.** Not eventually, not after the next await. The
 * assertion uses no timers at all, which is the point: if it needed one, the guarantee would
 * be "soon" rather than "now".
 */

/* global describe, test, expect, jest */

const fs = require('fs');
const path = require('path');

const EventBus = require('../../src/behavior/EventBus.js');
const ConsentMachine = require('../../src/features/together/capture/ConsentMachine.js');
const Meeting = require('../../src/features/together/activities/meeting.js');
const TogetherPanel = require('../../src/features/together/ui/TogetherPanel.js');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'behavior.config.json'), 'utf8'));

const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

function track(kind = 'video') {
    return {
        kind,
        stopped: false,
        stop() {
            this.stopped = true;
        },
        addEventListener() {},
        removeEventListener() {},
    };
}

function fakeMedia({ grantDisplay = true, grantUser = true, displayAudio = false } = {}) {
    const calls = [];
    const make = (kind, tracks) => {
        calls.push({ kind });
        return {
            kind,
            getTracks: () => tracks,
            getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
            getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
        };
    };
    const deny = (kind) => {
        calls.push({ kind });
        const error = new Error('no');
        error.name = 'NotAllowedError';
        return Promise.reject(error);
    };
    return {
        calls,
        getDisplayMedia: (constraints) => {
            if (!grantDisplay) return deny('display');
            const tracks = [track('video')];
            if (displayAudio) tracks.push(track('audio'));
            calls.push({ kind: 'display', constraints });
            calls.pop();
            return Promise.resolve(make('display', tracks));
        },
        getUserMedia: (constraints) => {
            if (!grantUser) return deny('user');
            const stream = make('user', [track('audio')]);
            // Recorded so a test can tell a microphone request from a camera one: both go
            // through getUserMedia, and only the constraints say which.
            calls[calls.length - 1].constraints = constraints;
            return Promise.resolve(stream);
        },
    };
}

/** A stand-in for HomePilot's addon: it records what it was handed and never asks for it. */
function fakeRecorder({ ok = true } = {}) {
    return {
        started: [],
        stopped: 0,
        muted: null,
        async startWithStreams(streams, options) {
            this.started.push({ streams, options });
            return ok
                ? { ok: true, meetingId: 'meet-1', audioMode: 'system+mic' }
                : { ok: false, error: 'no audio source was granted' };
        },
        async stop() {
            this.stopped++;
            return { ok: true };
        },
        muteMic(muted) {
            this.muted = muted;
            return muted;
        },
    };
}

function rig(options = {}) {
    const bus = new EventBus({});
    const media = fakeMedia(options);
    const consent = new ConsentMachine.Machine({ media, config: CONFIG });
    const recorder = fakeRecorder(options);
    const events = [];
    bus.on('meeting:phase', (e) => events.push(e));
    const activity = Meeting.attach({ bus, consent, recorder, config: CONFIG });
    return { bus, media, consent, recorder, activity, events };
}

// ── it cannot obtain a stream ───────────────────────────────────────────────

describe('the activity has no way to start capture itself', () => {
    test('it names no media API and no navigator', () => {
        // The same structural check `capture.test.js` runs over the engine, spelled out for
        // this file: a recorder that opened its own screen share from inside the launcher
        // would be a second consent story for the same screen.
        const source = codeOf(fs.readFileSync(path.join(ROOT, 'src/features/together/activities/meeting.js'), 'utf8'));
        for (const forbidden of ['navigator', 'mediaDevices', 'getDisplayMedia', 'getUserMedia', 'canvas']) {
            expect(`${forbidden}: ${source.includes(forbidden)}`).toBe(`${forbidden}: false`);
        }
    });

    test('the recorder is handed the grant’s streams rather than opening its own', async () => {
        const { activity, recorder, consent } = rig();
        await activity.start({ conversationId: 'c1' });
        const handed = recorder.started[0].streams;
        expect(handed.screen).toBe(consent.grant.streams[0]);
        expect(handed.mic).toBe(consent.grant.streams[1]);
    });
});

// ── exactly screen and mic, after the choice ────────────────────────────────

describe('what it asks for, and when', () => {
    test('exactly the screen and the microphone, in that order', async () => {
        const { activity, media } = rig();
        await activity.start({ conversationId: 'c1' });
        expect(media.calls.map((c) => c.kind)).toEqual(['display', 'user']);
    });

    test('nothing is asked for until start is called', () => {
        // Registering the activity, or showing its tile in the launcher, must not open a
        // permission dialog. The dialog is a consequence of pressing start.
        const { media } = rig();
        expect(media.calls).toEqual([]);
    });

    test('no camera is ever requested', async () => {
        // The other four activities that reach the consent machine ask for a camera. This one
        // records a call, and a meeting recorder that turned on a webcam would be the single
        // worst surprise in the product. Both requests go through `getUserMedia`, so the
        // constraints are what distinguishes them — asserted, not assumed.
        const { activity, media } = rig();
        await activity.start({ conversationId: 'c1' });
        const user = media.calls.filter((c) => c.kind === 'user');
        expect(user).toHaveLength(1);
        expect(user[0].constraints.video).toBe(false);
        expect(user[0].constraints.audio).toBeTruthy();
        expect(user[0].constraints.audio.echoCancellation).toBe(true);
    });

    test('declining the screen never reaches the microphone', async () => {
        const { activity, media, recorder } = rig({ grantDisplay: false });
        const result = await activity.start({ conversationId: 'c1' });
        expect(result.ok).toBe(false);
        expect(media.calls.map((c) => c.kind)).toEqual(['display']);
        expect(recorder.started).toEqual([]);
    });

    test('declining the microphone leaves nothing recording and nothing granted', async () => {
        const { activity, consent, recorder } = rig({ grantUser: false });
        const result = await activity.start({ conversationId: 'c1' });
        expect(result.ok).toBe(false);
        expect(consent.grant).toBeNull();
        expect(recorder.started).toEqual([]);
        expect(activity.recording).toBe(false);
    });

    test('a conversation is required, before any dialog opens', async () => {
        // A meeting with nowhere to land is a meeting nobody can find again, and asking for
        // a screen to record it into nothing is worse than refusing.
        const { activity, media } = rig();
        expect((await activity.start({})).ok).toBe(false);
        expect(media.calls).toEqual([]);
    });
});

// ── revocation ─────────────────────────────────────────────────────────────

describe('revoking stops capture inside a frame', () => {
    test('a revoke stops the recorder synchronously, with no await', async () => {
        // No timers, no flush, no await between the revoke and the assertion. If this needed
        // one, the guarantee would be "soon" rather than "now" — and "soon" is a window in
        // which a screen the user stopped sharing is still being recorded.
        const { activity, consent, recorder } = rig();
        await activity.start({ conversationId: 'c1' });
        expect(activity.recording).toBe(true);

        consent.revoke('user');

        expect(recorder.stopped).toBe(1);
        expect(activity.recording).toBe(false);
        expect(activity.stats.stops.revoked).toBe(1);
    });

    test('the browser’s own stop-sharing button counts as a revoke', async () => {
        const { activity, consent, recorder } = rig();
        await activity.start({ conversationId: 'c1' });
        // The track ends without telling anyone; B11 watches for exactly this.
        consent.revoke('ended by the browser');
        expect(recorder.stopped).toBe(1);
        expect(activity.recording).toBe(false);
    });

    test('stopping deliberately releases the screen too', async () => {
        const { activity, consent, recorder } = rig();
        await activity.start({ conversationId: 'c1' });
        activity.stop('user');
        expect(recorder.stopped).toBe(1);
        expect(consent.state).toBe('idle');
        expect(activity.recording).toBe(false);
    });

    test('a second revoke does not stop a recorder that is already stopped', async () => {
        const { activity, consent, recorder } = rig();
        await activity.start({ conversationId: 'c1' });
        consent.revoke('once');
        consent.revoke('twice');
        expect(recorder.stopped).toBe(1);
    });

    test('a recorder that refuses leaves no grant and no indicator', async () => {
        // A recording badge over a recorder that never started is the worst thing this
        // activity could show.
        const { activity, consent } = rig({ ok: false });
        const result = await activity.start({ conversationId: 'c1' });
        expect(result.ok).toBe(false);
        expect(consent.state).toBe('idle');
        expect(activity.recording).toBe(false);
    });

    test('a recorder that throws is a refusal, not a crash', async () => {
        const { activity, consent } = rig();
        activity.recorder.startWithStreams = () => Promise.reject(new Error('the socket died'));
        const result = await activity.start({ conversationId: 'c1' });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('the socket died');
        expect(consent.state).toBe('idle');
    });
});

// ── the other seven ────────────────────────────────────────────────────────

describe('the other seven activities are untouched', () => {
    test('the eighth is an addition to the table, not an edit of it', () => {
        const ids = Object.keys(TogetherPanel.STEPS || {});
        expect(ids).toEqual(['watch', 'journey', 'music', 'cohost', 'focus', 'coach', 'copilot', 'meeting']);
    });

    test('it sorts last and asks for the compound source', () => {
        const meta = (TogetherPanel.STEPS || {}).meeting;
        expect(meta.order).toBeGreaterThan(70);
        expect(meta.options.map((o) => o.needs)).toEqual(['meeting']);
    });

    test('its prompt says what will be asked for before either dialog opens', () => {
        // Two permission prompts in a row with no warning is how a person declines the second
        // and wonders why nothing recorded.
        const meta = (TogetherPanel.STEPS || {}).meeting;
        expect(meta.prompt).toMatch(/screen/i);
        expect(meta.prompt).toMatch(/microphone/i);
    });
});

// ── incidentals ────────────────────────────────────────────────────────────

describe('the small surface', () => {
    test('mute goes straight through and does not stop the call side', async () => {
        const { activity, recorder } = rig();
        await activity.start({ conversationId: 'c1' });
        activity.muteMic(true);
        expect(recorder.muted).toBe(true);
        expect(activity.recording).toBe(true);
    });

    test('starting twice is refused rather than opening a second dialog', async () => {
        const { activity, media } = rig();
        await activity.start({ conversationId: 'c1' });
        const again = await activity.start({ conversationId: 'c1' });
        expect(again.ok).toBe(false);
        expect(media.calls.map((c) => c.kind)).toEqual(['display', 'user']);
    });

    test('it announces its phases on the bus, as one typed event', () => {
        // One `meeting:phase` rather than a `meeting:start`/`meeting:stop` pair, the way
        // `focus:phase` does it: three states of one thing, and a closed vocabulary that
        // still catches a typo.
        return (async () => {
            const { activity, events } = rig();
            await activity.start({ conversationId: 'c1' });
            activity.stop('user');
            expect(events.map((e) => e.phase)).toEqual(['start', 'stop']);
            expect(events[0].meetingId).toBe('meet-1');
            expect(events[1].why).toBe('user');
        })();
    });

    test('detaching stops everything and unsubscribes', async () => {
        const { activity, consent, recorder } = rig();
        await activity.start({ conversationId: 'c1' });
        activity.detach();
        expect(recorder.stopped).toBe(1);
        expect(consent.state).toBe('idle');
        // And a later revoke reaches nothing.
        consent.revoke('after');
        expect(recorder.stopped).toBe(1);
    });
});
