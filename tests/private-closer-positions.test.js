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

const CLOSER = ['sit-open', 'kneel-wide', 'knees-up', 'straddle'];
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

    test.each(CLOSER)('%s opens only at the top of the pace, even when the person asks', (key) => {
        const action = { name: 'avatar.pose', params: { pose: key }, source: 'user' };
        for (const level of [0, 1, 2, 3]) expect(Policy.decide(action, { active: true, level }).allow).toBe(false);
        expect(Policy.decide(action, { active: true, level: 4 }).allow).toBe(true);
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

    test('none below the top of the pace; all six at it, and the ⋯ appears for them', () => {
        const sent = [];
        view.showActions({}, { onPosition: (line, key) => sent.push([line, key]) });
        view.setPace({ level: 3, steps: [], hasLadder: false });
        expect(chips()).toHaveLength(0);
        view.setPace({ level: 4, steps: [], hasLadder: false });
        expect(chips().map((b) => b.dataset.privatePosition)).toEqual(KEYS_IN_ORDER);
        if (view._more && view._more.sync) view._more.sync();
        expect(q('.nexus-private-more').hidden).toBe(false);
        view.setPace({ level: 2, steps: [], hasLadder: false });
        expect(chips()).toHaveLength(0);
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
        expect(chips()).toHaveLength(5);
        view.showActions({}); // the session's reset
        expect(chips()).toHaveLength(0);
    });
});

const KEYS_IN_ORDER = ['sit-open', 'kneel-wide', 'knees-up', 'straddle', 'all-fours'];

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
        expect(document.querySelectorAll('.nexus-private-position')).toHaveLength(5);
        view.setPositionHandler(null);
        expect(document.querySelectorAll('.nexus-private-position')).toHaveLength(0);
        view.destroy();
        delete window.NEXUS_SPICY;
    });
});
