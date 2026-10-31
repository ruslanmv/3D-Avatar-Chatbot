/**
 * XL2 — XRWarmUp: get the GPU ready for VR in small tasks, so Chrome never sees a hung page.
 *
 * The contract pinned here: every program is dispatched in ONE compile() with shader-error checks
 * off (that check is the call that waits) and the check is restored after; completion is polled
 * with the non-blocking COMPLETION_STATUS_KHR, never LINK_STATUS; textures upload a couple per
 * task; a budget bounds the wait; nothing throws.
 */

const W = require('../src/gltf-viewer/XRWarmUp.js');

const COMPLETION_STATUS_KHR = 0x91b1;
const LINK_STATUS = 0x8b82;

/** A clock the test owns, and a yield that advances it — no real waiting. */
function fakeTime() {
    let t = 0;
    const yields = [];
    return {
        now: () => t,
        yieldTo: (ms) => {
            yields.push(ms);
            t += ms || 1;
            return Promise.resolve();
        },
        yields,
    };
}

function texture(id) {
    return { isTexture: true, uuid: id, image: { width: 4, height: 4 } };
}

/** Programs that finish compiling after `readyAfter` polls each (Infinity = never). */
function fakeRenderer({ programs = 3, readyAfter = 2, compileThrows = false } = {}) {
    const handles = Array.from({ length: programs }, (_, i) => ({ id: i, polls: 0 }));
    const calls = { compile: [], initTexture: [], getParameter: [] };
    const renderer = {
        debug: { checkShaderErrors: true },
        info: { programs: [] },
        compile(scene, camera) {
            calls.compile.push({ checkShaderErrors: renderer.debug.checkShaderErrors, scene, camera });
            if (compileThrows) throw new Error('boom');
            renderer.info.programs = handles.map((h) => ({ program: h }));
        },
        initTexture(t) {
            calls.initTexture.push(t.uuid);
        },
    };
    const gl = {
        getExtension: (name) => (name === 'KHR_parallel_shader_compile' ? { COMPLETION_STATUS_KHR } : null),
        getProgramParameter(p, pname) {
            calls.getParameter.push(pname);
            p.polls += 1;
            return p.polls > readyAfter;
        },
    };
    return { renderer, gl, calls, handles };
}

function sceneWith(materials) {
    return { traverse: (fn) => materials.forEach((material) => fn({ material })) };
}

test('dispatches every program in one compile() with error checks off, then restores them', async () => {
    const time = fakeTime();
    const { renderer, gl, calls } = fakeRenderer();
    const scene = sceneWith([]);
    const camera = {};
    await W.warmUp({ renderer, scene, camera, gl, ...time });
    expect(calls.compile).toHaveLength(1);
    expect(calls.compile[0]).toMatchObject({ checkShaderErrors: false, scene, camera });
    expect(renderer.debug.checkShaderErrors).toBe(true);
});

test('waits with COMPLETION_STATUS_KHR only — never the blocking LINK_STATUS', async () => {
    const time = fakeTime();
    const { renderer, gl, calls } = fakeRenderer({ programs: 4, readyAfter: 3 });
    const report = await W.warmUp({ renderer, scene: sceneWith([]), camera: {}, gl, ...time });
    expect(report).toMatchObject({ ok: true, programs: 4, parallel: true, pending: 0 });
    expect(new Set(calls.getParameter)).toEqual(new Set([COMPLETION_STATUS_KHR]));
    expect(calls.getParameter).not.toContain(LINK_STATUS);
    // It yielded between polls instead of spinning.
    expect(time.yields.filter((ms) => ms === W.DEFAULTS.pollMs).length).toBeGreaterThanOrEqual(3);
});

test('a compile that never finishes is bounded by the budget, and reported', async () => {
    const time = fakeTime();
    const { renderer, gl } = fakeRenderer({ programs: 2, readyAfter: Infinity });
    const report = await W.warmUp({ renderer, scene: sceneWith([]), camera: {}, gl, ...time, budgetMs: 500 });
    expect(report.pending).toBe(2);
    expect(time.now()).toBeLessThan(500 + 2 * W.DEFAULTS.pollMs);
});

test('without KHR_parallel_shader_compile it still compiles and uploads, and does not poll', async () => {
    const time = fakeTime();
    const { renderer, gl, calls } = fakeRenderer();
    gl.getExtension = () => null;
    const report = await W.warmUp({ renderer, scene: sceneWith([{ map: texture('a') }]), camera: {}, gl, ...time });
    expect(report).toMatchObject({ parallel: false, textures: 1 });
    expect(calls.getParameter).toHaveLength(0);
});

test('uploads every texture once — properties and shader uniforms — a couple per task', async () => {
    const time = fakeTime();
    const { renderer, gl, calls } = fakeRenderer({ programs: 0 });
    const shared = texture('shared');
    const scene = sceneWith([
        { map: shared, normalMap: texture('n') },
        { uniforms: { map: { value: shared }, shadeMultiplyTexture: { value: texture('s') } } },
        [{ emissiveMap: texture('e') }], // several materials on one object, as glTF primitives have
        { map: { isTexture: true, uuid: 'rt', isRenderTargetTexture: true, image: {} } },
    ]);
    const report = await W.warmUp({ renderer, scene, camera: {}, gl, ...time, texturesPerTask: 2 });
    expect(calls.initTexture.sort()).toEqual(['e', 'n', 's', 'shared']);
    expect(report.textures).toBe(4);
    // 4 textures at 2 per task → two yields of 0 ms after uploads (plus the one after compile).
    expect(time.yields.filter((ms) => ms === 0).length).toBeGreaterThanOrEqual(3);
});

test('a compile that throws is reported, restores the check, and still uploads textures', async () => {
    const time = fakeTime();
    const { renderer, gl, calls } = fakeRenderer({ compileThrows: true });
    const report = await W.warmUp({ renderer, scene: sceneWith([{ map: texture('a') }]), camera: {}, gl, ...time });
    expect(report.ok).toBe(false);
    expect(report.reason).toMatch(/boom/);
    expect(renderer.debug.checkShaderErrors).toBe(true);
    expect(calls.initTexture).toEqual(['a']);
});
