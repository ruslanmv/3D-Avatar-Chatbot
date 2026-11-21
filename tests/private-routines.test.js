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
    test('every step is one of her positions, a turn, or a CC0 clip that ships; every show is in the policy', () => {
        const fs = require('fs');
        const path = require('path');
        for (const id of Routines.ORDER) {
            for (const step of Routines.ROUTINES[id].steps) {
                if (step.clip) {
                    expect(step.clip.startsWith('addons/vrma-cc0/')).toBe(true);
                    expect(fs.existsSync(path.join(__dirname, '..', step.clip))).toBe(true);
                } else {
                    expect(step.pose === 'turn' || Boolean(Poses.POSES[step.pose])).toBe(true);
                    expect(step.undress).toBeUndefined(); // a layer comes off only while she dances
                }
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
        expect(at(3)).toEqual(['tease', 'ride', 'table-dance']);
        // UR1. The Unrestrained shows open only with Unrestrained on; "show me" stays the striptease.
        expect(at(4)).toEqual(Routines.ORDER.filter((id) => !Routines.unrestrainedOnly(id)));
        expect(Routines.openAt(4, Policy.poseLevel, { unrestrained: true })).toEqual(Routines.ORDER);
        expect(Routines.boldest(3, Policy.poseLevel)).toBe('table-dance');
        expect(Routines.boldest(4, Policy.poseLevel)).toBe('striptease');
        expect(Routines.boldest(4, Policy.poseLevel, { unrestrained: true })).toBe('striptease');
        // VA3. A striptease takes layers off: it opens only where undressing does.
        expect(Routines.level('striptease', Policy.poseLevel)).toBe(Policy.UNDRESS_LEVEL);
        expect(Routines.ROUTINES.striptease.steps.filter((x) => x.undress)).toHaveLength(3);
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
        expect(at(3)).toEqual(['tease', 'ride', 'table-dance']);
        document.querySelector(`#${Private.ROW_ID} [data-private-routine="ride"]`).click();
        expect(sent).toEqual([['Ride me', 'ride']]);
    });

    test('repainted many times, the menu holds one group each: shows, positions, finish (a phone, 2026-11-19)', () => {
        const routines = Routines.ORDER.map((id) => ({ id, level: Routines.level(id, Policy.poseLevel) }));
        const handlers = { onPosition: () => {} };
        for (let i = 0; i < 6; i += 1) {
            view.showActions({ routines, finishPlaces: ['back', 'inside'] }, handlers);
            view.setPace({ level: i % 2 ? 4 : 3, steps: [], hasLadder: false });
        }
        view.setPace({ level: 4, steps: [], hasLadder: false });
        const slot = document.querySelector(`#${Private.ROW_ID} .nexus-private-action-slot`);
        const groups = [...slot.querySelectorAll('.nexus-private-positions')];
        const with_ = (sel) => groups.filter((g) => g.querySelector(sel)).length;
        expect(with_('[data-private-position]')).toBe(1);
        expect(with_('[data-private-routine]')).toBe(1);
        expect(slot.querySelectorAll('.nexus-private-finish').length).toBeLessThanOrEqual(1);
        // Each position chip once.
        const keys = [...slot.querySelectorAll('[data-private-position]')].map((b) => b.dataset.privatePosition);
        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe('UR1 Unrestrained shows', () => {
    const UR = Routines.ORDER.filter((id) => Routines.unrestrainedOnly(id));

    test('seven of them, each at the closest step, none finishing on its own', () => {
        expect(UR.sort()).toEqual([
            'dom-sub',
            'edging',
            // BD32 and BD31. Their stories: the fist, then the ass / then inside.
            'fist-then-ass',
            'fist-then-inside',
            // L5. Valentina's and Chiara's shows.
            'full-service',
            'like-last-time',
            'oil-everything',
            'rounds',
            'tied',
            // BD33.
            'two-hands',
            'used-marked',
            'window-show',
            'worse-than-last-time',
        ]);
        for (const id of UR) {
            expect(Routines.level(id, Policy.poseLevel)).toBe(4);
            for (const step of Routines.ROUTINES[id].steps) {
                // A step may show arousal, the edge, oil or rope — never a finish (those are theirs).
                if (step.skin) {
                    expect(step.skin).not.toMatch(/cum|creampie|finish/);
                    expect(['used', 'dripping', 'round-three', 'breasts-belly', 'oiled-used']).not.toContain(step.skin);
                }
            }
        }
    });
});

describe('BD31. the fist-then-inside stories: she invites, the person acts', () => {
    test.each(['fist-then-inside', 'worse-than-last-time', 'fist-then-ass'])(
        '%s never shows a fist or a finish on its own',
        (id) => {
            const r = Routines.ROUTINES[id];
            expect(r && r.unrestrained).toBe(true);
            for (const step of r.steps) {
                expect(step.skin || '').not.toMatch(/fist|ring|cum|creampie|bottle/);
                expect(step.body).not.toMatch(/\b(?:girl|teen|young|school)\b/i);
            }
            // Each ends where the person's finish lands from behind (the doggy states).
            expect(['all-fours', 'face-down', 'bent-over']).toContain(r.steps[r.steps.length - 1].pose);
        }
    );
});

describe('BD33. tied, two hands: agreed with a traffic light, ends held close', () => {
    const Director = require('../src/features/together/PrivateTurnDirector.js');
    test('it ties and marks her, never shows their hands or a finish itself, and ends in aftercare', () => {
        const r = Routines.ROUTINES['two-hands'];
        expect(r.unrestrained).toBe(true);
        expect(r.steps.map((x) => x.skin).filter(Boolean)).toEqual(['sado-roped-open', 'sado-whipped-open']);
        expect(r.steps[r.steps.length - 1].pose).toBe('spoon');
        expect(r.steps[r.steps.length - 1].body).toMatch(/untied|all right/);
        expect(r.steps.map((x) => x.body).join(' ')).not.toMatch(/blood|bleed|wound|\bcut\b|injur/i);
    });
    test.each([
        ['red', 'end'],
        ['Rosso!', 'end'],
        ['rojo', 'end'],
        ['yellow', 'pace-down'],
        ['giallo', 'pace-down'],
        ['gelb', 'pace-down'],
    ])('"%s" → %s', (said, intent) => {
        expect(Director.classify(said).intent).toBe(intent);
    });
    test('a colour inside a sentence is just talk', () => {
        expect(Director.classify('put on the red dress').intent).not.toBe('end');
        expect(Director.classify('mettiti il vestito rosso').intent).not.toBe('end');
    });
});
