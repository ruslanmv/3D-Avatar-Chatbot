/**
 * LT8. The stage's action row fits the stage it is drawn on.
 *
 * On desktop the stage beside the conversation is about 230px wide, and the four
 * long labels (nowrap) painted over each other — worst in Italian. The stage's own
 * width now switches to the short labels, and a label never overflows its button.
 */
const { TryOnStageExperience } = require('../../src/wardrobe/TryOnStageExperience');

describe('try-on stage action labels', () => {
    test('a narrow stage shows the short labels and clips inside the button', () => {
        document.body.innerHTML =
            '<div class="avatar-preview-wrap"><div id="avatar-viewport"></div></div><div id="nexus-try-on-view"></div>';
        const stage = new TryOnStageExperience({
            doc: document,
            view: { root: document.getElementById('nexus-try-on-view'), collapsed: true },
            session: { state: () => ({ looks: [], look: null, favorite: false, busy: false }) },
        });
        try {
            stage.mount();
            const css = Array.from(document.querySelectorAll('style'))
                .map((s) => s.textContent)
                .join('\n');
            expect(css).toMatch(/\.nexus-stage-info\{container-type:inline-size\}/);
            expect(css).toMatch(/\.nexus-stage-action\{overflow:hidden/);
            const rule = css.match(/@container \(max-width:(\d+)px\)\{([^@]*)\}/);
            expect(rule).toBeTruthy();
            expect(Number(rule[1])).toBeGreaterThanOrEqual(400);
            expect(rule[2]).toMatch(/\.nexus-stage-long\{display:none\}/);
            expect(rule[2]).toMatch(/\.nexus-stage-short\{display:inline\}/);
            stage.render({ looks: [], look: null, favorite: false, busy: false, total: 0 });
            const buttons = document.querySelectorAll('.nexus-stage-action');
            expect(buttons.length).toBeGreaterThan(0);
            buttons.forEach((b) => {
                expect(b.querySelector('.nexus-stage-short')).toBeTruthy();
                expect(b.getAttribute('aria-label')).toBe(b.querySelector('.nexus-stage-long').textContent);
            });
        } finally {
            stage.unmount();
            document.body.innerHTML = '';
        }
    });
});
