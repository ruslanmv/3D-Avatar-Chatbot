/**
 * W7, LT2. The live Try-On screen: tap a look and she wears it, one composer that knows
 * navigation from a request, three stages instead of eleven steps, library management
 * behind "Wardrobe ···", and a keyboard that never ends a haul by surprise.
 */
const { TryOnSession } = require('../../src/wardrobe/TryOnSession.js');
const { TryOnView } = require('../../src/wardrobe/TryOnView.js');
const Reasons = require('../../src/wardrobe/TryOnReasons.js');
const Intent = require('../../src/wardrobe/TryOnIntent.js');
const Reactions = require('../../src/wardrobe/TryOnReactions.js');

const LOOKS = [
    {
        id: 'a',
        name: 'Burgundy Evening',
        vrmUrl: 'https://f/a.vrm',
        previewUrl: 'https://f/a.webp',
        prompt: 'burgundy satin cocktail dress',
    },
    {
        id: 'b',
        name: 'Crop top & jeans',
        vrmUrl: 'https://f/b.vrm',
        fitPassed: false,
        provenance: { prompt: 'black fitted crop top + blue straight jeans' },
    },
];

function build({ generator = null, looks = LOOKS, importer = null, turn = null } = {}) {
    document.body.innerHTML = '<div class="avatar-card"></div>';
    const controller = {
        original: { url: 'vendor/avatars/AvatarSample_A.vrm' },
        avatarManager: { getCurrent: () => controller.original },
        applyLook: jest.fn(async (look) => look),
        restore: jest.fn(async () => true),
    };
    const session = new TryOnSession({ controller });
    session.setLooks(looks);
    const onClose = jest.fn();
    const view = new TryOnView({
        doc: document,
        session,
        generator,
        reasons: Reasons,
        intent: Intent,
        reactions: Reactions,
        importer,
        turn,
        onClose,
        random: () => 0,
        studioUrl: 'https://forge/studio/?avatar=x',
    });
    session.onChange = () => view.render();
    view.mount(document.querySelector('.avatar-card'));
    view.setLoading(false);
    return { view, session, controller, onClose, root: document.getElementById('nexus-try-on-view') };
}

const key = (root, name) => root.querySelector(`[data-key="${name}"]`);
/** The sheet folds to the remote as each look arrives; "More ▴" opens it again, and it stays open. */
const more = (root) => {
    const button = key(root, 'collapse');
    if (button && button.getAttribute('aria-expanded') === 'false') button.click();
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const forge = (create) => ({ availability: () => ({ ok: true }), identity: () => ({ kind: 'library' }), create });

describe('TryOnView — live stage', () => {
    test('the first screen is a strip of her looks, + New, a composer and Back — no Start', () => {
        const { root } = build({ generator: forge(jest.fn()) });
        expect(root.textContent).toMatch(/What should she try\?/);
        const cards = root.querySelectorAll('.nexus-try-on-strip .nexus-try-on-card');
        const name = (card) => card.querySelector('.nexus-try-on-name').textContent;
        expect([...cards].map(name)).toEqual(['Burgundy Evening', 'Crop top & jeans', 'New']);
        expect(cards[1].textContent).toMatch(/fit needs work/);
        expect(cards[0].querySelector('img').getAttribute('src')).toBe('https://f/a.webp');
        expect(key(root, 'start')).toBeNull();
        expect(key(root, 'keep')).toBeNull(); // nothing on yet: nothing to keep
        expect(key(root, 'back')).not.toBeNull();
        expect(key(root, 'surprise')).not.toBeNull();
        expect(key(root, 'import')).toBeNull(); // library management is behind Wardrobe ···
    });

    test('tapping a look puts it on at once, and the screen becomes the haul', async () => {
        const { root, controller } = build();
        key(root, 'look:a').click();
        await flush();
        expect(controller.applyLook).toHaveBeenCalledWith(LOOKS[0]);
        // The reveal: the sheet folds to one row so she is seen whole.
        expect(key(root, 'collapse').getAttribute('aria-expanded')).toBe('false');
        expect(root.querySelector('.nexus-try-on-strip')).toBeNull();
        expect(key(root, 'next')).not.toBeNull();
        more(root);
        expect(key(root, 'look:a').getAttribute('aria-pressed')).toBe('true');
        expect(root.querySelector('.nexus-try-on-current').textContent).toBe('Burgundy Evening');
        expect(root.textContent).toMatch(/Look 1 of 2/);
        expect(key(root, 'keep').disabled).toBe(false);
        expect(key(root, 'end')).not.toBeNull();
    });

    test('the arrival plays the reveal once', async () => {
        const { root, view } = build();
        key(root, 'look:a').click();
        await flush();
        expect(root.querySelector('.nexus-try-on-stage').classList.contains('is-revealing')).toBe(true);
        expect(document.querySelector('.avatar-card .nexus-try-on-flash')).not.toBeNull();
        view.render();
        expect(root.querySelector('.nexus-try-on-stage').classList.contains('is-revealing')).toBe(false);
    });

    test('once opened with More, the sheet stays open as the next look arrives', async () => {
        const { root } = build();
        key(root, 'look:a').click();
        await flush();
        more(root);
        key(root, 'look:b').click();
        await flush();
        expect(root.querySelector('.nexus-try-on-strip')).not.toBeNull();
    });

    test('Save is a heart that keeps the haul going; Keep closes with her in the look', async () => {
        const { root, onClose, controller } = build();
        key(root, 'look:a').click();
        await flush();
        key(root, 'favorite').click(); // on the remote, too
        more(root);
        expect(key(root, 'favorite').getAttribute('aria-pressed')).toBe('true');
        expect(onClose).not.toHaveBeenCalled();
        key(root, 'keep').click();
        await flush();
        expect(onClose).toHaveBeenCalledWith('kept');
        expect(controller.restore).not.toHaveBeenCalled();
    });

    test('Compare offers original and previous once both exist, and Back returns', async () => {
        const { root, session } = build();
        key(root, 'look:a').click();
        await flush();
        more(root);
        key(root, 'look:b').click();
        await flush();
        key(root, 'compare').click();
        key(root, 'compare-original').click();
        await flush();
        expect(session.state().comparing).toBe('original');
        expect(root.querySelector('.nexus-try-on-current').textContent).toBe('Original');
        key(root, 'compare').click();
        await flush();
        expect(session.state()).toMatchObject({ comparing: null, look: { id: 'b' } });
    });

    test('typing navigation never reaches Forge', async () => {
        const create = jest.fn();
        const { view, session } = build({ generator: forge(create) });
        await view.say('next');
        await flush();
        await view.say('go back to the burgundy evening');
        await flush();
        expect(create).not.toHaveBeenCalled();
        expect(session.state().look.id).toBe('a');
    });

    test('a request shows DESIGNING · FITTING · READY, real steps only under Details, then she wears it', async () => {
        let report;
        let finish;
        const create = jest.fn((prompt, { onProgress }) => {
            report = onProgress;
            return new Promise((resolve) => (finish = resolve));
        });
        const { view, root, session, controller } = build({ generator: forge(create) });
        const making = view.say('a black evening dress');
        report(Reasons.progress('fitting'));
        const stages = [...root.querySelectorAll('.nexus-try-on-stages li')];
        expect(stages.map((li) => li.textContent)).toEqual(['DESIGNING', 'FITTING', 'READY']);
        expect(stages[1].className).toBe('is-active');
        expect(root.querySelector('.nexus-try-on-steps')).toBeNull();
        key(root, 'details').click();
        expect(root.querySelector('.nexus-try-on-steps li.is-active').textContent).toBe('Fitting it to her');
        finish({ id: 'new', name: 'Black Evening', vrmUrl: 'https://f/n.vrm' });
        await making;
        expect(create).toHaveBeenCalledWith('black evening dress', expect.objectContaining({ baseLookId: undefined }));
        expect(controller.applyLook).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'new' }));
        expect(session.state().look.id).toBe('new');
        expect(root.querySelector('.nexus-try-on-react')).not.toBeNull(); // a made look gets her reaction
    });

    test('“change the top” on a look Forge made sends only the top, built on that look', async () => {
        const made = { id: 'look_7', name: 'Tee & jeans', vrmUrl: 'https://f/7.vrm', source: 'generated' };
        made.prompt = 'white fitted tee + blue straight jeans';
        const create = jest.fn(async () => ({ id: 'look_8', name: 'Satin & jeans', vrmUrl: 'https://f/8.vrm' }));
        const { view, root } = build({ generator: forge(create), looks: [made] });
        key(root, 'look:look_7').click();
        await flush();
        await view.say('change the top to a black satin crop top');
        expect(create).toHaveBeenCalledWith('black satin crop top', expect.objectContaining({ baseLookId: 'look_7' }));
    });

    test('an answer back from the composer is tappable', async () => {
        const { view, root } = build({ generator: forge(jest.fn()) });
        key(root, 'look:b').click();
        await flush();
        view.say('make it red');
        const options = root.querySelectorAll('.nexus-try-on-ask .nexus-try-on-chip');
        expect(options.length).toBe(2);
    });

    test('without Forge: one quiet line, no categories, and every saved look still works', async () => {
        const generator = { availability: () => ({ ok: false, why: 'needs Forge' }) };
        const { root, view, controller } = build({ generator });
        expect(key(root, 'unavailable').textContent).toBe('Creating new looks unavailable');
        expect(root.querySelector('.nexus-try-on-tabs')).toBeNull();
        await view.say('a red dress');
        expect(root.textContent).toMatch(/unavailable/);
        key(root, 'surprise').click(); // picks one of her own looks instead
        await flush();
        expect(controller.applyLook).toHaveBeenCalled();
    });

    test('Private is a category tab when private mode is on — its picks, or its reason', () => {
        const { root, view } = build({ generator: forge(jest.fn()) });
        expect(key(root, 'tab:private')).toBeNull();
        view.setPrivate({ mode: 'open', picks: [{ label: 'Lace lingerie', prompt: 'black lace lingerie set' }] });
        key(root, 'tab:private').click();
        expect(key(root, 'pick:Lace lingerie')).not.toBeNull();
        expect(root.querySelector('.nexus-try-on-private')).toBeNull(); // no separate pink box
        view.setPrivate({ mode: 'locked', why: 'Not declared adult.' });
        expect(root.textContent).toMatch(/Not declared adult\./);
        view.setPrivate({ mode: 'off' });
        expect(key(root, 'tab:private')).toBeNull();
        expect(key(root, 'tab:for-you').getAttribute('aria-selected')).toBe('true');
    });

    test('Wardrobe ··· holds import, the packs and the Studio link', async () => {
        const importer = { list: jest.fn(async () => [{ id: 'p1', name: 'Summer', looks: 3 }]), prepare: jest.fn() };
        const { root } = build({ importer });
        await flush();
        key(root, 'wardrobe').click();
        expect(key(root, 'import')).not.toBeNull();
        expect(key(root, 'remove:p1')).not.toBeNull();
        const studio = root.querySelector('.nexus-try-on-studio');
        expect(studio.getAttribute('target')).toBe('_blank');
        expect(studio.getAttribute('rel')).toBe('noopener');
    });

    test('Turn is offered only when the activity can turn her', async () => {
        const turn = { toggle: jest.fn(() => true), reset: jest.fn() };
        const a = build();
        a.root.querySelector('[data-key="look:a"]').click();
        await flush();
        expect(key(a.root, 'turn')).toBeNull();
        const b = build({ turn });
        key(b.root, 'look:a').click();
        await flush();
        key(b.root, 'turn').click(); // on the remote
        expect(turn.toggle).toHaveBeenCalled();
    });

    test('Play haul needs two looks and stops when the person taps one', async () => {
        const { root, session } = build();
        key(root, 'play').click();
        await flush();
        expect(session.state().playing).toBe(true);
        more(root);
        key(root, 'look:b').click();
        expect(session.state().playing).toBe(false);
        session.pause();
    });

    test('arrow keys step; Escape ends a compare or goes back, and never ends a haul', async () => {
        const { root, session, onClose, controller } = build();
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await flush();
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await flush();
        expect(session.state().look.id).toBe('b');
        await session.compare('previous');
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await flush();
        expect(session.state().comparing).toBeNull();
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(onClose).not.toHaveBeenCalled();
        expect(controller.restore).not.toHaveBeenCalled();
    });

    test('Escape before anything is worn goes back', () => {
        const { root, onClose } = build();
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(onClose).toHaveBeenCalledWith('back');
    });

    test('Tab stays inside the dialog', () => {
        const { root } = build();
        const focusable = [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), [href]')];
        focusable[focusable.length - 1].focus();
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        expect(document.activeElement).toBe(focusable[0]);
    });

    test('a failed request shows the sentence and leaves her as she was', async () => {
        const create = jest
            .fn()
            .mockRejectedValue(Object.assign(new Error(Reasons.REASONS.fitting_failed), { name: 'TryOnError' }));
        const { view, root, controller } = build({ generator: forge(create) });
        await view.say('a ball gown');
        expect(root.querySelector('.nexus-try-on-error').textContent).toBe(Reasons.REASONS.fitting_failed);
        expect(controller.applyLook).not.toHaveBeenCalled();
    });
});
