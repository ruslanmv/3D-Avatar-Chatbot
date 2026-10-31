/**
 * AR1 — placing her starts the conversation, and it is the one she was already in.
 *
 * Pinned: a tap that placed nothing neither claims success nor opens the microphone; a real
 * placement says so, ends the coaching card and opens it; a typed AR message is drawn once, by the
 * conversation pipeline; the AR transcript opens on the conversation store and is rebuilt on every
 * entry. ARSupport.placeAvatarAtReticle runs for real, against the vendored three.js.
 */

const fs = require('fs');
const path = require('path');
const THREE = require('../vendor/three-0.147.0/build/three.min.js');
const AR = require('../src/gltf-viewer/ARConversation.js');

const read = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf-8');

describe('the transcript opens on the conversation', () => {
    test('user and assistant turns with text, in order, as the overlay names them', () => {
        const history = [
            { role: 'system', content: 'You are…' },
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'Hello! ' },
            { role: 'user', content: '   ' },
            { role: 'assistant', content: null },
        ];
        expect(AR.seedTranscript(history)).toEqual([
            { role: 'user', text: 'hi' },
            { role: 'bot', text: 'Hello!' },
        ]);
    });

    test('only the last eight — the overlay’s cap — and nothing from a missing store', () => {
        const history = Array.from({ length: 12 }, (_, i) => ({
            role: i % 2 ? 'assistant' : 'user',
            content: `m${i}`,
        }));
        const seeded = AR.seedTranscript(history);
        expect(seeded).toHaveLength(AR.TRANSCRIPT_MAX);
        expect(seeded[0].text).toBe('m4');
        expect(seeded[7].text).toBe('m11');
        expect(AR.seedTranscript(undefined)).toEqual([]);
        expect(AR.seedTranscript(history, 0)).toEqual([]);
    });
});

describe('what a tap on TAP TO PLACE leads to', () => {
    test('a real placement opens the microphone and says so', () => {
        const r = AR.afterPlaceTap({ placed: true, position: { x: 0, y: 0, z: -1 } });
        expect(r).toMatchObject({ placed: true, voice: true });
        expect(r.status).toMatch(/talk/i);
        expect(r.haptic).toBeGreaterThan(0);
    });

    test('no surface yet: no microphone, and a sentence that says what to do', () => {
        const r = AR.afterPlaceTap({ placed: false, reason: 'no-surface' });
        expect(r).toMatchObject({ placed: false, voice: false });
        expect(r.status).toMatch(/floor/i);
        expect(r.status).not.toMatch(/placed/i);
    });

    test('no avatar yet, or an answer from an older ARSupport: no microphone', () => {
        expect(AR.afterPlaceTap({ placed: false, reason: 'no-avatar' }).voice).toBe(false);
        expect(AR.afterPlaceTap(undefined).voice).toBe(false);
    });

    test('the status line is localised when a translation exists', () => {
        const t = (k, fb) => (k === 'ar_placed' ? 'Posizionata — parlami' : fb);
        expect(AR.afterPlaceTap({ placed: true }, t).status).toBe('Posizionata — parlami');
    });
});

describe('ARSupport.placeAvatarAtReticle says whether it placed her', () => {
    const src = read('src/gltf-viewer/ARSupport.js')
        .replace(/^import .*$/gm, '')
        .replace(/^export class ARSupport/m, 'class ARSupport');
    // eslint-disable-next-line no-new-func
    const ARSupport = new Function('THREE', `${src}\nreturn ARSupport;`)(THREE);

    function support(reticleVisible) {
        const ar = Object.create(ARSupport.prototype);
        ar.reticle = new THREE.Object3D();
        ar.reticle.visible = reticleVisible;
        ar.reticle.matrix.makeTranslation(0.5, -1.2, -2);
        ar.renderer = { xr: { getCamera: () => null } };
        ar.shadowPlane = null;
        return ar;
    }

    test('no surface under the reticle: not placed, she has not moved, nothing announced', () => {
        const root = new THREE.Object3D();
        const heard = jest.fn();
        window.addEventListener('ar-avatar-placed', heard);
        expect(support(false).placeAvatarAtReticle(root)).toEqual({ placed: false, reason: 'no-surface' });
        expect(root.position.toArray()).toEqual([0, 0, 0]);
        expect(heard).not.toHaveBeenCalled();
        window.removeEventListener('ar-avatar-placed', heard);
    });

    test('no avatar: not placed, for a different reason', () => {
        expect(support(true).placeAvatarAtReticle(null)).toEqual({ placed: false, reason: 'no-avatar' });
    });

    test('a surface: placed where the reticle is, and the coaching card is told', () => {
        const root = new THREE.Object3D();
        const heard = jest.fn();
        window.addEventListener('ar-avatar-placed', heard);
        const r = support(true).placeAvatarAtReticle(root);
        window.removeEventListener('ar-avatar-placed', heard);
        expect(r.placed).toBe(true);
        expect(root.position.toArray()).toEqual([0.5, -1.2, -2]);
        expect(r.position).toEqual({ x: 0.5, y: -1.2, z: -2 });
        expect(heard).toHaveBeenCalledTimes(1);
    });
});

describe('wiring in the page', () => {
    const main = read('src/main.js');
    const overlay = main.slice(
        main.indexOf('(function initAROverlay() {'),
        main.indexOf('PATCH_LLM_PROXY_TEST_CONNECTION_V1')
    );
    const fnBody = (sig) => {
        const start = overlay.indexOf(sig);
        expect(start).toBeGreaterThan(-1);
        return overlay.slice(start, overlay.indexOf('\n    }\n', start));
    };

    test('SEND draws no bubble of its own — the pipeline draws the turn once', () => {
        const send = fnBody('function arSendMessage() {');
        expect(send).toContain('handleUserMessage(text)');
        expect(send).not.toMatch(/appendARBubble\(|appendARTranscript\(/);
    });

    test('the microphone opens only when the tap placed her', () => {
        const start = overlay.indexOf("arPlaceBtn.addEventListener('click'");
        const tap = overlay.slice(start, overlay.indexOf('// --- Scale toggle ---', start));
        expect(tap).toMatch(/const result = engine\.arSupport\.placeAvatarAtReticle\(/);
        expect(tap).toMatch(/AR\.afterPlaceTap\(result, t\)/);
        expect(tap).toMatch(/if \(next\.voice && !arVoiceActive\) startARVoice\(\)/);
        expect(tap).not.toMatch(/Avatar placed — talk to me!/);
    });

    test('entering AR rebuilds the transcript from the conversation store', () => {
        const start = overlay.indexOf("window.addEventListener('ar-session-start'");
        expect(overlay.slice(start, start + 300)).toContain('seedARTranscript()');
        const seed = fnBody('function seedARTranscript() {');
        expect(seed).toContain("arChat.innerHTML = ''");
        expect(seed).toMatch(/_surface\(\)\.history\(\)\.getHistory\(\)/);
        expect(seed).toMatch(/AR\.seedTranscript\(history\)/);
    });

    test('mirroring writes to AR only while AR is open', () => {
        const mirror = fnBody('function appendARBubble(role, text) {');
        expect(mirror).toMatch(/if \(!overlay\.classList\.contains\('ar-active'\)\) return;/);
    });

    test('a real placement ends the coaching card; the module loads after it', () => {
        expect(read('src/gltf-viewer/ARCoachingOverlay.js')).toMatch(
            /addEventListener\('ar-avatar-placed', onARAvatarPlaced\)/
        );
        const html = read('index.html');
        const coaching = html.indexOf('src/gltf-viewer/ARCoachingOverlay.js');
        expect(html.indexOf('src/gltf-viewer/ARConversation.js')).toBeGreaterThan(coaching);
    });
});
