/**
 * W7. The Try-On screens: cards that are checkboxes, a create box that shows real steps,
 * and a keyboard that steps through looks without ever ending a haul by surprise.
 */
const { TryOnSession } = require('../../src/wardrobe/TryOnSession.js');
const { TryOnView } = require('../../src/wardrobe/TryOnView.js');
const Reasons = require('../../src/wardrobe/TryOnReasons.js');

const LOOKS = [
    { id: 'a', name: 'Burgundy Evening', vrmUrl: 'https://f/a.vrm', fitPassed: true, previewUrl: 'https://f/a.webp' },
    { id: 'b', name: 'Summer Casual', vrmUrl: 'https://f/b.vrm', fitPassed: false },
];

function build({ generator = null, looks = LOOKS } = {}) {
    document.body.innerHTML = '';
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
        onClose,
        studioUrl: 'https://forge/studio/?avatar=x',
    });
    session.onChange = () => view.render();
    view.mount(null);
    view.setLoading(false);
    return { view, session, controller, onClose, root: document.getElementById('nexus-try-on-view') };
}

const key = (root, name) => root.querySelector(`[data-key="${name}"]`);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('TryOnView', () => {
    test('each look is a checkbox with its picture, name and fit', () => {
        const { root } = build();
        const cards = root.querySelectorAll('.nexus-try-on-card');
        expect(cards).toHaveLength(2);
        expect(cards[0].getAttribute('role')).toBe('checkbox');
        expect(cards[0].getAttribute('aria-checked')).toBe('false');
        expect(cards[0].querySelector('img').getAttribute('src')).toBe('https://f/a.webp');
        expect(cards[0].textContent).toMatch(/fit passed/);
        expect(cards[1].textContent).toMatch(/fit needs work/);
        cards[0].click();
        expect(root.querySelector('.nexus-try-on-card').getAttribute('aria-checked')).toBe('true');
    });

    test('Start is disabled until a look is chosen', () => {
        const { root } = build();
        expect(key(root, 'start').disabled).toBe(true);
        root.querySelector('.nexus-try-on-card').click();
        expect(key(root, 'start').disabled).toBe(false);
        expect(root.textContent).toMatch(/Chosen for the haul: 1/);
    });

    test('the Studio link opens in a new tab', () => {
        const { root } = build();
        const link = root.querySelector('.nexus-try-on-studio');
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noopener');
    });

    test('without Forge the create box explains instead of offering a button', () => {
        const generator = { availability: () => ({ ok: false, why: 'Creating new looks needs Wardrobe Forge.' }) };
        const { root } = build({ generator });
        expect(key(root, 'generate')).toBeNull();
        expect(root.textContent).toMatch(/needs Wardrobe Forge/);
    });

    test('creating shows the real steps, then adds the look chosen', async () => {
        let report;
        const generator = {
            availability: () => ({ ok: true }),
            create: jest.fn((prompt, { onProgress }) => {
                report = onProgress;
                return new Promise((resolve) =>
                    setTimeout(() => resolve({ id: 'new', name: 'Black Satin', vrmUrl: 'https://f/n.vrm' }), 5)
                );
            }),
        };
        const { view, root, session } = build({ generator });
        const creating = view.create('black satin dress');
        report(Reasons.progress('fitting'));
        const steps = [...root.querySelectorAll('.nexus-try-on-steps li')];
        expect(steps.find((li) => li.classList.contains('is-active')).textContent).toBe('Fitting it to her');
        expect(key(root, 'cancel-create')).not.toBeNull();
        await creating;
        expect(session.isChosen('new')).toBe(true);
        expect(root.textContent).toMatch(/Black Satin/);
    });

    test('a failed create shows the sentence and leaves the haul as it was', async () => {
        const generator = {
            availability: () => ({ ok: true }),
            create: jest
                .fn()
                .mockRejectedValue(Object.assign(new Error(Reasons.REASONS.fitting_failed), { name: 'TryOnError' })),
        };
        const { view, root, controller } = build({ generator });
        await view.create('ball gown');
        expect(root.querySelector('.nexus-try-on-error').textContent).toBe(Reasons.REASONS.fitting_failed);
        expect(controller.applyLook).not.toHaveBeenCalled();
    });

    test('while a look is on, arrow keys step, and Escape never ends the haul', async () => {
        const { root, session, onClose, controller } = build();
        root.querySelectorAll('.nexus-try-on-card').forEach((card) => card.click());
        await session.start();
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await flush();
        expect(session.state().index).toBe(1);
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(onClose).not.toHaveBeenCalled();
        expect(controller.restore).not.toHaveBeenCalled();
        expect(root.textContent).toMatch(/Look 2 of 2/);
    });

    test('Escape on the choosing screen goes back', () => {
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
});
