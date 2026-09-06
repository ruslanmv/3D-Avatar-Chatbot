/**
 * Eyes closed (batch T7).
 *
 * The batch's own acceptance line is the thing to hold onto here:
 *
 *     No new permission, no new consent surface — this is the audio the user already
 *     started, and the recording indicator rules (§2a) are untouched.
 *
 * So most of what follows is about what settling is *not* allowed to do. It is not allowed to
 * happen when nothing is playing, not allowed to happen when Together is off, not allowed to
 * take a control out of reach, and — the one that would actually be dangerous — not allowed
 * anywhere near the recording indicator.
 */

const Ambient = require('../src/features/together/AmbientMode.js');
const Switch = require('../src/features/together/TogetherSwitch.js');
const CurrentMedia = require('../src/features/together/CurrentMediaContext.js');

const TRACK = {
    id: 'fJ9rUzIMcZQ',
    provider: 'youtube',
    kind: 'track',
    title: 'Bohemian Rhapsody',
    creator: 'Queen Official',
    url: 'https://www.youtube.com/watch?v=fJ9rUzIMcZQ',
};

/** Arm, with something playing, Together on, and the box in Settings ticked. */
function armPlaying() {
    Switch.enable('tile');
    Ambient.setEnabled(true);
    CurrentMedia.set(TRACK);
    return Ambient.arm({ doc: document, win: window });
}

beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    Switch.reset();
    CurrentMedia.clear();
    Ambient.reset();
    window.NEXUS_TOGETHER_SWITCH = Switch;
    window.NEXUS_CURRENT_MEDIA = CurrentMedia;
    document.documentElement.removeAttribute(Ambient.ATTR);
    document.head.innerHTML = '';
    document.body.innerHTML = '';
});

afterEach(() => {
    Ambient.reset();
    jest.useRealTimers();
});

describe('off unless it is asked for', () => {
    // The Together switch turns itself on the first time somebody taps a tile, because
    // tapping the tile *is* the request. Dimming the interface has no equivalent — nothing a
    // user does means "and also fade the chrome at me" — so this one is opt-in and no code
    // path other than the Settings box may write it.

    test('a fresh profile has it off', () => {
        expect(Ambient.isEnabled()).toBe(false);
    });

    test('and playing something for half an hour does not settle it', () => {
        Switch.enable('tile');
        CurrentMedia.set(TRACK);
        Ambient.arm({ doc: document, win: window });

        jest.advanceTimersByTime(Ambient.QUIET_MS * 72);

        expect(Ambient.isSettled()).toBe(false);
        expect(document.documentElement.hasAttribute(Ambient.ATTR)).toBe(false);
    });

    test('while off it puts nothing in the page at all', () => {
        // Not merely inert — absent. No stylesheet means no selectors for the engine to
        // match and nothing for a future edit to accidentally switch on.
        Switch.enable('tile');
        CurrentMedia.set(TRACK);
        Ambient.arm({ doc: document, win: window });
        expect(document.getElementById(Ambient.STYLE_ID)).toBeNull();
    });

    test('ticking the box is what turns it on, and it takes effect without a reload', () => {
        Switch.enable('tile');
        CurrentMedia.set(TRACK);
        Ambient.arm({ doc: document, win: window });
        jest.advanceTimersByTime(Ambient.QUIET_MS * 2);
        expect(Ambient.isSettled()).toBe(false);

        Ambient.setEnabled(true);
        jest.advanceTimersByTime(Ambient.QUIET_MS);

        expect(Ambient.isSettled()).toBe(true);
        expect(document.getElementById(Ambient.STYLE_ID)).not.toBeNull();
    });

    test('unticking it wakes the page immediately', () => {
        armPlaying();
        jest.advanceTimersByTime(Ambient.QUIET_MS);
        expect(Ambient.isSettled()).toBe(true);

        Ambient.setEnabled(false);

        expect(Ambient.isSettled()).toBe(false);
        expect(document.documentElement.hasAttribute(Ambient.ATTR)).toBe(false);
    });

    test('and it stays off afterwards', () => {
        armPlaying();
        Ambient.setEnabled(false);
        jest.advanceTimersByTime(Ambient.QUIET_MS * 4);
        expect(Ambient.isSettled()).toBe(false);
    });

    test('the answer is remembered', () => {
        Ambient.setEnabled(true);
        expect(localStorage.getItem(Ambient.KEY)).toBe('true');
        Ambient.setEnabled(false);
        expect(localStorage.getItem(Ambient.KEY)).toBe('false');
    });

    test('a stored answer is what a new page reads', () => {
        localStorage.setItem(Ambient.KEY, 'true');
        Ambient.reset();
        expect(Ambient.isEnabled()).toBe(true);
    });

    test('any other stored value reads as off, not as on', () => {
        // Corrupt storage, an older key, a half-written value: the safe reading of anything
        // that is not the literal 'true' is that nobody asked for this.
        for (const junk of ['TRUE', '1', 'yes', 'on', '', 'null']) {
            localStorage.setItem(Ambient.KEY, junk);
            Ambient.reset();
            expect(Ambient.isEnabled()).toBe(false);
        }
    });

    test('storage being unavailable does not make it on', () => {
        const get = Storage.prototype.getItem;
        Storage.prototype.getItem = () => {
            throw new Error('storage disabled');
        };
        try {
            Ambient.reset();
            expect(Ambient.isEnabled()).toBe(false);
        } finally {
            Storage.prototype.getItem = get;
        }
    });

    test('but it can still be switched on for the session', () => {
        const set = Storage.prototype.setItem;
        const get = Storage.prototype.getItem;
        Storage.prototype.setItem = () => {
            throw new Error('storage disabled');
        };
        Storage.prototype.getItem = () => {
            throw new Error('storage disabled');
        };
        try {
            Ambient.setEnabled(true);
            expect(Ambient.isEnabled()).toBe(true);
        } finally {
            Storage.prototype.setItem = set;
            Storage.prototype.getItem = get;
        }
    });

    test('the app with the box unticked is the app as it was before this batch', () => {
        // The plainest statement of the default: with nobody having asked for it, T7 adds no
        // attribute, no stylesheet, no timer and no state. The page is the T6 page.
        Switch.enable('tile');
        CurrentMedia.set(TRACK);
        Ambient.arm({ doc: document, win: window });

        expect(Ambient.schedule()).toBe(false);
        expect(document.head.innerHTML).toBe('');
        expect(document.documentElement.attributes).toHaveLength(0);

        jest.advanceTimersByTime(Ambient.QUIET_MS * 10);
        document.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        jest.advanceTimersByTime(Ambient.QUIET_MS * 10);

        expect(Ambient.isSettled()).toBe(false);
        expect(document.head.innerHTML).toBe('');
        expect(document.documentElement.attributes).toHaveLength(0);
    });

    test('no clock is even started while it is off', () => {
        // `schedule` is the only thing that can lead to settling, so it is the guard worth
        // asserting directly rather than through its effect twenty-five seconds later.
        Switch.enable('tile');
        CurrentMedia.set(TRACK);
        Ambient.arm({ doc: document, win: window });
        expect(Ambient.schedule()).toBe(false);
        expect(jest.getTimerCount()).toBe(0);

        Ambient.setEnabled(true);
        expect(jest.getTimerCount()).toBe(1);
    });

    test('and calling settle() outright still refuses', () => {
        // `settle` is exported — the timer is not the only way in, and a second guard is
        // exactly what an opt-in setting should have.
        Switch.enable('tile');
        CurrentMedia.set(TRACK);
        Ambient.arm({ doc: document, win: window });

        expect(Ambient.settle()).toBe(false);
        expect(document.documentElement.hasAttribute(Ambient.ATTR)).toBe(false);
    });

    test('nothing but the Settings box turns it on', () => {
        // A grep, deliberately. The risk this guards is a later batch calling `setEnabled(true)`
        // from a tile or a play path "because the user is clearly enjoying it", which is
        // exactly how an opt-in setting stops being one.
        const { execSync } = require('child_process');
        const hits = execSync("grep -rln 'NEXUS_AMBIENT' src/ index.html || true", { encoding: 'utf8' })
            .split('\n')
            .filter(Boolean);
        // The module that defines it, the launcher that arms it, and the box that sets it.
        expect(hits.sort()).toEqual([
            'index.html',
            'src/features/together/AmbientMode.js',
            'src/features/together/ui/TogetherLauncher.js',
        ]);
        const launcher = require('fs').readFileSync('src/features/together/ui/TogetherLauncher.js', 'utf8');
        expect(launcher).not.toMatch(/setEnabled/);
    });
});

describe('it settles, eventually', () => {
    test('after the quiet interval, with something playing', () => {
        armPlaying();
        expect(Ambient.isSettled()).toBe(false);

        jest.advanceTimersByTime(Ambient.QUIET_MS);

        expect(Ambient.isSettled()).toBe(true);
        expect(document.documentElement.getAttribute(Ambient.ATTR)).toBe('on');
    });

    test('and not one tick early', () => {
        armPlaying();
        jest.advanceTimersByTime(Ambient.QUIET_MS - 1);
        expect(Ambient.isSettled()).toBe(false);
    });

    test('it says so, so anything else that cares can hear it', () => {
        const heard = [];
        document.addEventListener('nexus:ambient', (e) => heard.push(e.detail));
        armPlaying();
        jest.advanceTimersByTime(Ambient.QUIET_MS);
        expect(heard).toEqual([{ state: 'on' }]);
    });
});

describe('the states that must never settle', () => {
    test('nothing is playing', () => {
        // The whole premise is "something is playing and nobody is typing". Without the first
        // half this would just be an app that dims itself while you think.
        Switch.enable('tile');
        Ambient.setEnabled(true);
        Ambient.arm({ doc: document, win: window });
        jest.advanceTimersByTime(Ambient.QUIET_MS * 3);
        expect(Ambient.isSettled()).toBe(false);
        expect(document.documentElement.hasAttribute(Ambient.ATTR)).toBe(false);
    });

    test('Together is switched off', () => {
        Ambient.setEnabled(true);
        CurrentMedia.set(TRACK);
        Switch.disable('settings');
        Ambient.arm({ doc: document, win: window });
        jest.advanceTimersByTime(Ambient.QUIET_MS * 3);
        expect(Ambient.isSettled()).toBe(false);
    });

    test('the media stops before the interval is up', () => {
        armPlaying();
        jest.advanceTimersByTime(Ambient.QUIET_MS - 100);
        CurrentMedia.clear();
        jest.advanceTimersByTime(Ambient.QUIET_MS * 2);
        expect(Ambient.isSettled()).toBe(false);
    });

    test('nobody armed it at all', () => {
        Switch.enable('tile');
        Ambient.setEnabled(true);
        CurrentMedia.set(TRACK);
        expect(Ambient.settle()).toBe(false);
        expect(document.documentElement.hasAttribute(Ambient.ATTR)).toBe(false);
    });
});

describe('waking', () => {
    test.each([['keydown'], ['pointerdown'], ['wheel'], ['touchstart']])('%s brings it back', (name) => {
        armPlaying();
        jest.advanceTimersByTime(Ambient.QUIET_MS);
        expect(Ambient.isSettled()).toBe(true);

        document.dispatchEvent(new window.Event(name, { bubbles: true }));

        expect(Ambient.isSettled()).toBe(false);
        expect(document.documentElement.hasAttribute(Ambient.ATTR)).toBe(false);
    });

    test('waking is immediate, not on a timer', () => {
        armPlaying();
        jest.advanceTimersByTime(Ambient.QUIET_MS);
        document.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        // No timers advanced. Somebody reaching for the composer cannot be asked to wait.
        expect(document.documentElement.hasAttribute(Ambient.ATTR)).toBe(false);
    });

    test('and it does not settle again on the same track', () => {
        // Settling once is atmosphere. Settling again twenty-five seconds after somebody
        // deliberately woke it is the interface arguing with them.
        armPlaying();
        jest.advanceTimersByTime(Ambient.QUIET_MS);
        document.dispatchEvent(new window.Event('keydown', { bubbles: true }));

        jest.advanceTimersByTime(Ambient.QUIET_MS * 4);

        expect(Ambient.isSettled()).toBe(false);
    });

    test('nor after they touch it a second time', () => {
        // The one that actually exercises the flag. The first tap wakes and stops the clock,
        // so nothing reschedules; it is the *second* tap — somebody typing, scrolling, using
        // the app — that asks for a new clock, and it must be refused for this track.
        armPlaying();
        jest.advanceTimersByTime(Ambient.QUIET_MS);
        document.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        document.dispatchEvent(new window.Event('keydown', { bubbles: true }));

        expect(jest.getTimerCount()).toBe(0);
        jest.advanceTimersByTime(Ambient.QUIET_MS * 4);

        expect(Ambient.isSettled()).toBe(false);
    });

    test('the next track is a fresh chance', () => {
        armPlaying();
        jest.advanceTimersByTime(Ambient.QUIET_MS);
        document.dispatchEvent(new window.Event('keydown', { bubbles: true }));
        jest.advanceTimersByTime(Ambient.QUIET_MS * 2);
        expect(Ambient.isSettled()).toBe(false);

        CurrentMedia.set({ ...TRACK, id: 'XarKqjNoE7A', title: 'Agent Matrix' });
        jest.advanceTimersByTime(Ambient.QUIET_MS);

        expect(Ambient.isSettled()).toBe(true);
    });

    test('switching Together off wakes it', () => {
        armPlaying();
        jest.advanceTimersByTime(Ambient.QUIET_MS);
        expect(Ambient.isSettled()).toBe(true);

        Switch.disable('settings');

        expect(Ambient.isSettled()).toBe(false);
    });

    test('the wake event carries why, so a listener can tell a tap from a track ending', () => {
        const heard = [];
        document.addEventListener('nexus:ambient', (e) => heard.push(e.detail));
        armPlaying();
        jest.advanceTimersByTime(Ambient.QUIET_MS);
        document.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        expect(heard[heard.length - 1]).toEqual({ state: 'off', reason: 'activity' });
    });

    test('waking when it was never settled says nothing', () => {
        const heard = [];
        armPlaying();
        document.addEventListener('nexus:ambient', (e) => heard.push(e.detail));
        document.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        expect(heard).toEqual([]);
    });
});

describe('§2a — the one thing a dimmer must never touch', () => {
    test('the recording indicator is exempt, and it is not a suggestion', () => {
        expect(Ambient.CSS).toContain('#nexus-bd-consent-indicator');
        const rule = Ambient.CSS.slice(Ambient.CSS.indexOf('#nexus-bd-consent-indicator'));
        expect(rule.slice(0, rule.indexOf('}'))).toContain('opacity: 1 !important');
    });

    test('nothing in the settled state reduces its opacity', () => {
        // A rule that dimmed it would have to name it or an ancestor of it. The indicator is
        // appended to `body`, so the only ancestors are `body` and the root element — neither
        // of which this stylesheet is allowed to touch.
        for (const selector of [":root[data-nexus-ambient='on'] body", ":root[data-nexus-ambient='on'] {"]) {
            expect(Ambient.CSS).not.toContain(selector);
        }
    });

    test('settling asks for no permission and opens no stream', () => {
        // The acceptance line, as a test: there is no capture API anywhere in this module.
        const source = require('fs').readFileSync(require.resolve('../src/features/together/AmbientMode.js'), 'utf8');
        expect(source).not.toMatch(/getDisplayMedia|getUserMedia|mediaDevices/);
    });
});

describe('what settling does, and what it refuses to do', () => {
    test('nothing is hidden and nothing loses its clicks', () => {
        // A dimmed composer is still a composer. `display: none` or `pointer-events: none`
        // would mean a first tap that does nothing, which is the failure this is the
        // opposite of.
        expect(Ambient.CSS).not.toMatch(/pointer-events/);
        expect(Ambient.CSS).not.toMatch(/display:\s*none/);
        expect(Ambient.CSS).not.toMatch(/visibility:\s*hidden/);
    });

    test('it only ever changes opacity — no layout, no position', () => {
        const properties = [...Ambient.CSS.matchAll(/^\s{4}([a-z-]+):/gm)].map((m) => m[1]);
        expect(new Set(properties)).toEqual(new Set(['opacity', 'transition']));
    });

    test('reduced motion gets no fade', () => {
        expect(Ambient.CSS).toContain('@media (prefers-reduced-motion: reduce)');
    });

    test('the stylesheet goes in once, however many times it is armed', () => {
        armPlaying();
        Ambient.arm({ doc: document, win: window });
        expect(document.querySelectorAll(`#${Ambient.STYLE_ID}`)).toHaveLength(1);
    });

    test('and comes out again when it is stopped', () => {
        const stop = armPlaying();
        expect(document.getElementById(Ambient.STYLE_ID)).not.toBeNull();
        stop();
        expect(document.getElementById(Ambient.STYLE_ID)).toBeNull();
    });

    test('stopping wakes the page it settled', () => {
        const stop = armPlaying();
        jest.advanceTimersByTime(Ambient.QUIET_MS);
        stop();
        expect(document.documentElement.hasAttribute(Ambient.ATTR)).toBe(false);
    });
});

describe('the event that tells it something started', () => {
    test('setting the media announces it', () => {
        const heard = [];
        document.addEventListener('nexus:media', (e) => heard.push(e.detail));
        CurrentMedia.set(TRACK);
        expect(heard).toEqual([{ playing: true }]);
    });

    test('clearing it announces that too', () => {
        const heard = [];
        document.addEventListener('nexus:media', (e) => heard.push(e.detail));
        CurrentMedia.clear();
        expect(heard).toEqual([{ playing: false }]);
    });

    test('and announcing does not disturb what the model reads', () => {
        // The suffix is the load-bearing output of this module; the event is a side channel.
        CurrentMedia.set(TRACK);
        expect(CurrentMedia.systemPromptSuffix()).toContain('Bohemian Rhapsody');
        expect(CurrentMedia.get().title).toBe('Bohemian Rhapsody');
    });
});
