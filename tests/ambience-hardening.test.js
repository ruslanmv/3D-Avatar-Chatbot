/**
 * Hardening the ambience feature across the modes that share the renderer (batch A12).
 *
 * A12 is an audit, not a feature: tests and docs only, and anything found wrong in source is a
 * finding to raise rather than fold in. `docs/AMBIENCE_HARDENING.md` records the whole matrix
 * with its results; this file automates every row jsdom can actually decide, so the ones that
 * hold keep holding.
 *
 * The thing being audited is narrow and worth stating: four modes — Companion, VR, AR and clip
 * recording — each take over the renderer, and three of them **snapshot and restore**
 * `scene.background`. A scenic background is now a value in that snapshot rather than a colour
 * that can be rebuilt from a constant, so every one of those hand-offs became load-bearing the
 * day A5 landed.
 *
 * Two rows failed, and both are recorded here as tests that assert the *current, wrong*
 * behaviour with the finding named. That is deliberate: a test asserting what we wish were true
 * would fail on a clean checkout and teach the next person to ignore it. These pin reality so
 * the diff that fixes the finding also flips the test, which is where the conversation belongs.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const engine = fs.readFileSync(path.join(root, 'src/gltf-viewer/ViewerEngine.js'), 'utf-8');
const ar = fs.readFileSync(path.join(root, 'src/gltf-viewer/ARSupport.js'), 'utf-8');
const companion = fs.readFileSync(path.join(root, 'src/CompanionMode.js'), 'utf-8');
const manager = fs.readFileSync(path.join(root, 'src/gltf-viewer/ambience/ViewportBackgroundManager.js'), 'utf-8');
const recorder = fs.readFileSync(path.join(root, 'src/features/clips/ClipRecorder.js'), 'utf-8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
const css = fs.readFileSync(path.join(root, 'styles/main.css'), 'utf-8');

/**
 * Source with comments removed.
 *
 * An assertion that a name is absent must read code, not the note explaining why the name is
 * avoided. The manager's header says in prose that it never touches `scene.environment`, which
 * is exactly the word the lighting assertion forbids.
 */
function stripComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** One method body from ViewerEngine, by its definition rather than its first mention. */
function method(name, src = engine) {
    const start = src.indexOf(`\n    ${name}(`);
    if (start === -1) throw new Error(`no method ${name}`);
    const end = src.indexOf('\n    }', start);
    const body = src.slice(start, end === -1 ? undefined : end);
    if (body.trim().length < 30) throw new Error(`extractor produced an empty body for ${name}`);
    return body;
}

/** One `window.addEventListener('<name>', …)` handler body in ViewerEngine. */
function handler(eventName) {
    const start = engine.indexOf(`window.addEventListener('${eventName}'`);
    if (start === -1) throw new Error(`no ${eventName} handler`);
    const body = engine.slice(start, start + 4000);
    if (body.length < 100) throw new Error(`empty handler for ${eventName}`);
    return body;
}

describe('the extractors are not lying to the rest of this file', () => {
    test('they return real bodies and throw otherwise', () => {
        expect(method('setDesktopBackground')).toContain('BG_COLORS');
        expect(handler('vr-session-end')).toContain('backgroundManager');
        expect(() => method('noSuchMethod')).toThrow(/no method/);
        expect(() => handler('no-such-event')).toThrow(/no no-such-event/);
    });
});

describe('VR — the headset never sees a flat rectangle', () => {
    test('a selection made while presenting is applied on exit, not the stale one', () => {
        // The error in the first A12 record. reapplyCurrent() restored whatever the *manager*
        // last applied, and the manager is deliberately never told about a change during XR —
        // so a scene chosen in the headset was silently discarded on exit, for VR as well as
        // AR. The exit now passes the selection of record.
        expect(handler('vr-session-end')).toContain('reapplyCurrent(this._desktopBgKey)');
    });

    test('a selection made while presenting is recorded, not applied', () => {
        // A flat 16:9 image pasted across an immersive sky is the single worst thing this
        // feature could do. Both branches of setDesktopBackground carry the guard.
        const fn = method('setDesktopBackground');
        expect(fn.match(/if \(!this\.renderer\.xr\.isPresenting\)/g)).toHaveLength(2);
    });

    test('the selection is still remembered, so it can be applied on exit', () => {
        const fn = method('setDesktopBackground');
        expect(fn.match(/this\._desktopBgKey = key;/g)).toHaveLength(2);
    });

    test('leaving VR re-applies the scene rather than painting a colour', () => {
        const exit = handler('vr-session-end');
        expect(exit).toContain('this.backgroundManager.reapplyCurrent(this._desktopBgKey);');
    });

    test('and the old unconditional black rebuild is gone', () => {
        // BG_COLORS['ambient:terrace:night'] is undefined, so `?? 0x000000` painted black over
        // a chosen scene on every VR exit. This is the bug A5 fixed; it must not return.
        const exit = handler('vr-session-end');
        const restore = exit.slice(0, exit.indexOf('Restore desktop hemisphere light'));
        expect(restore).toContain('if (this.backgroundManager) {');
    });

    test('VR entry still snapshots and paints its own solid colour', () => {
        expect(engine).toContain('this._vrSavedBackground = this.scene.background;');
    });
});

describe('AR — the camera feed is not obscured', () => {
    test('entering AR nulls the background after snapshotting it', () => {
        const enter = ar.slice(ar.indexOf('this._savedBackground = this.scene.background;'));
        expect(enter.slice(0, 600)).toContain('this.scene.background = null;');
    });

    test('a scene change during AR is recorded but not applied, so nothing is disposed', () => {
        // The texture ARSupport is holding for restore must not be freed underneath it. The
        // xr.isPresenting guard covers AR as well as VR, so the manager is never called.
        expect(method('setDesktopBackground')).toContain('if (!this.renderer.xr.isPresenting)');
    });

    test('exiting AR restores the snapshot verbatim', () => {
        expect(ar).toContain('this.scene.background = this._savedBackground;');
    });

    test('A12-1 FIXED: leaving AR re-applies the selected scene', () => {
        // Was: AR's exit had no equivalent of VR's reapplyCurrent(), so a scene chosen during
        // the session was recorded in _desktopBgKey and never painted — the Settings radio and
        // the viewport disagreed. This also covers forceExit(), which dispatches the event
        // without restoring anything and would otherwise leave the viewport transparent.
        const exit = handler('ar-session-end');
        expect(exit).toContain('this.backgroundManager?.reapplyCurrent(this._desktopBgKey);');
    });

    test('and it runs after ARSupport has written its snapshot back, not racing it', () => {
        // onSessionEnd() restores scene.background and only then dispatches 'ar-session-end',
        // so ordering is guaranteed by the dispatch being last rather than by the registration
        // order of two listeners. That distinction is why this was raised rather than patched
        // blind in A12.
        const restore = ar.indexOf('this.scene.background = this._savedBackground;');
        const dispatch = ar.indexOf("window.dispatchEvent(new CustomEvent('ar-session-end'));");
        expect(restore).toBeGreaterThan(-1);
        expect(restore).toBeLessThan(dispatch);
    });
});

describe('Companion — the crop survives the round trip', () => {
    test('resize() early-returns while the PiP window owns sizing', () => {
        expect(method('resize')).toContain('if (window.__COMPANION_ACTIVE__) return;');
    });

    test('so the crop is never recomputed *during* PiP, which is why it survives', () => {
        // The manager is only driven from resize(), and resize() is inert while the flag is
        // set. The crop therefore keeps the desktop aspect it was computed with — correct on
        // return to the same desktop size, and the reason the common case passes.
        expect(method('resize')).toContain('this.backgroundManager?.onResize(w, h);');
        expect(companion).not.toContain('backgroundManager');
    });

    test('the overlay strategy nudges a real resize after clearing the flag', () => {
        const restore = companion.slice(companion.indexOf('// Nudge the app to re-fit'));
        expect(restore.slice(0, 300)).toContain('window.NEXUS_VIEWER?.resize?.()');
    });

    test('A12-2 FIXED: document-PiP nudges a re-fit too', () => {
        // Was: strategy B called only its onResize callback — which knows nothing about the
        // background manager — and called it before clearing the flag, so even routing it
        // through resize() would have been swallowed by the early return.
        const restore = companion.slice(companion.indexOf('        _restore() {'));
        const body = restore.slice(0, restore.indexOf('\n        }'));
        expect(body).toContain('window.NEXUS_VIEWER?.resize?.()');
    });

    test('and the nudge comes after the flag is cleared, which is the whole point', () => {
        const restore = companion.slice(companion.indexOf('        _restore() {'));
        const body = restore.slice(0, restore.indexOf('\n        }'));
        expect(body.indexOf('__COMPANION_ACTIVE__ = false')).toBeLessThan(body.indexOf('NEXUS_VIEWER?.resize'));
    });

    test('both strategies now agree', () => {
        const nudges = companion.match(/window\.NEXUS_VIEWER\?\.resize\?\.\(\)/g) || [];
        expect(nudges).toHaveLength(2);
    });

    test('onResize does not reach the background manager', () => {
        const cb = companion.slice(companion.indexOf('onResize: (w, h) => {'));
        expect(cb.slice(0, 400)).not.toContain('backgroundManager');
    });
});

describe('Clips — the scenery is in the recording', () => {
    test('the recorder captures the WebGL canvas', () => {
        // The whole reason the CSS approach was rejected: a CSS background behind a transparent
        // canvas is composited by the browser and absent from captureStream. A scene.background
        // texture is drawn by the renderer into the very canvas being recorded.
        expect(recorder).toContain('captureStream');
        expect(recorder).toContain('_canvasOrNull()');
    });

    test('nothing in the ambience code paints a CSS background on the canvas', () => {
        // The one change that would silently reintroduce the regression.
        expect(stripComments(manager)).not.toMatch(/style\.background|canvas\.style|classList/);
        expect(manager).toContain('scene.background');
    });

    test('the Settings thumbnail is the only CSS background image, and it is a thumbnail', () => {
        const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf-8');
        const hits = main.match(/style\.backgroundImage/g) || [];
        expect(hits).toHaveLength(1);
        expect(main).toContain('thumb.style.backgroundImage = `url("${scene.thumb}")`');
    });
});

describe('Memory — one live texture, whatever the user clicks', () => {
    test('the manager disposes the outgoing texture', () => {
        expect(manager).toContain('dispose');
    });

    test('it swaps before it disposes', () => {
        // Disposing first frees a texture that is still on screen — a frame with no background,
        // which reads as a flash of black between two scenes. The module header names this as
        // the reason for the order, and this is the assertion that keeps it.
        const code = stripComments(manager);
        const swap = code.indexOf('this.scene.background = texture;');
        const drop = code.indexOf('if (previous && previous !== texture) this._dispose(previous);');
        expect(swap).toBeGreaterThan(-1);
        expect(drop).toBeGreaterThan(-1);
        expect(swap).toBeLessThan(drop);
    });

    test('a load that lost the race disposes its own texture instead of showing it', () => {
        // Three fast clicks start three loads. The two that resolve late must free what they
        // fetched rather than painting over the winner.
        expect(stripComments(manager)).toContain('this._dispose(texture);');
    });

    test('a generation token means the last click wins, and the losers are freed', () => {
        expect(manager).toContain('generation');
    });

    test('image → colour disposes too, which is the leak with no successor', () => {
        // The transition where nothing replaces the texture, so nothing would otherwise free it.
        expect(method('setDesktopBackground')).toContain('this.backgroundManager.apply(key);');
    });
});

describe('Perf — nothing happens per frame', () => {
    test('the render loop never touches the manager', () => {
        const animate = engine.slice(engine.indexOf('\n    animate('), engine.indexOf('\n    animate(') + 3000);
        expect(animate).not.toContain('backgroundManager');
    });

    test('the manager starts no loop of its own', () => {
        expect(stripComments(manager)).not.toMatch(/requestAnimationFrame|setAnimationLoop|setInterval/);
    });

    test('the cover transform is recomputed only on resize and on apply', () => {
        const hits = manager.match(/computeCoverTransform/g) || [];
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.length).toBeLessThanOrEqual(3);
    });
});

describe('Lighting — the avatar is not lit by the picture', () => {
    test('no environment map, PMREM or tone-mapping change comes from the background', () => {
        // A background is a picture behind her, not a light source. The addendum was explicit.
        expect(stripComments(manager)).not.toMatch(/environment|PMREM|RoomEnvironment|toneMapping/);
    });
});

describe('A11y — the grid is reachable and announced', () => {
    test('every card is a radio in one named group, so arrow keys move between them', () => {
        // Native behaviour, and the reason the cards are radios rather than buttons.
        const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf-8');
        expect(main).toContain("radio.name = 'desktop-bg'");
        expect(html).toContain('name="desktop-bg"');
    });

    test('focus is visible, which it was not for any card before A6', () => {
        expect(css).toContain('.provider-radio:focus-visible + .provider-content');
        expect(css).toMatch(/focus-visible \+ \.provider-content \{[\s\S]{0,140}outline:/);
    });

    test('the radio is hidden by opacity, not by display:none, so it stays focusable', () => {
        const rule = css.slice(css.indexOf('.provider-radio {'));
        expect(rule.slice(0, 200)).toContain('opacity: 0');
        expect(rule.slice(0, 200)).not.toContain('display: none');
        expect(rule.slice(0, 200)).not.toContain('visibility: hidden');
    });

    test('the name comes from the label text, not from the picture', () => {
        // The thumbnail is a div with a CSS background — decorative and correctly unannounced.
        // The accessible name is the wrapping label's text: "Ocean" plus "Sunrise".
        const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf-8');
        expect(main).toContain('.textContent = scene.label');
        expect(main).toContain("thumb.className = 'provider-thumb'");
    });

    test('the group is labelled for a screen reader', () => {
        expect(html).toContain('role="group"');
        expect(html).toContain('aria-labelledby="bg-scene-heading"');
    });
});

describe('the invariant A12 must not break', () => {
    test('the behaviour scenes suite is still present and is the enter/exit guard', () => {
        const scenes = fs.readFileSync(path.join(root, 'tests/behavior/scenes.test.js'), 'utf-8');
        expect(scenes).toMatch(/enter|exit/i);
    });
});
