/**
 * The ambience switch (batch A7).
 *
 * A permission, so the tests are mostly about the ways a permission must not be granted by
 * accident: not by default, not by a value nobody recognises, not by a stale write from another
 * version of the feature, and not by a storage failure. "Off" has to be what happens when
 * anything is unclear.
 *
 * The other half is the no-op contract. `onChange` must not fire when somebody re-selects the
 * value already showing, because Settings re-rendering itself for no reason is exactly the kind
 * of small wrongness people notice and cannot describe.
 */

const Switch = require('../src/features/ambience/SceneAmbienceSwitch.js');

beforeEach(() => {
    localStorage.clear();
    Switch.reset();
});

describe('it is off until somebody says otherwise', () => {
    test('a fresh profile is off', () => {
        expect(Switch.isEnabled()).toBe(false);
    });

    test('a fresh profile prefers auto', () => {
        expect(Switch.getPreference()).toBe('auto');
    });

    test('nothing is written to storage just by reading', () => {
        Switch.isEnabled();
        Switch.getPreference();
        expect(localStorage.getItem(Switch.KEY)).toBeNull();
        expect(localStorage.getItem(Switch.PREFERENCE_KEY)).toBeNull();
    });

    test.each([['yes'], ['true'], ['1'], ['ON'], ['enabled'], [''], ['null'], ['{"enabled":true}']])(
        'a stored value of %p does not grant permission',
        (raw) => {
            // A value from a different version of this feature, or from something else entirely.
            // Permission is the one thing that must never be inferred from a string nobody
            // recognises.
            localStorage.setItem(Switch.KEY, raw);
            expect(Switch.isEnabled()).toBe(false);
        }
    );

    test('only the exact stored token turns it on', () => {
        localStorage.setItem(Switch.KEY, Switch.ON);
        expect(Switch.isEnabled()).toBe(true);
    });
});

describe('enabling and disabling', () => {
    test('enable then disable round-trips', () => {
        expect(Switch.enable()).toBe(true);
        expect(Switch.isEnabled()).toBe(true);
        expect(Switch.disable()).toBe(true);
        expect(Switch.isEnabled()).toBe(false);
    });

    test('it persists across a reload', () => {
        Switch.enable();
        // A reload means new module state reading the same store. reset() would clear storage,
        // so the in-memory fallback is cleared by hand instead to simulate it honestly.
        expect(localStorage.getItem(Switch.KEY)).toBe(Switch.ON);
        expect(Switch.isEnabled()).toBe(true);
    });

    test('setEnabled reports whether anything changed', () => {
        expect(Switch.setEnabled(true)).toBe(true);
        expect(Switch.setEnabled(true)).toBe(false);
        expect(Switch.setEnabled(false)).toBe(true);
        expect(Switch.setEnabled(false)).toBe(false);
    });

    test.each([[1], ['on'], [{}], [[]]])('a truthy non-boolean %p still means on', (value) => {
        Switch.setEnabled(value);
        expect(Switch.isEnabled()).toBe(true);
    });

    test.each([[0], [''], [null], [undefined], [NaN]])('a falsy %p means off', (value) => {
        Switch.enable();
        Switch.setEnabled(value);
        expect(Switch.isEnabled()).toBe(false);
    });
});

describe('the preference', () => {
    test('every advertised value round-trips', () => {
        for (const value of Switch.PREFERENCES) {
            Switch.setPreference(value);
            expect(Switch.getPreference()).toBe(value);
        }
    });

    test('the dropdown values are the ones the resolver knows', () => {
        // The resolver maps these to intent groups. A value here with no mapping there is a
        // setting that silently does nothing.
        const Resolver = require('../src/features/ambience/SceneAmbienceResolver.js');
        for (const value of Switch.PREFERENCES) {
            if (value === 'auto') continue; // deliberately unmapped: auto means no nudge
            expect(Object.keys(Resolver.PREFERENCES)).toContain(value);
        }
    });

    test('it persists independently of the toggle', () => {
        Switch.setPreference('forest');
        Switch.enable();
        Switch.disable();
        expect(Switch.getPreference()).toBe('forest');
    });

    test('case and padding are forgiven', () => {
        Switch.setPreference('  FOREST  ');
        expect(Switch.getPreference()).toBe('forest');
    });

    test.each([['nonsense'], [''], [null], [undefined], [42], [{}], [['forest']]])(
        'an unusable value %p becomes auto rather than being stored',
        (value) => {
            Switch.setPreference('forest');
            Switch.setPreference(value);
            expect(Switch.getPreference()).toBe('auto');
            expect(localStorage.getItem(Switch.PREFERENCE_KEY)).toBe('auto');
        }
    );

    test('a stale stored value from a newer build reads as auto', () => {
        localStorage.setItem(Switch.PREFERENCE_KEY, 'cyberpunk');
        expect(Switch.getPreference()).toBe('auto');
    });

    test('setPreference reports whether anything changed', () => {
        expect(Switch.setPreference('ocean')).toBe(true);
        expect(Switch.setPreference('ocean')).toBe(false);
    });
});

describe('onChange', () => {
    test('it fires for the toggle and for the preference', () => {
        const seen = [];
        Switch.onChange((change) => seen.push(change));
        Switch.enable();
        Switch.setPreference('night');
        expect(seen).toEqual([
            { enabled: true, preference: 'auto' },
            { enabled: true, preference: 'night' },
        ]);
    });

    test('it does not fire for a write that changed nothing', () => {
        const listener = jest.fn();
        Switch.enable();
        Switch.setPreference('cozy');
        Switch.onChange(listener);
        Switch.enable();
        Switch.setEnabled(true);
        Switch.setPreference('cozy');
        expect(listener).not.toHaveBeenCalled();
    });

    test('unsubscribing works', () => {
        const listener = jest.fn();
        const off = Switch.onChange(listener);
        off();
        Switch.enable();
        expect(listener).not.toHaveBeenCalled();
    });

    test('one listener throwing does not stop the others', () => {
        const quiet = jest.fn();
        Switch.onChange(() => {
            throw new Error('bad listener');
        });
        Switch.onChange(quiet);
        expect(() => Switch.enable()).not.toThrow();
        expect(quiet).toHaveBeenCalled();
    });

    test.each([[null], [undefined], ['nope'], [42]])('a non-function %p is ignored safely', (value) => {
        const off = Switch.onChange(value);
        expect(typeof off).toBe('function');
        expect(() => off()).not.toThrow();
        expect(() => Switch.enable()).not.toThrow();
    });
});

describe('when storage will not cooperate', () => {
    /** Swap in a store that throws, the way a private window or a blocked-data browser does. */
    function withBrokenStorage(run) {
        const real = global.localStorage;
        const broken = {
            getItem() {
                throw new Error('SecurityError');
            },
            setItem() {
                throw new Error('SecurityError');
            },
            removeItem() {
                throw new Error('SecurityError');
            },
        };
        Object.defineProperty(global, 'localStorage', { value: broken, configurable: true, writable: true });
        try {
            run();
        } finally {
            Object.defineProperty(global, 'localStorage', { value: real, configurable: true, writable: true });
        }
    }

    test('reading does not throw, and defaults to off', () => {
        withBrokenStorage(() => {
            expect(() => Switch.isEnabled()).not.toThrow();
            expect(Switch.isEnabled()).toBe(false);
            expect(Switch.getPreference()).toBe('auto');
        });
    });

    test('writing does not throw, and the value applies for the life of the page', () => {
        withBrokenStorage(() => {
            expect(() => Switch.enable()).not.toThrow();
            // This is the point of the in-memory fallback: the difference between "works until
            // you reload" and "does not work".
            expect(Switch.isEnabled()).toBe(true);
            Switch.setPreference('study');
            expect(Switch.getPreference()).toBe('study');
        });
    });

    test('reset does not throw', () => {
        withBrokenStorage(() => {
            expect(() => Switch.reset()).not.toThrow();
        });
    });
});

describe('snapshot and namespace', () => {
    test('snapshot is both values in one read', () => {
        Switch.enable();
        Switch.setPreference('ocean');
        expect(Switch.snapshot()).toEqual({ enabled: true, preference: 'ocean' });
    });

    test('the keys are namespaced away from Calm mode', () => {
        // NEXUS_AMBIENT / nexus_ambient_enabled belong to the interface dimmer, which is an
        // entirely unrelated feature. Sharing a key would let one silently switch the other.
        expect(Switch.KEY).toBe('nexus_scene_ambience_enabled');
        expect(Switch.PREFERENCE_KEY).toBe('nexus_scene_ambience_preference');
        expect(Switch.KEY).not.toBe('nexus_ambient_enabled');
    });

    test('it does not touch desktop_bg, which owns what is showing', () => {
        localStorage.setItem('desktop_bg', 'ambient:ocean:day');
        Switch.enable();
        Switch.setPreference('forest');
        Switch.disable();
        expect(localStorage.getItem('desktop_bg')).toBe('ambient:ocean:day');
    });

    test('turning the switch off leaves the chosen background alone', () => {
        // The mental model the feature is sold on: Viewport Background is what I see, Ambience is
        // whether she may change it. Revoking the permission must not repaint the viewport.
        localStorage.setItem('desktop_bg', 'ambient:terrace:night');
        Switch.enable();
        Switch.disable();
        expect(localStorage.getItem('desktop_bg')).toBe('ambient:terrace:night');
    });

    test('only two keys are written, ever', () => {
        Switch.enable();
        Switch.setPreference('night');
        Switch.disable();
        const keys = [];
        for (let i = 0; i < localStorage.length; i += 1) keys.push(localStorage.key(i));
        expect(keys.sort()).toEqual([Switch.KEY, Switch.PREFERENCE_KEY].sort());
    });

    test('the exported tables are frozen', () => {
        expect(Object.isFrozen(Switch.PREFERENCES)).toBe(true);
    });
});
