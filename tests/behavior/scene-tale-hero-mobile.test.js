/**
 * A26. The Scene Tale scene picture, on the screens and the screen sizes it was missing from.
 *
 * Two failures are pinned here.
 *
 * The first is a refusal: `insertHero` required `.nexus-story-shell`, which only the Conversation
 * presentation builds. StoryPlayer's own fallback HUD has no shell, so the one screen that names
 * the place nowhere else — no heading, no place line — was the only screen with no picture of it.
 *
 * The second is geometry, and jsdom has no layout, so the CSS *contract* is what is asserted: the
 * hero must declare its own flex (the mobile shell is a flex column and would otherwise be free to
 * resize the one child that carries the scene) and its height cap must be viewport-relative on a
 * short screen. Measured before the fix at 740x360, a phone on its side: a flat 150px hero inside
 * a 416px shell, so the narration and both choice buttons were off the bottom of a 360px viewport.
 * Measured after: 94px hero, 359px shell.
 *
 * These assert properties, not spellings — a rule may be rewritten freely as long as the hero
 * still pins its flex and still stops growing when the viewport is short.
 */

/* global describe, test, expect, beforeEach, afterEach */

const fs = require('fs');
const path = require('path');

window.__NEXUS_SCENE_TALE_MOBILE_NOAUTO__ = true;

const ROOT = path.resolve(__dirname, '../..');
const ART_VIEW_SRC = fs.readFileSync(path.join(ROOT, 'src/features/together/ui/SceneTaleArtView.js'), 'utf8');

const ArtView = require('../../src/features/together/ui/SceneTaleArtView.js');
const MobileMode = require('../../src/features/together/ui/SceneTaleMobileMode.js');

const SCENE = { sceneId: 'ambient:terrace:night', sceneLabel: 'Coastal Terrace · Twilight' };

/** Every declaration block whose selector mentions the hero, with whitespace squeezed out. */
function heroRules(css) {
    const rules = [];
    const re = /([^{}]*nexus-scene-tale-hero[^{}]*)\{([^{}]*)\}/g;
    let match;
    while ((match = re.exec(css))) {
        rules.push({ selector: match[1].replace(/\s+/g, ' ').trim(), body: match[2].replace(/\s+/g, '') });
    }
    return rules;
}

function planWindow() {
    window.NEXUS_BD = {
        togetherPanel: {
            activities: new Map([['playground', { player: { plan: SCENE } }]]),
        },
    };
    return window;
}

beforeEach(() => {
    ArtView.detach();
    document.body.innerHTML = '';
});

afterEach(() => {
    ArtView.detach();
    delete window.NEXUS_BD;
    document.body.innerHTML = '';
});

describe('Scene Tale hero art attaches everywhere', () => {
    test('attaches to the shell-less fallback HUD, above the narration card', async () => {
        document.body.innerHTML = `
            <div id="nexus-scene-tale-hud">
                <div class="nexus-story-card">Narration</div>
                <div class="nexus-story-bar"></div>
            </div>`;
        const hud = document.getElementById('nexus-scene-tale-hud');

        expect(await ArtView.decorate(hud, planWindow())).toBe(true);

        const hero = hud.querySelector(`.${ArtView.HERO_CLASS}`);
        expect(hero).not.toBeNull();
        expect(hero.nextElementSibling.className).toBe('nexus-story-card');
        expect(hero.dataset.sceneId).toBe(SCENE.sceneId);
        expect(hero.querySelector('img').getAttribute('src')).toMatch(/^assets\/ambient\/.+\.webp$/);
    });

    test('still sits between the heading and the card when Conversation built a shell', async () => {
        document.body.innerHTML = `
            <div id="nexus-scene-tale-hud">
                <div class="nexus-story-shell">
                    <div class="nexus-story-heading">Title</div>
                    <div class="nexus-story-card">Narration</div>
                </div>
            </div>`;
        const hud = document.getElementById('nexus-scene-tale-hud');

        expect(await ArtView.decorate(hud, planWindow())).toBe(true);

        const shell = hud.querySelector('.nexus-story-shell');
        const hero = shell.querySelector(`.${ArtView.HERO_CLASS}`);
        expect(hero.previousElementSibling.className).toBe('nexus-story-heading');
        expect(hero.nextElementSibling.className).toBe('nexus-story-card');
    });

    test('decorating twice reuses the one picture instead of stacking them', async () => {
        document.body.innerHTML = '<div id="nexus-scene-tale-hud"><div class="nexus-story-card">N</div></div>';
        const hud = document.getElementById('nexus-scene-tale-hud');
        const win = planWindow();
        await ArtView.decorate(hud, win);
        await ArtView.decorate(hud, win);
        expect(hud.querySelectorAll(`.${ArtView.HERO_CLASS}`)).toHaveLength(1);
    });
});

describe('Scene Tale hero geometry contract', () => {
    test('the hero pins its own flex, so the mobile flex column cannot resize it', () => {
        expect(heroRules(ArtView.CSS).some((rule) => /(^|;)flex:00auto/.test(rule.body))).toBe(true);
        expect(heroRules(MobileMode.CSS).some((rule) => /(^|;)flex:00auto!important/.test(rule.body))).toBe(true);
    });

    test('a short viewport caps the picture against the viewport, not at a constant', () => {
        const artCaps = heroRules(ArtView.CSS).filter((rule) => /max-height:[^;]*vh/.test(rule.body));
        expect(artCaps.length).toBeGreaterThan(0);

        // Whatever the mobile sheet says about height, it has to be bounded by the viewport:
        // a bare pixel constant is what put the story off the bottom of a landscape phone.
        const mobileHeights = heroRules(MobileMode.CSS).filter((rule) => /max-height:/.test(rule.body));
        expect(mobileHeights.length).toBeGreaterThan(0);
        for (const rule of mobileHeights) expect(rule.body).toMatch(/max-height:[^;]*vh/);
    });

    test('object-fit is on the image, where it does something, and not on the wrapper', () => {
        for (const rule of heroRules(MobileMode.CSS)) {
            if (!/object-fit:/.test(rule.body)) continue;
            expect(rule.selector).toMatch(/img\s*$/);
        }
    });

    test('the art view still names no way to select or change a viewport background', () => {
        expect(ART_VIEW_SRC).not.toMatch(/setDesktopBackground|NEXUS_VIEWER|BACKGROUND_MANAGER|reapplyCurrent/);
    });
});
