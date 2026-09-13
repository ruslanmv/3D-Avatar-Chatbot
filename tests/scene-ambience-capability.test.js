/**
 * The ambience capability (batch A8).
 *
 * What goes into the system prompt, and — mostly — what does not. Four properties:
 *
 *   1. **Empty is byte-identical.** With the feature off, a chat sends exactly the prompt it sent
 *      before this file existed. Not a heading with "no scenes" under it; nothing.
 *   2. **It advertises what exists, not what was designed.** The resolver knows fourteen intents;
 *      the shipped art answers eight of them. A prompt listing `forest` would have her offer to
 *      take somebody to a forest and then decline — which is the specific dishonesty
 *      `TogetherCapability.canSearch()` exists to prevent.
 *   3. **No catalogue, no URLs, no ids.** Token cost must not grow with the library, and asset
 *      paths must never enter model reasoning.
 *   4. **The wording carries the four behaviours.** Do not ask permission; talking about a place
 *      is not asking to be in one; say it as going rather than arrived; never invent a name. Each
 *      is a failure mode, so each gets an assertion.
 */

const Capability = require('../src/features/ambience/SceneAmbienceCapability.js');
const Switch = require('../src/features/ambience/SceneAmbienceSwitch.js');
const Resolver = require('../src/features/ambience/SceneAmbienceResolver.js');
const Catalog = require('../src/gltf-viewer/ambience/ViewportBackgroundCatalog.js');
const fs = require('fs');
const path = require('path');

const SHIPPED = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../assets/ambient/backgrounds.json'), 'utf-8'));

/** Explicit deps, so a test never depends on which globals another test happened to set. */
function deps(overrides) {
    return { switch: Switch, resolver: Resolver, catalog: Catalog, ...overrides };
}

beforeEach(() => {
    localStorage.clear();
    Switch.reset();
    Catalog.reset();
    Catalog.ingest(SHIPPED);
});

describe('silence is the default', () => {
    test('off → empty string', () => {
        expect(Capability.systemPromptSuffix(deps())).toBe('');
    });

    test('off → not even a heading', () => {
        // The prompt a chat sends with this feature off must be byte-identical to the prompt it
        // sent before the feature existed. An empty section still changes the bytes.
        expect(Capability.systemPromptSuffix(deps())).not.toMatch(/WHERE|ambience|scene/i);
    });

    test('on but with nothing to show → empty string', () => {
        Switch.enable();
        Catalog.reset();
        expect(Capability.systemPromptSuffix(deps())).toBe('');
    });

    test('no switch module at all → empty string', () => {
        expect(Capability.systemPromptSuffix({ ...deps(), switch: null })).toBe('');
    });

    test('a switch without isEnabled → empty string', () => {
        expect(Capability.systemPromptSuffix({ ...deps(), switch: {} })).toBe('');
    });

    test('no resolver or no catalogue findable anywhere → empty string', () => {
        // Passing null alone falls through to the global, which is the house options pattern
        // (`options.intent || global.NEXUS_MEDIA_INTENT`). The property that matters is the
        // absence of the dependency altogether: nothing to resolve with means nothing to promise.
        Switch.enable();
        const savedResolver = global.NEXUS_SCENE_AMBIENCE_RESOLVER;
        const savedCatalog = global.NEXUS_VIEWPORT_BACKGROUND_CATALOG;
        try {
            delete global.NEXUS_SCENE_AMBIENCE_RESOLVER;
            expect(Capability.systemPromptSuffix({ switch: Switch, catalog: Catalog })).toBe('');
            global.NEXUS_SCENE_AMBIENCE_RESOLVER = savedResolver;
            delete global.NEXUS_VIEWPORT_BACKGROUND_CATALOG;
            expect(Capability.systemPromptSuffix({ switch: Switch, resolver: Resolver })).toBe('');
        } finally {
            global.NEXUS_SCENE_AMBIENCE_RESOLVER = savedResolver;
            global.NEXUS_VIEWPORT_BACKGROUND_CATALOG = savedCatalog;
        }
    });

    test('a resolver missing satisfiableIntents → empty string', () => {
        // An older build of the resolver, before A3 added it. Promise nothing rather than
        // assuming the method exists.
        Switch.enable();
        expect(Capability.systemPromptSuffix({ ...deps(), resolver: { MOODS: [] } })).toBe('');
    });

    test('a catalogue that throws → empty string, not a crash', () => {
        Switch.enable();
        const exploding = {
            images() {
                throw new Error('bad');
            },
        };
        expect(Capability.systemPromptSuffix({ ...deps(), catalog: exploding })).toBe('');
    });

    test('turning it off again goes straight back to silence', () => {
        Switch.enable();
        expect(Capability.systemPromptSuffix(deps())).not.toBe('');
        Switch.disable();
        expect(Capability.systemPromptSuffix(deps())).toBe('');
    });
});

describe('it advertises what exists, not what was designed', () => {
    beforeEach(() => Switch.enable());

    test('the vocabulary comes from the catalogue, not from a hard-coded list', () => {
        const suffix = Capability.systemPromptSuffix(deps());
        const offered = Capability.availableIntents(deps());
        expect(offered.length).toBeGreaterThan(0);
        for (const intent of offered) {
            expect(suffix).toContain(intent);
        }
    });

    test('the shipped art has no forest, so forest is not offered', () => {
        // The finding from A3, now enforced where it matters. Offering a forest and then
        // declining is the dishonesty canSearch() exists to prevent.
        const offered = Capability.availableIntents(deps());
        expect(offered).not.toContain('forest');
        expect(Resolver.INTENTS).toContain('forest');
        expect(Capability.systemPromptSuffix(deps())).not.toMatch(/\bforest\b/);
    });

    test('it offers strictly fewer intents than the resolver knows', () => {
        expect(Capability.availableIntents(deps()).length).toBeLessThan(Resolver.INTENTS.length);
    });

    test('every intent it offers actually resolves to a scene', () => {
        // The property the whole design rests on: nothing is promised that cannot happen.
        for (const intent of Capability.availableIntents(deps())) {
            expect(Resolver.resolve({ intent, entries: Catalog.images(), preference: 'auto' })).not.toBeNull();
        }
    });

    test('adding art widens the vocabulary with no code change', () => {
        const before = Capability.availableIntents(deps());
        expect(before).not.toContain('forest');
        Catalog.ingest([
            ...SHIPPED.scenes,
            {
                id: 'ambient:forest:day',
                type: 'image',
                label: 'Forest',
                src: 'assets/ambient/light/forest.webp',
                category: 'nature',
                tags: ['forest', 'woods', 'nature', 'relax'],
            },
        ]);
        expect(Capability.availableIntents(deps())).toContain('forest');
        expect(Capability.systemPromptSuffix(deps())).toMatch(/\bforest\b/);
    });

    test('canChangeAmbience tracks whether anything could happen', () => {
        expect(Capability.canChangeAmbience(deps())).toBe(true);
        Catalog.reset();
        expect(Capability.canChangeAmbience(deps())).toBe(false);
    });

    test('the moods it lists are the ones the resolver accepts', () => {
        const suffix = Capability.systemPromptSuffix(deps());
        for (const mood of Resolver.MOODS) {
            expect(suffix).toContain(mood);
        }
    });
});

describe('the catalogue never reaches the prompt', () => {
    beforeEach(() => Switch.enable());

    test('no asset path, no file name, no extension', () => {
        // Token cost must not grow with the library, and asset paths must never enter model
        // reasoning. She emits an intent; trusted code picks the file.
        const suffix = Capability.systemPromptSuffix(deps());
        expect(suffix).not.toMatch(/\.webp|\.png|\.jpg|assets\//);
        for (const entry of Catalog.images()) {
            expect(suffix).not.toContain(entry.src);
        }
    });

    test('no scene ids', () => {
        const suffix = Capability.systemPromptSuffix(deps());
        for (const entry of Catalog.images()) {
            expect(suffix).not.toContain(entry.id);
        }
        expect(suffix).not.toMatch(/ambient:/);
    });

    test('no URLs of any kind', () => {
        expect(Capability.systemPromptSuffix(deps())).not.toMatch(/https?:|\/\//);
    });

    test('it stays short, and does not grow when the library does', () => {
        const small = Capability.systemPromptSuffix(deps()).length;
        const many = [];
        for (let i = 0; i < 60; i += 1) {
            many.push({
                id: `ambient:scene${i}:day`,
                type: 'image',
                label: `Scene ${i}`,
                src: `assets/ambient/light/s${i}.webp`,
                category: 'relax',
                tags: ['sea', 'relax'],
            });
        }
        Catalog.ingest(many);
        expect(Capability.systemPromptSuffix(deps()).length).toBeLessThanOrEqual(small);
    });
});

describe('the wording carries the behaviours', () => {
    beforeEach(() => Switch.enable());
    const suffix = () => Capability.systemPromptSuffix(deps());

    test('it shows the tag syntax the parser accepts', () => {
        const Directive = require('../src/features/ambience/SceneAmbienceDirective.js');
        const text = suffix();
        expect(text).toContain('<ambience intent="sea" mood="relax"/>');
        // The example must be something the parser would actually accept, or the prompt is
        // teaching her a shape that gets refused.
        const example = text.match(/<ambience[^>]*\/>/)[0];
        expect(Directive.extract(example).directive).toEqual({ intent: 'sea', mood: 'relax' });
    });

    test('it tells her not to ask permission', () => {
        expect(suffix()).toMatch(/Do not ask whether they would like you/i);
    });

    test('it distinguishes talking about a place from asking to be in one', () => {
        const text = suffix();
        expect(text).toMatch(/Talking about a place is not asking to be in one/i);
        expect(text).toMatch(/beach last summer/i);
    });

    test('it asks for going-to language rather than a claim of arrival', () => {
        // Loading can fail and a scene can be missing. "We're at the beach now" becomes a lie
        // the UI then contradicts.
        expect(suffix()).toMatch(/somewhere you are going, not somewhere you have arrived/i);
    });

    test('it forbids inventing a URL, a file name or a scene name', () => {
        expect(suffix()).toMatch(/Never write a URL, a file name, a scene name or an ID/i);
    });

    test('it asks for at most one tag per reply', () => {
        expect(suffix()).toMatch(/at most one tag per reply/i);
    });

    test('it says a passing feeling is not a request', () => {
        expect(suffix()).toMatch(/I'm tired|that was stressful/i);
    });

    test('it starts and ends with a newline, like the other suffixes', () => {
        // main.js concatenates these; a missing boundary runs two sections together.
        const text = suffix();
        expect(text.startsWith('\n')).toBe(true);
        expect(text.endsWith('\n')).toBe(true);
    });
});

describe('the current-scene line', () => {
    beforeEach(() => Switch.enable());

    test('it names the scene showing now, so "somewhere brighter" works', () => {
        const text = Capability.systemPromptSuffix(deps({ currentId: 'ambient:terrace:night' }));
        expect(text).toContain('Right now you are both at: Coastal Terrace — Twilight');
    });

    test('it is absent when a colour is showing', () => {
        // "Right now you are both at: Black" is noise.
        const text = Capability.systemPromptSuffix(deps({ currentId: 'black' }));
        expect(text).not.toMatch(/Right now you are both at/);
    });

    test('it is absent when nothing is selected', () => {
        expect(Capability.systemPromptSuffix(deps())).not.toMatch(/Right now you are both at/);
    });

    test('it reads the label, never the id or the path', () => {
        const text = Capability.systemPromptSuffix(deps({ currentId: 'ambient:ocean:night' }));
        expect(text).toContain('Ocean — Moonlight');
        expect(text).not.toContain('ambient:ocean:night');
        expect(text).not.toContain('.webp');
    });

    test('it can read the viewer visual state instead of an explicit id', () => {
        const viewer = { getVisualState: () => ({ background: 'ambient:garden:day' }) };
        expect(Capability.systemPromptSuffix(deps({ viewer }))).toContain('Meditation Garden');
    });

    test('a viewer that throws does not take the suffix down', () => {
        const viewer = {
            getVisualState() {
                throw new Error('not ready');
            },
        };
        const text = Capability.systemPromptSuffix(deps({ viewer }));
        expect(text).not.toBe('');
        expect(text).not.toMatch(/Right now you are both at/);
    });

    test.each([['nope'], [''], [null], [undefined], [42]])('an unusable current id %p is skipped', (currentId) => {
        expect(() => Capability.systemPromptSuffix(deps({ currentId }))).not.toThrow();
    });
});

describe('it reads globals when nothing is injected', () => {
    test('the module registers itself the way boot.js expects', () => {
        expect(global.NEXUS_SCENE_AMBIENCE_CAPABILITY).toBeTruthy();
        expect(typeof global.NEXUS_SCENE_AMBIENCE_CAPABILITY.systemPromptSuffix).toBe('function');
    });

    test('with the globals in place and the switch on, it produces the paragraph', () => {
        // main.js calls it with no arguments, so the global path is the one that actually ships.
        Switch.enable();
        expect(Capability.systemPromptSuffix()).toMatch(/WHERE YOU BOTH ARE/);
    });

    test('with no arguments and the switch off, it is silent', () => {
        expect(Capability.systemPromptSuffix()).toBe('');
    });
});
