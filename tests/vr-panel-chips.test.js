/**
 * VR1 — the VR chat panel has no quick chips, and says why AR is unavailable over Quest Link.
 *
 * Pinned: no "Summarize" / "Explain" / "Continue" chips are laid out, hit-tested, drawn or handled;
 * pressing an AR button where AR is unsupported explains it once in the panel (a headset cannot
 * show the console line that used to be the only answer).
 */

const fs = require('fs');
const path = require('path');
const THREE = require('../vendor/three-0.147.0/build/three.min.js');

const read = (f) => fs.readFileSync(path.resolve(__dirname, '../src/gltf-viewer', f), 'utf-8');
const panelSrc = read('VRChatPanel.js');
const integrationSrc = read('VRChatIntegration.js');
const code = (src) =>
    src
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

describe('no quick chips', () => {
    test('nothing lays out, hit-tests or draws a chip', () => {
        const panel = code(panelSrc);
        expect(panel).not.toMatch(/q_sum|q_exp|q_nxt/);
        expect(panel).not.toMatch(/['"]Summarize['"]|['"]Explain['"]|['"]Continue['"]/);
        expect(panel).not.toMatch(/Chip:|L\.chips|chipBg|chipText/);
    });

    test('and nothing sends a chip label as a message', () => {
        const integration = code(integrationSrc);
        expect(integration).not.toMatch(/startsWith\('Chip:'\)|handleQuickPrompt/);
    });
});

describe('AR over Quest Link', () => {
    const src = panelSrc.replace(/^import .*$/gm, '').replace(/^export class VRChatPanel/m, 'class VRChatPanel');
    // eslint-disable-next-line no-new-func
    const VRChatPanel = new Function('THREE', `${src}\nreturn VRChatPanel;`)(THREE);

    test('the first press explains it in the panel; further presses add nothing', () => {
        const panel = Object.create(VRChatPanel.prototype);
        panel.appendMessage = jest.fn();
        panel._explainNoAR();
        panel._explainNoAR();
        expect(panel.appendMessage).toHaveBeenCalledTimes(1);
        const [role, text] = panel.appendMessage.mock.calls[0];
        expect(role).toBe('bot');
        expect(text).toMatch(/Quest.s own browser/);
        expect(text).toMatch(/Link/);
    });

    test('both AR buttons explain when AR is unsupported', () => {
        for (const key of ['xr_ar', 'xr_mode']) {
            const start = panelSrc.indexOf(`if (key === '${key}') {`);
            expect(start).toBeGreaterThan(-1);
            const branch = panelSrc.slice(start, panelSrc.indexOf('return true;', start));
            expect(branch).toMatch(/!this\.xrSettings\.arSupported[\s\S]*this\._explainNoAR\(\)/);
        }
    });
});
