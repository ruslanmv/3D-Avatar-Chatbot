/**
 * UN27. The closer positions in Private: asked for in words, gated like all fours, described to
 * the model as her body really is, and offered in the ⋯ menu only when they can run.
 *
 * Properties, not prose: a reworded description must not fail these; a position that runs below
 * the top of the pace, a chip whose line does not parse back to its own position, or a reply told
 * a key instead of a body, must.
 */
const Intent = require('../src/experiences/private/PrivateActionIntent.js');
const Policy = require('../src/experiences/private/PrivateActionPolicy.js');
const Poses = require('../src/experiences/private/PrivatePoseController.js');

const CLOSER = [
    'sit-open',
    'kneel-wide',
    'knees-up',
    'straddle',
    // UN38.
    'face-down',
    'legs-up',
    'bent-over',
    'spoon',
    'reverse',
    'on-knees',
];
const pose = (said) => {
    const r = Intent.parse(said, {});
    return r && r.name === 'avatar.pose' ? r.params.pose : null;
};

describe('UN27 closer positions: keys and gates', () => {
    test.each(CLOSER)('%s maps to an adult Pose Studio preset', (key) => {
        expect(Poses.POSES[key]).toBeDefined();
        expect(Poses.POSES[key].adult).toBe(true);
        expect(Policy.ADULT_POSES).toContain(key);
    });

    test.each(CLOSER)('%s opens at its own step of the pace and never below, even when asked', (key) => {
        const need = Policy.poseLevel(key);
        expect(need).toBeGreaterThanOrEqual(2);
        const action = { name: 'avatar.pose', params: { pose: key }, source: 'user' };
        for (let level = 0; level < need; level++)
            expect(Policy.decide(action, { active: true, level })).toMatchObject({ allow: false, why: 'pace' });
        for (let level = need; level <= 4; level++)
            expect(Policy.decide(action, { active: true, level }).allow).toBe(true);
    });

    test('UN28 the steps climb: something at Romantic, more at Sensual, the explicit ones at Intimate', () => {
        const at = (n) => Policy.ADULT_POSES.filter((k) => Policy.poseLevel(k) <= n).sort();
        expect(at(1)).toEqual([]);
        expect(at(2)).toEqual(['kneel-wide']);
        expect(at(3)).toEqual(['kneel-wide', 'sit-open', 'straddle']);
        // UN38. The six added at the top open there too, with the two explicit ones before them.
        expect(at(4)).toEqual(
            [
                'all-fours',
                'kneel-wide',
                'knees-up',
                'sit-open',
                'straddle',
                'face-down',
                'legs-up',
                'bent-over',
                'spoon',
                'reverse',
                'on-knees',
            ].sort()
        );
        // Undressing still waits for the top, whatever the positions do.
        expect(Policy.UNDRESS_LEVEL).toBe(4);
        expect(Policy.poseLevel('kneel')).toBe(0);
    });

    test.each(CLOSER)('%s is never hers to take on her own', (key) => {
        const action = { name: 'avatar.pose', params: { pose: key }, source: 'model' };
        expect(Policy.decide(action, { active: true, level: 4, asked: {} }).allow).toBe(false);
    });

    test('every closer position has a body description and a short name; all fours is listed too', () => {
        const keys = Poses.INTIMATE.map((p) => p.key);
        expect(keys).toEqual(expect.arrayContaining([...CLOSER, 'all-fours']));
        for (const p of Poses.INTIMATE) {
            expect(p.name.length).toBeGreaterThan(5);
            expect(Poses.BODY[p.key].length).toBeGreaterThan(20);
        }
        for (const key of Object.keys(Poses.POSES)) expect(typeof Poses.BODY[key]).toBe('string');
    });
});

describe('UN27 closer positions: words', () => {
    test.each([
        ['Siediti a gambe aperte', 'sit-open'],
        ['apri le gambe', 'sit-open'],
        ['Mettiti in ginocchio a gambe aperte', 'kneel-wide'],
        ['Sdraiati sulla schiena con le ginocchia alzate', 'knees-up'],
        ['Mettiti a cavalcioni su di me', 'straddle'],
        ['Sit with your legs open', 'sit-open'],
        ['Kneel with your knees apart', 'kneel-wide'],
        ['Lie on your back with your knees up', 'knees-up'],
        ['Straddle me', 'straddle'],
        ['Mets-toi à genoux, les genoux écartés', 'kneel-wide'],
        ['仰向けで膝を立てて', 'knees-up'],
        ['跨坐在我身上', 'straddle'],
    ])('"%s" is %s', (said, key) => expect(pose(said)).toBe(key));

    test.each([
        ['mettiti in ginocchio', 'kneel'],
        ['sdraiati sulla schiena', 'lie-back'],
        ['mettiti a quattro zampe', 'all-fours'],
        ['仰向けになって', 'lie-back'],
    ])('the plainer "%s" is still %s', (said, key) => expect(pose(said)).toBe(key));

    test.each(['siediti', 'sit down', 'open the window', 'apri la finestra'])('"%s" is not a closer position', (said) =>
        expect(CLOSER).not.toContain(pose(said))
    );
});

describe('UN27 the ⋯ menu: every chip line is its own position, in every language', () => {
    const Locale = require('../src/features/together/PrivateLocale.js');
    const KEYS = ['sit-open', 'kneel-wide', 'knees-up', 'straddle', 'all-fours'];
    for (const lang of Locale.languages()) {
        test.each(KEYS)(`${lang}: the %s chip sends a line that parses back to it`, (key) => {
            const line = Locale.t(`position.${key}.say`, null, lang);
            const label = Locale.t(`position.${key}.label`, null, lang);
            expect(line).not.toBe(`position.${key}.say`);
            expect(label).not.toBe(`position.${key}.label`);
            expect(pose(line)).toBe(key);
        });
    }
});

describe('UN27 the ⋯ menu: position chips', () => {
    const Private = require('../src/features/together/ui/PrivateConversationView.js');
    require('../src/features/together/PrivateLocale.js');
    let view;
    let spicy;
    const q = (sel) => document.querySelector(`#${Private.ROW_ID} ${sel}`);
    const chips = () => Array.from(document.querySelectorAll(`#${Private.ROW_ID} .nexus-private-position`));

    beforeEach(() => {
        document.body.innerHTML = '<div class="chat-input-shell"></div><div id="chat-history"></div>';
        spicy = true;
        window.NEXUS_SPICY = { isEnabled: () => spicy };
        window.NEXUS_PRIVATE_ACTION_POLICY = Policy;
        view = new Private.View({ doc: document, win: window });
        view.mount({ scene: 'Private cabaret' });
    });
    afterEach(() => {
        if (view) view.destroy();
        delete window.NEXUS_SPICY;
        document.body.innerHTML = '';
    });

    test('each chip appears at its own step: none at Warm, then more with every step, and back down', () => {
        const sent = [];
        const at = (level) => {
            view.setPace({ level, steps: [], hasLadder: false });
            return chips().map((b) => b.dataset.privatePosition);
        };
        view.showActions({}, { onPosition: (line, key) => sent.push([line, key]) });
        expect(at(1)).toEqual([]);
        expect(at(2)).toEqual(['kneel-wide']);
        expect(at(3)).toEqual(['sit-open', 'kneel-wide', 'straddle']);
        expect(at(4)).toEqual(KEYS_IN_ORDER);
        if (view._more && view._more.sync) view._more.sync();
        expect(q('.nexus-private-more').hidden).toBe(false);
        expect(at(2)).toEqual(['kneel-wide']);
        expect(at(1)).toEqual([]);
    });

    test('a tap sends the line as their turn, nothing else', () => {
        const sent = [];
        view.showActions({}, { onPosition: (line, key) => sent.push([line, key]) });
        view.setPace({ level: 4, steps: [], hasLadder: false });
        chips()
            .find((b) => b.dataset.privatePosition === 'straddle')
            .click();
        expect(sent).toEqual([['Straddle me', 'straddle']]);
    });

    test('not with Spicy off, and not without a session to speak through', () => {
        view.setPace({ level: 4, steps: [], hasLadder: false });
        expect(chips()).toHaveLength(0); // no handler yet
        spicy = false;
        view.showActions({}, { onPosition: () => {} });
        expect(chips()).toHaveLength(0);
        spicy = true;
        view.showActions({}, { onPosition: () => {} });
        expect(chips()).toHaveLength(KEYS_IN_ORDER.length);
        view.showActions({}); // the session's reset
        expect(chips()).toHaveLength(0);
    });
});

const KEYS_IN_ORDER = [
    'sit-open',
    'kneel-wide',
    'knees-up',
    'straddle',
    'all-fours',
    // UN38.
    'face-down',
    'legs-up',
    'bent-over',
    'spoon',
    'reverse',
    'on-knees',
];

test('UN27 floorOpen stays out of every list until it rests on the floor', () => {
    const fs = require('fs');
    const read = (f) => fs.readFileSync(require('path').join(__dirname, '..', f), 'utf8');
    expect(Poses.POSES['floor-open']).toBeUndefined();
    expect(read('src/PoseStudioPanel.js')).not.toMatch(/name: 'floorOpen'/);
    const vps = read('src/gltf-viewer/VRPoseSystem.js');
    const order = vps.slice(
        vps.indexOf('const PRESET_ORDER = ['),
        vps.indexOf('];', vps.indexOf('const PRESET_ORDER'))
    );
    expect(order).not.toMatch(/'floorOpen'/);
});

describe('UN27 the ⋯ menu: chips before any action', () => {
    const Private = require('../src/features/together/ui/PrivateConversationView.js');
    test('setPositionHandler alone is enough to draw them at the top of the pace', () => {
        document.body.innerHTML = '<div class="chat-input-shell"></div><div id="chat-history"></div>';
        window.NEXUS_SPICY = { isEnabled: () => true };
        const view = new Private.View({ doc: document, win: window });
        view.mount({ scene: 'Private cabaret' });
        view.setPositionHandler(() => {});
        view.setPace({ level: 4, steps: [], hasLadder: false });
        expect(document.querySelectorAll('.nexus-private-position')).toHaveLength(KEYS_IN_ORDER.length);
        view.setPositionHandler(null);
        expect(document.querySelectorAll('.nexus-private-position')).toHaveLength(0);
        view.destroy();
        delete window.NEXUS_SPICY;
    });
});

describe('OL3 her position remembered: open and close are relative to where she is', () => {
    test.each([
        ['open', null, 'sit-open'],
        ['open', 'lie-back', 'knees-up'],
        ['open', 'knees-up', 'knees-up'],
        ['open', 'kneel', 'kneel-wide'],
        ['open', 'all-fours', 'all-fours'],
        ['open', 'lie-front', 'lie-front'],
        ['close', 'knees-up', 'lie-back'],
        ['close', 'kneel-wide', 'kneel'],
        ['close', 'sit-open', 'lounge'],
        ['close', 'kneel', 'kneel'],
        ['close', null, null],
    ])('%s from %s is %s', (verb, held, want) => expect(Poses.transition(verb, held)).toBe(want));

    test('every target is a position she has, and "open" never lands on a seat from the floor', () => {
        for (const row of Object.values(Poses.TRANSITIONS))
            for (const to of Object.values(row)) expect(Poses.POSES[to]).toBeDefined();
        for (const lying of ['lie-back', 'lie-side', 'knees-up'])
            expect(Poses.transition('open', lying)).toBe('knees-up');
    });

    const held = { poseHeld: true };
    test.each([
        ['apri', held, { pose: 'sit-open', rel: 'open' }],
        ['aprile di più', held, { pose: 'sit-open', rel: 'open' }],
        ['open up', held, { pose: 'sit-open', rel: 'open' }],
        ['apri le gambe', {}, { pose: 'sit-open', rel: 'open' }],
        ['siediti a gambe aperte', {}, { pose: 'sit-open' }],
        ['chiudi le gambe', held, { pose: 'lie-back', rel: 'close' }],
        ['close your legs', held, { pose: 'lie-back', rel: 'close' }],
    ])('"%s" → %o', (said, c, want) => {
        const r = Intent.parse(said, c);
        expect(r && r.name).toBe('avatar.pose');
        expect(r.params).toEqual(want);
    });

    test.each(['apri la finestra', 'apri', 'chiudi la porta'])('"%s" is not her legs when nothing asks it', (said) => {
        const r = Intent.parse(said, said === 'apri' ? {} : { poseHeld: true });
        expect(r && r.name === 'avatar.pose' && r.params.rel).toBeFalsy();
    });
});

describe('UN38 six more positions', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const vps = read('src/gltf-viewer/VRPoseSystem.js');
    const panel = read('src/PoseStudioPanel.js');
    const UN38 = ['face-down', 'legs-up', 'bent-over', 'spoon', 'reverse', 'on-knees'];

    test.each(UN38)('%s is its own grounded preset, listed by Pose Studio as adult', (key) => {
        const preset = Poses.POSES[key].preset;
        // Its own block, with what it rests on: grounding is what keeps it off the air.
        const block = new RegExp(`\\n    ${preset}: \\{[\\s\\S]*?\\n    \\},`).exec(vps);
        expect(block).not.toBeNull();
        expect(block[0]).toMatch(/support: \{ ground: \[/);
        expect(block[0]).toMatch(/adult: true/);
        expect(vps).toContain(`'${preset}',`); // PRESET_ORDER
        expect(panel).toMatch(new RegExp(`name: '${preset}'[^}]*adult: true`));
    });

    test.each(UN38)('%s opens only at the top, is described as a body, and closes somewhere plainer', (key) => {
        expect(Policy.poseLevel(key)).toBe(4);
        expect(Poses.BODY[key].split(' ').length).toBeGreaterThan(6);
        expect(Poses.INTIMATE.map((p) => p.key)).toContain(key);
        const closed = Poses.transition('close', key);
        expect(Poses.POSES[closed]).toBeDefined();
        expect(Policy.poseLevel(closed)).toBeLessThanOrEqual(Policy.poseLevel(key));
    });

    test('the plainer words still mean the plainer positions', () => {
        expect(pose('bend over')).toBe('bend-forward');
        expect(pose('straddle me')).toBe('straddle');
        expect(pose('kneel')).toBe('kneel');
        expect(pose('on your side')).toBe('lie-side');
        expect(pose('bend over for me')).toBe('bent-over');
        expect(pose('ride me facing away')).toBe('reverse');
        expect(pose('mettiti in ginocchio davanti a me')).toBe('on-knees');
        expect(pose('faccia in giù e sedere in su')).toBe('face-down');
    });
});
