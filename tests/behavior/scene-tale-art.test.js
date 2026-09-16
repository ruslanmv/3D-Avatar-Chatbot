const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const BACKGROUNDS = path.join(ROOT, 'assets/ambient/backgrounds.json');
const SCENE_TALE_ART = path.join(ROOT, 'assets/ambient/scene-tale-art.json');
const ART_VIEW = path.join(ROOT, 'src/features/together/ui/SceneTaleArtView.js');
const PUBLISHER = path.join(ROOT, 'src/features/together/ui/ConversationPublisher.js');

describe('Scene Tale canonical scene art', () => {
    const backgrounds = JSON.parse(fs.readFileSync(BACKGROUNDS, 'utf8'));
    const art = JSON.parse(fs.readFileSync(SCENE_TALE_ART, 'utf8'));

    test('covers every registered ambience scene exactly once', () => {
        const backgroundIds = backgrounds.scenes.map((scene) => scene.id).sort();
        const artIds = art.scenes.map((scene) => scene.id).sort();
        expect(new Set(artIds).size).toBe(artIds.length);
        expect(artIds).toEqual(backgroundIds);
    });

    test('reuses real production landscape and portrait files for hero and thumbnail art', () => {
        for (const scene of art.scenes) {
            expect(scene.hero).toBe(scene.thumbnail);
            for (const key of ['hero', 'thumbnail', 'portrait']) {
                const relative = scene[key];
                expect(typeof relative).toBe('string');
                expect(relative.startsWith('assets/ambient/')).toBe(true);
                expect(fs.existsSync(path.join(ROOT, relative))).toBe(true);
            }
        }
    });

    test('stays aligned with the ambience catalogue paths', () => {
        const byId = new Map(backgrounds.scenes.map((scene) => [scene.id, scene]));
        for (const scene of art.scenes) {
            const ambient = byId.get(scene.id);
            expect(ambient).toBeTruthy();
            expect(scene.hero).toBe(ambient.src);
            expect(scene.thumbnail).toBe(ambient.thumb);
            expect(scene.portrait).toBe(ambient.srcPortrait);
            expect(scene.label).toBe(`${ambient.label} · ${ambient.variantLabel}`);
        }
    });

    test('ConversationPublisher loads the art view and the art view reads the canonical manifest', () => {
        const publisher = fs.readFileSync(PUBLISHER, 'utf8');
        const view = fs.readFileSync(ART_VIEW, 'utf8');
        expect(publisher).toContain('SceneTaleArtView.js');
        expect(publisher).toContain('ensureSceneTaleArtView');
        expect(view).toContain("assets/ambient/scene-tale-art.json");
        expect(view).toContain('nexus-scene-tale-hero');
    });
});
