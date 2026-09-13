/**
 * Wiring the AI path (batch A11).
 *
 * Five modules into the boot list, the capability at three prompt sites, the directive at two
 * strip sites, and a Settings section. Nothing here is new logic — A3, A7, A8, A9 and A10 each
 * shipped with their own unit tests — so what needs pinning is that every seam is connected
 * and that the ones deliberately left alone stayed that way.
 *
 * The assertions that matter most:
 *
 *   * **OFF is byte-identical.** The whole design rests on the capability returning '' when the
 *     switch is off, so a user who never enables this sends exactly the prompt they sent
 *     before the feature existed. Asserted against the real modules, not by reading source.
 *   * **all three prompt sites.** There are three, and the streaming and non-streaming paths
 *     are separate code. Wiring two of three gives a capability that works only when your
 *     provider happens to stream.
 *   * **both strip sites, at the displayText seam.** Strip once, and the bubble, transcript,
 *     VR forward and TTS are all covered together. Miss one and she reads markup aloud.
 *   * **the research consume sites stay out of it.** AI_SCENE_AMBIENCE.md section 14 is
 *     explicit: fewer execution paths. It would be easy to "helpfully" add them.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const mainSrc = fs.readFileSync(path.join(root, 'src/main.js'), 'utf-8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
const boot = fs.readFileSync(path.join(root, 'src/behavior/boot.js'), 'utf-8');

const Switch = require('../src/features/ambience/SceneAmbienceSwitch.js');
const Capability = require('../src/features/ambience/SceneAmbienceCapability.js');
const Directive = require('../src/features/ambience/SceneAmbienceDirective.js');
const Resolver = require('../src/features/ambience/SceneAmbienceResolver.js');
const Catalog = require('../src/gltf-viewer/ambience/ViewportBackgroundCatalog.js');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/ambient/backgrounds.json'), 'utf-8'));

/** One top-level function's body, sliced to its own closing brace at column 0. */
function fnBody(name) {
    let start = mainSrc.indexOf(`\nasync function ${name}(`);
    if (start === -1) start = mainSrc.indexOf(`\nfunction ${name}(`);
    if (start === -1) throw new Error(`no function ${name} in main.js`);
    const end = mainSrc.indexOf('\n}', start);
    const body = mainSrc.slice(start, end === -1 ? undefined : end);
    if (body.length < 200) throw new Error(`extractor produced an empty body for ${name}`);
    return body;
}

/** Strip comments. An assertion that a name is absent must read code, not the note explaining
 *  why the name is avoided — which is exactly how this one first failed. */
function stripComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** The radio-sync IIFE, sliced to its own `})();` rather than a guessed length. */
function syncBody() {
    const start = mainSrc.indexOf('function wireSceneAmbienceRadioSync');
    if (start === -1) throw new Error('no wireSceneAmbienceRadioSync');
    const end = mainSrc.indexOf('})();', start);
    const body = mainSrc.slice(start, end === -1 ? undefined : end + 5);
    if (body.length < 200) throw new Error('empty sync body');
    return body;
}

beforeEach(() => {
    localStorage.clear();
    Switch.reset();
    Catalog.reset();
});

afterEach(() => {
    Catalog.reset();
    delete global.NEXUS_SCENE_AMBIENCE_RESOLVER;
    delete global.NEXUS_VIEWPORT_BACKGROUND_CATALOG;
});

describe('boot.js loads all five, in a workable order', () => {
    const modules = [
        'SceneAmbienceResolver',
        'SceneAmbienceSwitch',
        'SceneAmbienceCapability',
        'SceneAmbienceController',
        'SceneAmbienceDirective',
    ];

    test.each(modules)('%s is in the list', (name) => {
        expect(boot).toContain(`'src/features/ambience/${name}.js'`);
    });

    test('the resolver and switch load before the modules that read them', () => {
        const at = (n) => boot.indexOf(`ambience/${n}.js`);
        expect(at('SceneAmbienceResolver')).toBeLessThan(at('SceneAmbienceCapability'));
        expect(at('SceneAmbienceSwitch')).toBeLessThan(at('SceneAmbienceCapability'));
        expect(at('SceneAmbienceController')).toBeLessThan(at('SceneAmbienceDirective'));
    });

    test('the renderer half is still loaded by index.html, not boot.js', () => {
        // ViewerEngine needs the catalogue synchronously at construction, which is before the
        // director's module list has run. Moving these into boot.js would silently disable
        // scenic backgrounds — the globals would simply be undefined and ViewerEngine null-guards.
        for (const file of ['coverTransform.js', 'ViewportBackgroundCatalog.js', 'ViewportBackgroundManager.js']) {
            expect(html).toContain(`src/gltf-viewer/ambience/${file}`);
            expect(boot).not.toContain(`gltf-viewer/ambience/${file}`);
        }
    });
});

describe('the capability reaches all three prompt sites', () => {
    test('there are exactly three, and all three carry it', () => {
        const together = mainSrc.match(/NEXUS_TOGETHER_CAPABILITY\?\.systemPromptSuffix/g) || [];
        const ambience = mainSrc.match(/NEXUS_SCENE_AMBIENCE_CAPABILITY\?\.systemPromptSuffix/g) || [];
        expect(together).toHaveLength(3);
        expect(ambience).toHaveLength(3);
    });

    test('the three sites are the three that build a prompt', () => {
        // Not the two request handlers, as it first looked: the non-streaming handler delegates
        // to callLLM, which assembles its own prompt. The three are the streaming chain,
        // callLLM, and the shared __nexusMediaSuffix helper. Wiring the wrong two gives a
        // capability that works only when your provider happens to stream.
        expect(fnBody('_handleStreamingResponse')).toContain('NEXUS_SCENE_AMBIENCE_CAPABILITY');
        expect(fnBody('callLLM')).toContain('NEXUS_SCENE_AMBIENCE_CAPABILITY');
        expect(fnBody('__nexusMediaSuffix')).toContain('NEXUS_SCENE_AMBIENCE_CAPABILITY');
    });

    test('each of those already carried the Together capability, so the set is the same', () => {
        // The check that stops a fourth prompt site appearing without this one.
        for (const name of ['_handleStreamingResponse', 'callLLM', '__nexusMediaSuffix']) {
            expect(fnBody(name)).toContain('NEXUS_TOGETHER_CAPABILITY');
        }
    });

    test('it is optional-chained, so an unloaded module is an empty string', () => {
        expect(mainSrc).not.toMatch(/window\.NEXUS_SCENE_AMBIENCE_CAPABILITY\.systemPromptSuffix\(\)/);
        expect(mainSrc).toContain("(window.NEXUS_SCENE_AMBIENCE_CAPABILITY?.systemPromptSuffix?.() || '')");
    });
});

describe('OFF is byte-identical to the app before this feature', () => {
    test('the suffix is empty with the switch off, even with a full catalogue', () => {
        Catalog.ingest(manifest);
        global.NEXUS_SCENE_AMBIENCE_RESOLVER = Resolver;
        global.NEXUS_VIEWPORT_BACKGROUND_CATALOG = Catalog;
        expect(Switch.isEnabled()).toBe(false);
        expect(Capability.systemPromptSuffix()).toBe('');
    });

    test('and empty on a fresh profile with nothing loaded at all', () => {
        expect(Capability.systemPromptSuffix()).toBe('');
    });

    test('ON with art produces a real paragraph', () => {
        Catalog.ingest(manifest);
        Switch.enable();
        const suffix = Capability.systemPromptSuffix({ resolver: Resolver, catalog: Catalog });
        expect(suffix).toContain('WHERE YOU BOTH ARE');
        expect(suffix).toContain('<ambience');
    });

    test('ON with no art is still empty — no promise nothing can keep', () => {
        Switch.enable();
        expect(Capability.systemPromptSuffix({ resolver: Resolver, catalog: Catalog })).toBe('');
    });

    test('the prompt never names a scene id, a path or a URL', () => {
        Catalog.ingest(manifest);
        Switch.enable();
        const suffix = Capability.systemPromptSuffix({ resolver: Resolver, catalog: Catalog });
        expect(suffix).not.toContain('assets/');
        expect(suffix).not.toContain('.webp');
        expect(suffix).not.toContain('ambient:');
        expect(suffix).not.toMatch(/https?:/);
    });
});

describe('the directive is stripped at both seams', () => {
    test('both strip sites carry it', () => {
        const hits = mainSrc.match(/NEXUS_SCENE_AMBIENCE_DIRECTIVE\.consume\(displayText\)/g) || [];
        expect(hits).toHaveLength(2);
    });

    test('it sits with the other directives at the displayText seam', () => {
        // One strip covers the bubble, the transcript, the VR forward and the voice, because
        // they all read `displayText`. A tag reaching TTS is her reading markup aloud.
        const at = (needle) => mainSrc.indexOf(needle);
        expect(at('NEXUS_STUDY_DIRECTIVE.consume(displayText)')).toBeLessThan(at('NEXUS_SCENE_AMBIENCE_DIRECTIVE'));
    });

    test('it runs before the VR forward and before speakText', () => {
        const streaming = mainSrc.slice(mainSrc.indexOf('async function _handleStreamingResponse'));
        const body = streaming.slice(0, streaming.indexOf('} catch (error)'));
        expect(body.indexOf('NEXUS_SCENE_AMBIENCE_DIRECTIVE')).toBeLessThan(body.indexOf('speakText(displayText)'));
        expect(body.indexOf('NEXUS_SCENE_AMBIENCE_DIRECTIVE')).toBeLessThan(body.indexOf('sendBotResponseToVR'));
    });

    test('the three research consume sites are deliberately left alone', () => {
        // AI_SCENE_AMBIENCE.md section 14: fewer execution paths. Adding them would look helpful.
        for (const file of [
            'src/features/research/SearchQuality.js',
            'src/features/research/LookUp.js',
            'src/features/research/SearchUX.js',
        ]) {
            const src = fs.readFileSync(path.join(root, file), 'utf-8');
            expect(src).not.toContain('NEXUS_SCENE_AMBIENCE_DIRECTIVE');
        }
    });

    test('a tag never survives into what is displayed', () => {
        const reply = 'Let\'s go somewhere quiet. <ambience intent="sea" mood="relax"/>';
        expect(Directive.extract(reply).clean).toBe("Let's go somewhere quiet.");
    });

    test('a user typing the tag is not a capability', () => {
        // consume() is called on assistant replies only. This pins the call sites rather than
        // the parser: handleUserMessage must not run it over `text`.
        const handler = mainSrc.slice(mainSrc.indexOf('async function handleUserMessage'));
        expect(handler.slice(0, handler.indexOf('\n}'))).not.toContain('NEXUS_SCENE_AMBIENCE_DIRECTIVE');
    });
});

describe('Settings — the toggle, and what it does not gate', () => {
    test('the toggle and the preference select exist', () => {
        expect(html).toContain('id="scene-ambience-toggle"');
        expect(html).toContain('id="scene-ambience-preference"');
    });

    test('the dropdown ships disabled, because the toggle ships off', () => {
        const select = html.slice(html.indexOf('id="scene-ambience-preference"'));
        expect(select.slice(0, 200)).toContain('disabled');
    });

    test('every preference the switch knows has an option', () => {
        const select = html.slice(html.indexOf('<select id="scene-ambience-preference"'));
        const block = select.slice(0, select.indexOf('</select>'));
        for (const value of Switch.PREFERENCES) {
            expect(block).toContain(`value="${value}"`);
        }
    });

    test('it reads and writes the switch module, never localStorage directly', () => {
        // The switch is the one owner of that state; writing the key here would leave the
        // capability and the UI disagreeing until the next reload.
        const script = html.slice(
            html.indexOf('var sceneBox ='),
            html.indexOf("var box = document.getElementById('behavior-engine-toggle')")
        );
        expect(script).toContain('NEXUS_SCENE_AMBIENCE_SWITCH');
        expect(script).not.toContain('localStorage');
        expect(script).toContain('nexus_scene_ambience_enabled'.replace('nexus_scene_ambience_enabled', 'setEnabled'));
    });

    test('the dropdown is enabled and disabled with the toggle', () => {
        const script = html.slice(html.indexOf('var sceneBox ='));
        expect(script.slice(0, 2200)).toContain('scenePref.disabled = !on');
    });

    test("it does not use the other feature's ambient namespace", () => {
        const script = html.slice(
            html.indexOf('var sceneBox ='),
            html.indexOf("var box = document.getElementById('behavior-engine-toggle')")
        );
        expect(script).not.toMatch(/NEXUS_AMBIENT\b/);
    });

    test('turning it off does not touch the visible background', () => {
        // The mental model: Viewport Background = what I see; Ambience = whether she may
        // change it. Losing your backdrop for revoking a permission would be a punishment.
        const script = html.slice(
            html.indexOf('var sceneBox ='),
            html.indexOf("var box = document.getElementById('behavior-engine-toggle')")
        );
        expect(script).not.toContain('setDesktopBackground');
        expect(script).not.toContain('desktop_bg');
    });

    test('the scene cards live in their own section, not under this toggle', () => {
        // Two different Settings sections, and deliberately so: the pictures are "what I see"
        // and stay reachable whatever this toggle says. The toggle is in the behaviour panel,
        // which comes first in the document — so this is about containment, not order.
        //
        // A17 renamed the section the grid sits in (VIEWPORT BACKGROUND became SCENES, with the
        // five colours following as FALLBACK BACKGROUND). The containment claim is unchanged,
        // so this asserts it against the toggle and the grid rather than against a heading.
        const toggleGroup = html.indexOf('id="scene-ambience-toggle"');
        const grid = html.indexOf('id="bg-scene-grid"');
        const scenesSection = html.lastIndexOf('<div class="config-section">', grid);
        expect(toggleGroup).toBeGreaterThan(-1);
        expect(grid).toBeGreaterThan(-1);
        // The grid's own section starts after the toggle, so no reading of the document puts one
        // inside the other.
        expect(scenesSection).toBeGreaterThan(toggleGroup);
    });
});

describe('an AI change updates an open Settings panel', () => {
    test('it listens for the controller event', () => {
        expect(mainSrc).toContain('wireSceneAmbienceRadioSync');
        expect(mainSrc).toContain("NEXUS_SCENE_AMBIENCE_CONTROLLER?.EVENT || 'nexus:scene-ambience-change'");
    });

    test('it re-ticks through the shared pre-select rather than its own selector', () => {
        expect(syncBody()).toContain('_preselectBackgroundCard()');
    });

    test('settings-sourced changes are skipped', () => {
        // The radio that caused one is already checked; re-ticking fights a user mid-click.
        expect(syncBody()).toContain("if (detail.source === 'settings') return;");
    });

    test('visibility is the active class, not an inline display style', () => {
        // .modal-overlay is display:none and .modal-overlay.active is display:flex, so reading
        // style.display would see '' on a closed modal and act on a panel nobody is looking at.
        const body = syncBody();
        expect(body).toContain("classList.contains('active')");
        expect(stripComments(body)).not.toContain('style.display');
    });
});

describe('desktop_bg is written once, by the path that always wrote it', () => {
    test('only the settings save path writes the key', () => {
        const writes = mainSrc.match(/localStorage\.setItem\('desktop_bg'/g) || [];
        expect(writes).toHaveLength(1);
    });

    test('and the ambience modules never write it themselves', () => {
        for (const file of fs.readdirSync(path.join(root, 'src/features/ambience'))) {
            const src = fs.readFileSync(path.join(root, 'src/features/ambience', file), 'utf-8');
            expect(src).not.toContain("setItem('desktop_bg'");
        }
    });
});
