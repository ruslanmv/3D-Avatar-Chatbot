/**
 * LW1: Regression for the real "Bedroom -> Life Relax -> meadow" transcript.
 * A selected place is spatial presence: an LLM activity tag is not navigation consent.
 */
const fs = require('fs');
const path = require('path');
const Directive = require('../../src/companion/ActivityDirective');
const Session = require('../../src/companion/CompanionSession');
const Prompt = require('../../src/companion/PromptContext');

function sessionInPlace(source = 'together') {
    const session = Session.create();
    session.load();
    session.enter('experiences', 'place-bedroom', { source });
    return session;
}

describe('LW1: keep the selected place stable', () => {
    test.each(['relax', 'focus', 'seaside', 'story'])(
        'assistant %s tag cannot replace the active bedroom',
        async (name) => {
            const session = sessionInPlace();
            const panel = { startActivity: jest.fn(), choose: jest.fn() };
            const director = { start: jest.fn(), status: jest.fn(() => ({ status: 'idle' })) };
            const before = session.conversationId();
            const result = await Directive.run(
                { name },
                { session, panel: () => panel, director, enabled: () => true }
            );
            expect(result).toEqual({ ok: false, why: 'place-active' });
            expect(session.activity()).toBe('place-bedroom');
            expect(session.destination()).toBe('experiences');
            expect(session.conversationId()).toBe(before);
            expect(panel.startActivity).not.toHaveBeenCalled();
            expect(panel.choose).not.toHaveBeenCalled();
            expect(director.start).not.toHaveBeenCalled();
        }
    );

    test('the guard works even when a place was entered from conversation', async () => {
        const session = sessionInPlace('conversation');
        const r = await Directive.run({ name: 'relax' }, {
            session,
            panel: () => ({ startActivity: jest.fn() }),
            enabled: () => true,
        });
        expect(r.why).toBe('place-active');
        expect(session.activity()).toBe('place-bedroom');
    });

    test('the model cannot end a selected place without verified user action', async () => {
        const session = sessionInPlace();
        const panel = { stopActivity: jest.fn(), activeActivity: { id: 'places' } };
        const result = await Directive.run({ name: 'end' }, {
            session,
            panel: () => panel,
            director: { status: () => ({ status: 'idle' }) },
            enabled: () => true,
        });
        expect(result).toEqual({ ok: false, why: 'place-active' });
        expect(panel.stopActivity).not.toHaveBeenCalled();
        expect(session.activity()).toBe('place-bedroom');
        // The existing user-owned End control calls session.end() through ActivityMarks.
        expect(session.end().ended).toBe(true);
        expect(session.active()).toBe(false);
    });

    test('while a place is active, advertise no scene-swapping activity tags', () => {
        const generic = Directive.systemPromptSuffix(true);
        expect(generic).toContain('<activity name="relax"/>');
        const inPlace = Directive.systemPromptSuffix(true, true);
        for (const name of ['relax', 'focus', 'seaside', 'story']) {
            expect(inPlace).not.toContain('<activity name="' + name + '"');
        }
        expect(inPlace).not.toContain('<activity name="end"/>');
        expect(Directive.systemPromptSuffix(false, true)).toBe('');
    });

    test('a refused assistant tag is removed from user-facing text', async () => {
        const session = sessionInPlace();
        const started = jest.fn();
        const clean = Directive.consume('Restiamo qui. <activity name="relax"/>', {
            session, panel: () => ({ startActivity: started }), enabled: () => true
        });
        expect(clean).toBe('Restiamo qui.');
        await Promise.resolve();
        await Promise.resolve();
        expect(started).not.toHaveBeenCalled();
        expect(session.activity()).toBe('place-bedroom');
    });

    test('confirmed physical actions are required before narration claims', () => {
        const prompt = Prompt.suffix({
            customized: true,
            active: true,
            destination: 'experiences',
            activity: 'place-bedroom',
        });
        expect(prompt).toContain('You remain in the user-selected place');
        expect(prompt).toContain('picked up a blanket');
        expect(prompt).toContain('application confirmed that action');
    });

    test('prompt-time topic classification independently preserves places', () => {
        const source = fs.readFileSync(path.join(__dirname, '../../src/companion/index.js'), 'utf8');
        expect(source).toContain("if (session.active() && /^place-[a-z0-9-]+$/.test(String(session.activity() || ''))) return;");
    });
});
