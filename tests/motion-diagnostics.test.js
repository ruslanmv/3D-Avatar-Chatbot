/**
 * Motion diagnostics (the "I ask dance and nothing plays" tooling).
 *
 * The deployed symptom: every addon .vrma came back as index.html (a
 * catch-all rewrite), the loader logged eight SyntaxErrors, and the motion
 * stack itself said nothing. These tests pin the new guarantees: a hard
 * failure is ALWAYS one actionable console.warn with the exact tried list,
 * failures are queryable (getUnavailable), a live probe list exists for
 * debugMotion(), verbose tracing is gated by the npc_debug setting, and
 * setDebug() flips + persists it.
 */

/* global describe, test, expect, beforeEach, afterEach, afterAll, jest */

const ClipMap = require('../src/xr/MotionClipMap');
const MI = require('../src/xr/MotionIntegration');
const Policy = require('../src/xr/MotionPolicy');

const MANIFEST = {
    categories: {
        emotion: { files: ['emotion/admiration.bvh'] },
    },
};

let warnSpy;
let logSpy;
beforeEach(() => {
    ClipMap._setManifest(MANIFEST);
    ClipMap._setLibraryOnly(true);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
    delete window.NEXUS_CLIP_LOADER;
});
afterAll(() => {
    ClipMap._setManifest(null);
    ClipMap._setLibraryOnly(null);
    ClipMap._setDebug(null);
    Policy._setOverride(null);
});

describe('a hard clip failure is loud, once, and actionable', () => {
    test('all-candidates failure warns with the exact tried list and returns it', async () => {
        window.NEXUS_CLIP_LOADER = {
            getManifest: () => MANIFEST,
            loadClip: async () => null, // every file "returns HTML"
            playClip: async () => false,
        };
        const res = await ClipMap.play('victory'); // addon-backed entry
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('load_failed');
        expect(res.tried.length).toBeGreaterThan(0);
        const all = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(all).toContain('ALL ' + res.tried.length + ' candidates failed');
        expect(all).toContain(res.tried[0]);
        expect(all).toContain('debugMotion');
    });

    test('the summary does not repeat once paths are marked unavailable', async () => {
        window.NEXUS_CLIP_LOADER = {
            getManifest: () => MANIFEST,
            loadClip: async () => null,
            playClip: async () => false,
        };
        await ClipMap.play('clap');
        const summaries = () => warnSpy.mock.calls.filter((c) => c.join(' ').indexOf('ALL ') !== -1).length;
        const afterFirst = summaries();
        await ClipMap.play('clap'); // everything already unavailable → tried=[]
        expect(summaries()).toBe(afterFirst); // no spam
    });

    test('getUnavailable exposes the failed paths for diagnostics', async () => {
        window.NEXUS_CLIP_LOADER = {
            getManifest: () => MANIFEST,
            loadClip: async () => null,
            playClip: async () => false,
        };
        await ClipMap.play('bow');
        const unavailable = ClipMap.getUnavailable();
        expect(unavailable.length).toBeGreaterThan(0);
        expect(unavailable.some((p) => p.indexOf('addons/') === 0 || p.indexOf('vendor/') === 0)).toBe(true);
    });
});

describe('probe list and verbose tracing', () => {
    test('probeCandidates covers an addon dance, an addon action, a manifest file', () => {
        const probes = ClipMap.probeCandidates();
        expect(probes[0].startsWith('addons/vrma-dance/')).toBe(true);
        expect(probes[1].startsWith('addons/vrma-actions/')).toBe(true);
        expect(probes[2]).toBe('vendor/animations/emotion/admiration.bvh');
    });

    test('the [MotionClipMap] trace is gated by the debug flag', async () => {
        window.NEXUS_CLIP_LOADER = {
            getManifest: () => MANIFEST,
            loadClip: async () => ({ duration: 1 }),
            playClip: async () => true,
        };
        ClipMap._setDebug(false);
        await ClipMap.play('victory');
        expect(logSpy.mock.calls.some((c) => String(c[0]).indexOf('[MotionClipMap]') === 0)).toBe(false);
        ClipMap._setDebug(true);
        await ClipMap.play('victory');
        const traced = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(traced).toContain('[MotionClipMap]');
        expect(traced).toContain('mode=library');
    });
});

describe('MotionIntegration debug surface', () => {
    test('setDebug flips config.debug and persists npc_debug', () => {
        MI.setDebug(true);
        expect(MI.config.debug).toBe(true);
        expect(localStorage.getItem('npc_debug')).toBe('true');
        MI.setDebug(false);
        expect(MI.config.debug).toBe(false);
        expect(localStorage.getItem('npc_debug')).toBe('false');
        localStorage.removeItem('npc_debug');
    });

    test('a failed gesture prints one actionable warn with the tried list', () => {
        Policy._setOverride({ enabled: true, movement: 'off' });
        const realClips = window.NEXUS_MOTION_CLIPS;
        window.NEXUS_MOTION_CLIPS = {
            play: () =>
                Promise.resolve({ ok: false, reason: 'load_failed', tried: ['x.vrma', 'y.bvh'], procedural: null }),
            availableNames: () => [],
        };
        MI.playAnimation('dance');
        return new Promise((resolve) =>
            setTimeout(() => {
                const all = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
                expect(all).toContain('did not play');
                expect(all).toContain('x.vrma, y.bvh');
                expect(all).toContain('debugMotion');
                window.NEXUS_MOTION_CLIPS = realClips;
                resolve();
            }, 0)
        );
    });

    test('debugMotion({probe:false}) returns a coherent report without fetching', async () => {
        Policy._setOverride({ enabled: true, movement: 'vr' });
        window.NEXUS_CLIP_LOADER = {
            getManifest: () => MANIFEST,
            getAllAnimations: () => [{ id: 'a' }, { id: 'b' }],
            loadClip: async () => null,
            playClip: async () => false,
        };
        const report = await MI.debugMotion({ probe: false });
        expect(report.enabled).toBe(true);
        expect(report.movement).toBe('vr');
        expect(report.modules.loader).toBe(true);
        expect(report.libraryCatalog).toBe(2);
        expect(Array.isArray(report.unavailable)).toBe(true);
        expect(report.probes).toEqual([]);
        expect(typeof report.telemetry.utterances).toBe('number');
    });
});
