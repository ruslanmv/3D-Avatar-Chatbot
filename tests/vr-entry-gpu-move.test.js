/**
 * XL1 — entering VR on a PC driving a headset (Quest Link, SteamVR).
 *
 * Making the WebGL context XR-compatible can move it to the headset's GPU: Chrome loses the
 * context, restores it there, and rejects the first makeXRCompatible() with InvalidStateError.
 * VRSupport used to log "continuing anyway" and enter VR with a dead context. These tests pin the
 * new contract of `_makeXRCompatible`: a move is waited out and retried, anything else is thrown.
 *
 * VRSupport.js is an ES module; the house pattern is to read it and eval it with `export` removed
 * (tests/camera-presets.test.js does the same for its module).
 */

const fs = require('fs');
const path = require('path');

const src = fs
    .readFileSync(path.resolve(__dirname, '../src/gltf-viewer/VRSupport.js'), 'utf-8')
    .replace(/^export class VRSupport/m, 'class VRSupport');
// eslint-disable-next-line no-new-func
const VRSupport = new Function(`${src}\nreturn VRSupport;`)();

/** A context whose makeXRCompatible() behaves like Chrome's when the GPU has to change. */
function fakeContext({ moves = false, failsWithoutLoss = false, restores = true } = {}) {
    const canvas = new EventTarget();
    let lost = false;
    let calls = 0;
    const gl = {
        isContextLost: () => lost,
        makeXRCompatible: jest.fn(async () => {
            calls += 1;
            if (failsWithoutLoss) {
                throw new DOMException('XR not available', 'InvalidStateError');
            }
            if (moves && calls === 1) {
                lost = true;
                // The loss event is queued behind the rejection, as in the log that reported this.
                setTimeout(() => canvas.dispatchEvent(new Event('webglcontextlost')), 20);
                if (restores) {
                    setTimeout(() => {
                        lost = false;
                        canvas.dispatchEvent(new Event('webglcontextrestored'));
                    }, 120);
                }
                throw new DOMException('Context lost', 'InvalidStateError');
            }
        }),
    };
    return { gl, canvas };
}

/** A VRSupport with only what _makeXRCompatible touches — no renderer, no DOM button. */
function supportFor(canvas) {
    const vr = Object.create(VRSupport.prototype);
    vr.renderer = { domElement: canvas };
    vr._contextLosses = 0;
    canvas.addEventListener('webglcontextlost', () => {
        vr._contextLosses += 1;
    });
    return vr;
}

let logSpy;
beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => logSpy.mockRestore());

test('a context already on the right GPU is made compatible in one call', async () => {
    const { gl, canvas } = fakeContext();
    await supportFor(canvas)._makeXRCompatible(gl);
    expect(gl.makeXRCompatible).toHaveBeenCalledTimes(1);
});

test('a GPU move is waited out and retried — VR is entered with a live context', async () => {
    const { gl, canvas } = fakeContext({ moves: true });
    await supportFor(canvas)._makeXRCompatible(gl);
    expect(gl.makeXRCompatible).toHaveBeenCalledTimes(2);
    expect(gl.isContextLost()).toBe(false);
});

test('a rejection with no context loss behind it is a real failure, thrown as it came', async () => {
    const { gl, canvas } = fakeContext({ failsWithoutLoss: true });
    await expect(supportFor(canvas)._makeXRCompatible(gl)).rejects.toThrow('XR not available');
    expect(gl.makeXRCompatible).toHaveBeenCalledTimes(1);
});

test('a context that never comes back fails with a sentence, not a hang', async () => {
    const { gl, canvas } = fakeContext({ moves: true, restores: false });
    const vr = supportFor(canvas);
    const realWait = vr._waitForContextRestore.bind(vr);
    vr._waitForContextRestore = (g) => realWait(g, 200); // the 8 s budget, shortened for the test
    await expect(vr._makeXRCompatible(gl)).rejects.toThrow(/did not come back/);
});

test('the session is requested before the GPU work, while the click still counts', () => {
    const enter = src.slice(src.indexOf('async toggleVR'), src.indexOf('forceExit() {'));
    const request = enter.indexOf("requestSession('immersive-vr'");
    const compatible = enter.indexOf('this._makeXRCompatible(gl)');
    // XL3: then the HomePilot loading card, then the session starts showing it, and the XL2
    // warm-up runs behind the card — her first frame comes only after it.
    const splash = enter.indexOf('this.beginSplash()');
    const start = enter.indexOf('this.renderer.xr.setSession(session)');
    const warm = enter.indexOf('this.prepareForSession()');
    expect(request).toBeGreaterThan(-1);
    expect(compatible).toBeGreaterThan(request);
    expect(splash).toBeGreaterThan(compatible);
    expect(start).toBeGreaterThan(splash);
    expect(warm).toBeGreaterThan(start);
    // XL2: no throwaway XRWebGLLayer before three's own.
    expect(enter).not.toMatch(/new XRWebGLLayer\(/);
    // XL2: the render loop is handed back however entry ends.
    // …and is told whether VR was entered (XL3: the loading card stays its minimum only then).
    expect(enter).toMatch(/finally \{[\s\S]*this\.onEntryFinished\(Boolean\(this\.renderer\.xr\.isPresenting\)\)/);
    // And a session the page could not draw into is ended, not left hanging in the headset.
    expect(enter).toContain('await session.end();');
});
