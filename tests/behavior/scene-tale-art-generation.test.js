const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const PROMPTS = path.join(ROOT, 'tools/scene-tale/scene-art-prompts.json');
const ART = path.join(ROOT, 'assets/ambient/scene-tale-art.json');
const BACKGROUNDS = path.join(ROOT, 'assets/ambient/backgrounds.json');
const GENERATOR = path.join(ROOT, 'tools/scene-tale/generate-scene-tale-art.py');

describe('Scene Tale art generation contract', () => {
    const prompts = JSON.parse(fs.readFileSync(PROMPTS, 'utf8'));
    const art = JSON.parse(fs.readFileSync(ART, 'utf8'));
    const backgrounds = JSON.parse(fs.readFileSync(BACKGROUNDS, 'utf8'));
    const generator = fs.readFileSync(GENERATOR, 'utf8');

    test('has one prompt for every registered Scene Tale generation key', () => {
        const promptKeys = prompts.scenes.map((scene) => scene.key).sort();
        const artKeys = art.scenes.map((scene) => scene.generationKey).sort();
        expect(new Set(promptKeys).size).toBe(promptKeys.length);
        expect(promptKeys).toEqual(artKeys);
        expect(promptKeys).toHaveLength(backgrounds.scenes.length);
    });

    test('defines independent landscape and portrait composition instructions', () => {
        expect(prompts.landscapeComposition).toMatch(/16:9/i);
        expect(prompts.portraitComposition).toMatch(/9:16/i);
        expect(prompts.portraitComposition).toMatch(/independently|recompose/i);
        expect(prompts.sharedPrompt).toMatch(/no people/i);
        expect(prompts.sharedPrompt).toMatch(/no .*text|typography/i);
    });

    test('generator publishes the production backplate dimensions and never contains an API key', () => {
        expect(generator).toContain('LANDSCAPE_FINAL = (1920, 1080)');
        expect(generator).toContain('PORTRAIT_FINAL = (1080, 1920)');
        expect(generator).toContain('OPENAI_API_KEY');
        expect(generator).toContain('gpt-image-2.5-sunburst');
        expect(generator).not.toMatch(/sk-(?:proj-)?[A-Za-z0-9_-]{20,}/);
    });

    test('generator writes only the canonical hero and portrait paths from the manifest', () => {
        for (const scene of art.scenes) {
            expect(scene.hero).toMatch(/^assets\/ambient\/(?:light|dark)\/.+\.webp$/);
            expect(scene.portrait).toMatch(/^assets\/ambient\/(?:light|dark)\/.+-portrait\.webp$/);
            expect(scene.thumbnail).toBe(scene.hero);
        }
        expect(generator).toContain('ROOT / row["hero"]');
        expect(generator).toContain('ROOT / row["portrait"]');
    });
});
