/**
 * MO13. A stop or a newer gesture that arrives while a clip is still loading wins; an automatic
 * ambient request (talking when speech starts, idle) never cancels a loading gesture.
 */
const fs = require('fs');
const path = require('path');
const Clips = require('../src/xr/MotionClipMap.js');
// Library-only mode (the default) keeps only clips from the manifest's trusted categories, as in
// the browser; without the manifest every vendor clip is filtered out before any load starts.
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vendor/animations/manifest.json'), 'utf8'));

function deferredLoader() {
    const pending = {};
    const played = [];
    const loader = {
        loadClip: (p) => new Promise((resolve) => (pending[p] = () => resolve({ name: p }))),
        playClip: async (p) => {
            played.push(p);
            return true;
        },
        stopClip: () => {},
        getCurrentPlaybackState: () => ({ clip: null, isPlaying: false }),
        getClipDuration: () => 2,
    };
    return { loader, pending, played };
}

describe('MO13: clip loads honour the latest explicit request', () => {
    let env;
    beforeEach(() => {
        env = deferredLoader();
        window.NEXUS_CLIP_LOADER = env.loader;
        Clips._setManifest(MANIFEST);
        Clips.resetUnavailable && Clips.resetUnavailable();
    });
    afterEach(() => {
        delete window.NEXUS_CLIP_LOADER;
        Clips._setManifest(null);
    });

    const resolveAll = async () => {
        for (const k of Object.keys(env.pending)) env.pending[k]();
        await new Promise((r) => setTimeout(r, 0));
    };

    test('stop during a load cancels the late clip', async () => {
        const p = Clips.play('jump');
        Clips.stop();
        await resolveAll();
        const res = await p;
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('superseded');
        expect(env.played).toEqual([]);
    });

    test('a newer gesture supersedes one still loading', async () => {
        const first = Clips.play('jump');
        const second = Clips.play('goodbye');
        await resolveAll();
        const r1 = await first;
        const r2 = await second;
        expect(r1.reason).toBe('superseded');
        expect(r2.ok).toBe(true);
        // Only the newer request reached the mixer (which file is a format-order detail).
        expect(env.played).toEqual([r2.path]);
    });

    test('talking requested while a gesture loads does not cancel the gesture', async () => {
        const gesture = Clips.play('goodbye');
        const talking = Clips.play('talking');
        await resolveAll();
        const g = await gesture;
        expect(g.ok).toBe(true);
        expect(env.played).toContain(g.path);
        await talking;
    });
});
