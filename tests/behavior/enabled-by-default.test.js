/**
 * The Together launcher exists on a fresh install (rollout fix).
 *
 * The engine shipped opt-in, and the cost was not caution — it was that the 👥 button did
 * not exist until somebody found a checkbox in Settings and ticked it. A companion whose
 * every feature sits behind a hidden setup step is not opt-in, it is undiscoverable.
 *
 * The switch is `nexus_bd_enabled` in localStorage, read in exactly two places that must
 * agree: `startBehaviorDirector()` in src/main.js, which is the ignition, and the settings
 * checkbox in index.html, which is what the user sees. When those two disagree the box says
 * one thing and the engine does another — the failure mode a proposed patch for this would
 * have shipped, by changing the checkbox and not the ignition.
 *
 * Read as source rather than executed: `src/main.js` is a 6,000-line script that expects a
 * DOM, a WebGL context and a Three.js scene, and the property under test is one comparison.
 */

/* global describe, test, expect */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const codeOf = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the engine is on unless it was turned off', () => {
    const main = codeOf(read('src/main.js'));
    const html = codeOf(read('index.html'));

    test('the ignition treats an unset key as on', () => {
        expect(main).toMatch(/localStorage\.getItem\('nexus_bd_enabled'\)\s*!==\s*'false'/);
        // The old opt-in comparison is what made a fresh install button-less.
        expect(main).not.toMatch(/localStorage\.getItem\('nexus_bd_enabled'\)\s*===\s*'true'/);
    });

    test('the settings checkbox reads the key the same way', () => {
        // Two readers, one rule. A checkbox that ticks itself while the engine stays down is
        // worse than either default, because it tells the user the opposite of the truth.
        expect(html).toMatch(/getItem\('nexus_bd_enabled'\)\s*!==\s*'false'/);
        expect(html).not.toMatch(/getItem\('nexus_bd_enabled'\)\s*===\s*'true'/);
    });

    test('an explicit opt-out still turns everything off', () => {
        // The kill switch has to survive the default flip, or this is not a rollout, it is a
        // removal of the control.
        expect(main).toMatch(/if\s*\(!window\.NEXUS_BD_ENABLED\)\s*return false;/);
        expect(html).toMatch(/setItem\('nexus_bd_enabled',\s*box\.checked\s*\?\s*'true'\s*:\s*'false'\)/);
    });

    test('unreadable storage does not strand the box ticked and the engine down', () => {
        // Private mode and some embedded webviews throw on localStorage. There is no stored
        // opt-out to honour there, so the default applies — and both readers must agree on
        // that too.
        const ignition = read('src/main.js');
        const block = ignition.slice(ignition.indexOf("localStorage.getItem('nexus_bd_enabled')"));
        expect(block.slice(0, 600)).toMatch(/catch[\s\S]*?return true;/);
    });
});

describe('the config key is not the switch, and the audits still hold', () => {
    test('behaviorEngine.enabled stays false in the shipped config', () => {
        // It is read by nothing at runtime — docs/ENABLING.md calls that out as a known gap —
        // and by two CI audits that assert it is false. Flipping it would break both gates
        // and change no behaviour whatsoever, so the rollout does not touch it.
        const cfg = JSON.parse(read('config/behavior.config.json'));
        expect(cfg.behaviorEngine.enabled).toBe(false);
    });

    test('every capability under the engine keeps its own gate', () => {
        // Turning the engine on grants nothing: no camera, no microphone, no network, no
        // adult tier. That is what makes this default safe to flip.
        const cfg = JSON.parse(read('config/behavior.config.json'));
        expect(cfg.nsfwAllowed).toBe(false);
        expect(cfg.session.enabled).toBe(false);
        expect(cfg.session.tier1Remote).toBe(false);
        expect(cfg.adult.available).toBe(false);
        expect(cfg.behaviorEngine.debug).toBe(false);
    });
});

describe('every control the chooser draws has a rule for it', () => {
    test('More together is styled, not a browser default button', () => {
        // It rendered as a white box with black text in a dark panel: B36 added the
        // disclosure and no CSS. A screenshot caught it; nothing else would have.
        const css = require('../../src/features/together/ui/TogetherLauncher.js').CSS;
        expect(css).toMatch(/\.nexus-bd-together-more\s*\{/);
        expect(css).toMatch(/\.nexus-bd-together-more:hover/);
        expect(css).toMatch(/\.nexus-bd-together-more:focus-visible/);
    });

    test('and so does every other class the panel emits', () => {
        // A standing check rather than a one-off: the next control added without a rule
        // fails here instead of in somebody's screenshot.
        const launcher = require('../../src/features/together/ui/TogetherLauncher.js');
        const panel = require('../../src/features/together/ui/TogetherPanel.js');
        const css = launcher.CSS;
        const emitted = new Set();
        for (const m of require('fs')
            .readFileSync(
                require('path').join(__dirname, '..', '..', 'src/features/together/ui/TogetherPanel.js'),
                'utf8'
            )
            .matchAll(/'(nexus-bd-together-[a-z-]+)'/g)) {
            emitted.add(m[1]);
        }
        expect(emitted.size).toBeGreaterThan(3);
        const unstyled = [...emitted].filter((c) => !css.includes(`.${c}`) && !css.includes(`#${c}`));
        expect({ unstyled, panelId: panel.PANEL_ID }).toEqual({ unstyled: [], panelId: 'nexus-bd-together-panel' });
    });
});
