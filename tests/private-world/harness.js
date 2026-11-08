/**
 * PW. The shared fixture for the Private World tests and scenarios. Not a test file itself.
 *
 * Real: the experience config, the world catalogue, mood presets, the venue template,
 * WorldPresence and WorldSpots (the cabaret's measured spots), and the room session attach()
 * gives presence. Fake: the renderer runtime, the playground router and BehaviorRouter — they
 * answer exactly as the real owners do. Fixtures are non-explicit on purpose.
 */
const fs = require('fs');
const path = require('path');
const PW = require('../../src/experiences/private/PrivateWorldAdapter.js');
const Presence = require('../../src/companion/WorldPresence.js');
const Spots = require('../../src/gltf-viewer/WorldSpots.js');
const Worlds = require('../../src/gltf-viewer/VRWorlds.js');
const Moods = require('../../src/experiences/playgrounds/PlaygroundMoodPresets.js');
const Templates = require('../../src/experiences/playgrounds/PlaygroundTemplateCatalog.js');
const Prompt = require('../../src/companion/PromptContext.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const worlds = Worlds.validateCatalogue(read('assets/vr-worlds/worlds.json')).worlds;
const rawConfig = read('assets/vr-worlds/private/private-sanctuary.json');
const ctx = {
    worlds,
    preset: (id) => Moods.get(id),
    template: (id) => Templates.TEMPLATES.find((t) => t.id === id),
};
const cabaret = worlds.find((w) => w.id === 'private-cabaret');
const spotsFile = read('assets/vr-worlds/spots/cabaret-stage.json');
const verified = Spots.normalize(spotsFile).spots;
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(options) {
    const o = options || {};
    const answers = { deployment: true, attested: true, privateOpen: true, world: true, avatarAdult: true, ...o.gate };
    const rt = {
        activeId: 'private-cabaret',
        spotId: null,
        sceneSrc: cabaret.scene.src,
        scenePlacement: { at: cabaret.scene.at.slice(), turn: cabaret.scene.turn, scale: 1 },
        moods: [],
        fail: false,
        setMood: jest.fn((light) => (rt.moods.push(light), true)),
        goToSpot: jest.fn(async (spot) => {
            if (rt.fail) return { ok: false, why: 'renderer-error' };
            rt.spotId = spot.id;
            return { ok: true };
        }),
    };
    const gate = () => PW.evaluateGate(answers);
    // What attach() gives presence: Intimate runs no companion session, so the room's own.
    const session = PW.roomSession(() => gate().ok);
    const presence = Presence.create({
        runtime: () => rt,
        spotsApi: { ...Spots, load: async () => Spots.normalize(spotsFile) },
        session,
        destinations: () => [],
        privateGate: () => gate().ok,
        lightsOffered: true,
    });
    const reports = [];
    const router = {
        template: Templates.TEMPLATES.find((t) => t.id === 'private-cabaret'),
        act: jest.fn((id) => reports.push(id)),
    };
    let chipAnswer = 'started';
    const behavior = { request: jest.fn(() => ({ ok: true, applied: 'behavior', channel: 'gaze' })) };
    const events = [];
    const config = PW.validateConfig(rawConfig, ctx).config;
    const core = PW.create({
        gate,
        presence,
        runtime: () => rt,
        preset: (id) => Moods.get(id),
        router: () => router,
        behavior,
        gazePoint: (a) => (a === 'stage' ? { x: 0.1, y: 0.2 } : null),
        waitFor: async () => chipAnswer,
        config,
        emit: (name, detail) => events.push({ name, detail }),
    });
    presence.onWorldShown({
        id: 'private-cabaret',
        base: 'private-cabaret',
        title: 'Private cabaret',
        rating: 'private',
    });
    return {
        core,
        presence,
        rt,
        router,
        behavior,
        answers,
        events,
        session,
        setChip: (p) => (chipAnswer = p),
    };
}

module.exports = {
    fs,
    path,
    PW,
    Presence,
    Spots,
    Moods,
    Templates,
    Prompt,
    ROOT,
    read,
    worlds,
    rawConfig,
    ctx,
    cabaret,
    spotsFile,
    verified,
    flush,
    setup,
};
