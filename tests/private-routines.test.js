/**
 * UN36. Shows she knows: a series of her positions, each opened at its own step, offered only when
 * every step is open, and asked for in every language the card speaks.
 *
 * Properties, not prose: rewording a show's lines must not fail these; a step that is not one of
 * her positions, a show offered before its steps are open, or a chip line that parses to another
 * show (or steals a position's own words), must.
 */
const Intent = require('../src/experiences/private/PrivateActionIntent.js');
const Policy = require('../src/experiences/private/PrivateActionPolicy.js');
const Poses = require('../src/experiences/private/PrivatePoseController.js');
const Routines = require('../src/experiences/private/PrivateRoutines.js');

const parse = (said, context) => Intent.parse(said, context || {});
const show = (said, context) => {
    const r = parse(said, context);
    return r && r.name === 'avatar.routine' ? r.params : null;
};

describe('UN36 shows: the data', () => {
    test('every step is one of her positions (or a turn), and every show is in the policy', () => {
        for (const id of Routines.ORDER) {
            for (const step of Routines.ROUTINES[id].steps) {
                expect(step.pose === 'turn' || Boolean(Poses.POSES[step.pose])).toBe(true);
                expect(step.hold).toBeGreaterThan(2000);
                expect(step.body.length).toBeGreaterThan(10);
            }
        }
        expect([...Routines.ORDER, 'choose']).toEqual(Policy.ROUTINE_IDS);
    });

    test('a show opens where its boldest step opens, never before; "show me" picks the boldest open', () => {
        const at = (n) => Routines.openAt(n, Policy.poseLevel);
        expect(at(1)).toEqual([]);
        expect(at(2)).toEqual(['tease']);
        expect(at(3)).toEqual(['tease', 'ride']);
        expect(at(4)).toEqual(Routines.ORDER);
        expect(Routines.boldest(3, Policy.poseLevel)).toBe('ride');
        expect(Routines.boldest(4, Policy.poseLevel)).toBe('everything');
    });

    test('speeds step and stop at the ends', () => {
        expect(Routines.stepSpeed(1, -1)).toBeLessThan(1);
        expect(Routines.stepSpeed(Routines.SPEEDS[0], -1)).toBe(Routines.SPEEDS[0]);
        expect(Routines.stepSpeed(Routines.SPEEDS[Routines.SPEEDS.length - 1], 1)).toBe(
            Routines.SPEEDS[Routines.SPEEDS.length - 1]
        );
    });
});

describe('UN36 shows: words', () => {
    const Locale = require('../src/features/together/PrivateLocale.js');
    for (const lang of Locale.languages()) {
        test.each(Routines.ORDER)(`${lang}: the %s chip sends a line that parses back to it`, (id) => {
            const line = Locale.t(`routine.${id}.say`, null, lang);
            expect(line).not.toBe(`routine.${id}.say`);
            expect(Locale.t(`routine.${id}.label`, null, lang)).not.toBe(`routine.${id}.label`);
            expect(show(line)).toEqual({ routine: id, move: 'start' });
        });
    }

    test('"show me" is the boldest open; positions keep their own words', () => {
        expect(show('show me')).toEqual({ routine: 'choose', move: 'start' });
        expect(show('fammi uno spettacolo')).toEqual({ routine: 'choose', move: 'start' });
        expect(parse('Straddle me').name).toBe('avatar.pose');
        expect(parse('open your legs').name).toBe('avatar.pose');
    });

    test('slower, faster and stop only while a show runs; again only just after one', () => {
        expect(show('slower')).toBeNull();
        expect(show('slower', { routine: 'running' })).toEqual({ move: 'slower' });
        expect(show('più veloce', { routine: 'running' })).toEqual({ move: 'faster' });
        expect(show('stop the show', { routine: 'running' })).toEqual({ move: 'stop' });
        expect(show('ancora')).toBeNull();
        expect(show('ancora!', { routine: 'done' })).toEqual({ move: 'again' });
        expect(show('more', { routine: 'done' })).toEqual({ move: 'again' });
    });

    test('her own tag never starts one unasked; their words do', () => {
        const facts = { active: true, care: false, asked: {}, autonomy: 'autonomous', level: 4 };
        const a = (source) => ({ name: 'avatar.routine', params: { routine: 'tease', move: 'start' }, source });
        expect(Policy.decide(a('model'), facts).allow).toBe(false);
        expect(Policy.decide(a('user'), facts).allow).toBe(true);
    });
});

describe('UN36 the ⋯ menu: show chips follow the pace the card shows', () => {
    const Private = require('../src/features/together/ui/PrivateConversationView.js');
    require('../src/features/together/PrivateLocale.js');
    let view;
    const chips = () =>
        Array.from(document.querySelectorAll(`#${Private.ROW_ID} [data-private-routine]`)).map(
            (b) => b.dataset.privateRoutine
        );
    beforeEach(() => {
        document.body.innerHTML = '<div class="chat-input-shell"></div><div id="chat-history"></div>';
        window.NEXUS_SPICY = { isEnabled: () => true };
        window.NEXUS_PRIVATE_ACTION_POLICY = Policy;
        view = new Private.View({ doc: document, win: window });
        view.mount({ scene: 'Private cabaret' });
    });
    afterEach(() => {
        if (view) view.destroy();
        delete window.NEXUS_SPICY;
        document.body.innerHTML = '';
    });

    test('no new snapshot is needed: the pace alone opens and closes them, and a tap is their line', () => {
        const sent = [];
        const routines = Routines.ORDER.map((id) => ({ id, level: Routines.level(id, Policy.poseLevel) }));
        view.showActions({ routines }, { onPosition: (line, key) => sent.push([line, key]) });
        const at = (level) => {
            view.setPace({ level, steps: [], hasLadder: false });
            return chips();
        };
        expect(at(1)).toEqual([]);
        expect(at(2)).toEqual(['tease']);
        expect(at(4)).toEqual(Routines.ORDER);
        expect(at(3)).toEqual(['tease', 'ride']);
        document.querySelector(`#${Private.ROW_ID} [data-private-routine="ride"]`).click();
        expect(sent).toEqual([['Ride me', 'ride']]);
    });
});
