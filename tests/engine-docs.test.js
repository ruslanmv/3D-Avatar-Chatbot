/**
 * The engine documentation (docs/engine/) is held to the code: every repository path it names
 * exists (unless the line says the thing is proposed), every function it cites is defined, the
 * spot tables agree with the measured files, and the templates parse — the ones marked EXISTS
 * through the real validators. A doc that drifts from the code fails here, not in an agent's hands.
 */
const fs = require('fs');
const path = require('path');
const Worlds = require('../src/gltf-viewer/VRWorlds.js');
const Spots = require('../src/gltf-viewer/WorldSpots.js');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs/engine');
const walk = (dir) =>
    fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const markdown = walk(DOCS).filter((f) => f.endsWith('.md'));
const read = (p) => fs.readFileSync(p, 'utf8');

describe('docs/engine exists and links where it says', () => {
    test.each([
        'AI_CODER_START_HERE.md',
        'NEXUS_AI_ARCHITECTURE.md',
        'NEXUS_SPATIAL_COORDINATES.md',
        'NEXUS_WORLD_ASSET_PIPELINE.md',
        'NEXUS_WORLD_ENGINE_DESIGN.md',
        'HOW_TO_CREATE_A_NEXUS_WORLD.md',
        'HOW_TO_ADD_COMPANION_BEHAVIORS.md',
        'HOW_TO_CREATE_DYNAMIC_STORIES.md',
        'NEXUS_UNIVERSE_ROADMAP.md',
        'PROMPT_CREATE_NEW_WORLD.md',
        'ENGINE_DOCUMENTATION_REPORT.md',
        'tutorials/A_PREMIUM_APARTMENT.md',
        'tutorials/B_NIGHTCLUB.md',
        'tutorials/C_FOREST_ADVENTURE.md',
        'PRIVATE_WORLD_ENGINE.md',
        'HOW_TO_CREATE_A_PRIVATE_WORLD.md',
        'PREMIUM_INTERACTION_CONTRACTS.md',
        'PREMIUM_BEHAVIOR_AUTHORING.md',
        'NEXUS_ADULT_EXPERIENCE_ARCHITECTURE.md',
    ])('%s', (name) => {
        expect(fs.existsSync(path.join(DOCS, name))).toBe(true);
    });

    test('every repository path named in backticks exists (proposed lines excepted)', () => {
        const missing = [];
        const PATH = /`((?:src|tools|assets|tests|docs|kb|scripts|vendor)\/[A-Za-z0-9_./-]+)`/g;
        for (const file of markdown) {
            for (const line of read(file).split('\n')) {
                if (/propos|future|PROPOSED/i.test(line)) continue;
                for (const m of line.matchAll(PATH)) {
                    const p = m[1].replace(/[.,;:]+$/, '');
                    if (/<|\*|example-|your-world/.test(p)) continue;
                    if (!fs.existsSync(path.join(ROOT, p))) missing.push(`${path.relative(ROOT, file)}: ${p}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    test('every function the architecture doc cites is defined in the source', () => {
        const where = {
            'src/main.js': [
                'handleUserMessage',
                '_handleStreamingResponse',
                '_handleNonStreamingResponse',
                'callLLM',
                '__nexusMediaSuffix',
                'speakText',
                'addMessageToHistory',
            ],
            'src/gltf-viewer/VRWorlds.js': [
                'goToSpot',
                'resolveFor',
                'placesFor',
                'framingFor',
                'comfortProblem',
                'buildPlace',
                'setMood',
            ],
            'src/gltf-viewer/WorldSpots.js': ['placementFor', 'spotAtPlacement', 'intentOf', 'normalize', 'fileFor'],
            'src/companion/WorldPresence.js': [
                'observeUser',
                'consumeReply',
                'promptSuffix',
                'goOffer',
                'setMood',
                'destinationsFor',
                'onWorldShown',
            ],
            'src/companion/BehaviorRouter.js': ['request', 'CHANNELS', 'INTENTS'],
            'src/features/chat/ConversationReset.js': ['onReset', 'currentEpoch', 'isCurrent'],
            'src/companion/index.js': ['noticeTopic', 'contextSuffix', 'consume'],
            'src/behavior/boot.js': ['handleIntent'],
            'src/gltf-viewer/CameraPresets.js': ["case 'mid'", 'transitionTo'],
            'src/features/together/activities/playground.js': ['validateStoryPlan'],
        };
        for (const [file, names] of Object.entries(where)) {
            const src = read(path.join(ROOT, file));
            for (const n of names) expect(`${file}: ${n} ${src.includes(n)}`).toBe(`${file}: ${n} true`);
        }
    });
});

describe('the spatial doc says what the measured files say', () => {
    const doc = read(path.join(DOCS, 'NEXUS_SPATIAL_COORDINATES.md'));
    test.each(['pixel-flat-home', 'bedroom-flat', 'cabaret-stage', 'cabaret-stage-light'])(
        '%s: every verified spot is in the table with its numbers',
        (stem) => {
            const file = JSON.parse(read(path.join(ROOT, 'assets/vr-worlds/spots', stem + '.json')));
            expect(doc).toContain(file.sha256.slice(0, 16));
            for (const s of file.spots.filter((x) => x.verified)) {
                const fmt = (v) => (v < 0 ? '−' : '') + String(Math.abs(v)).replace(/^0(?=\.)/, '0');
                expect(doc).toContain(s.id);
                expect(doc).toContain(`${fmt(s.position[0])}`);
            }
            for (const s of file.spots.filter((x) => !x.verified))
                expect(doc).toMatch(new RegExp(s.id + '[^\\n]*unverified'));
        }
    );
});

describe('templates', () => {
    const T = (n) => JSON.parse(read(path.join(DOCS, 'templates', n)));
    test('every JSON template parses and says whether its shape EXISTS, is PARTIAL or PROPOSED', () => {
        for (const f of fs.readdirSync(path.join(DOCS, 'templates')).filter((x) => x.endsWith('.json'))) {
            const j = T(f);
            expect(`${f}: ${/^(EXISTS|PARTIAL|PROPOSED|GENERATED)/.test(j._status)}`).toBe(`${f}: true`);
        }
    });
    test('the world and variant templates pass the real catalogue validator', () => {
        const r = Worlds.validateCatalogue({
            worlds: [T('world.manifest.example.json'), T('scene-variant.example.json')],
        });
        expect(r.problems).toEqual([]);
        expect(r.worlds.map((w) => w.id)).toEqual(['example-loft', 'example-loft-light']);
    });
    test('the generated-spots template is the real file shape: one kept, the unverified one dropped', () => {
        const n = Spots.normalize(T('spots.example.json'));
        expect(n.spots.map((s) => s.id)).toEqual(['window-seat']);
    });
    test('the spot-targets template has what measure-spots.mjs reads', () => {
        const t = T('spot-targets.example.json')['scenes/example-loft.glb'];
        for (const s of t.spots)
            for (const k of ['id', 'label', 'room', 'near', 'can', 'sees', 'rating']) expect(s).toHaveProperty(k);
    });
    test('the private-world template passes the real experience-config validator', () => {
        const PW = require('../src/experiences/private/PrivateWorldAdapter.js');
        const Moods = require('../src/experiences/playgrounds/PlaygroundMoodPresets.js');
        const Templates = require('../src/experiences/playgrounds/PlaygroundTemplateCatalog.js');
        const { _status, ...config } = T('private-world.example.json');
        expect(_status).toMatch(/^EXISTS/);
        const worlds = Worlds.validateCatalogue(
            JSON.parse(read(path.join(ROOT, 'assets/vr-worlds/worlds.json')))
        ).worlds;
        const v = PW.validateConfig(config, {
            worlds,
            preset: (id) => Moods.get(id),
            template: (id) => Templates.TEMPLATES.find((t) => t.id === id),
        });
        expect(v.problems).toEqual([]);
        // …and copied with _status still in it, it is refused whole, as the template says.
        expect(PW.validateConfig({ _status, ...config }, { worlds, preset: Moods.get, template: () => null }).ok).toBe(
            false
        );
    });
    test('the anchor template is copied from the real catalogue', () => {
        const src = read(path.join(ROOT, 'src/experiences/playgrounds/PlaygroundTemplateCatalog.js'));
        const a = T('object.anchor.example.json');
        expect(src).toContain(`{ id: '${a.id}', label: '${a.label}', at: [${a.at.join(', ')}], space: '${a.space}' }`);
    });
});
