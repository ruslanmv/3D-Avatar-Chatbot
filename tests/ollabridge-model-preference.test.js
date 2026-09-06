/**
 * @jest-environment node
 *
 * Which model a freshly paired device starts on.
 *
 * A device that has just paired has no model chosen — it sits on `default` — and the very next
 * thing the user does is send a message. So the choice made at that moment is the one that
 * decides whether the feature feels like theirs.
 *
 * The ladder is local, then HomePilot, then cloud, and each rung is there for a reason:
 *
 *   * a `shared_device` model runs on the user's **own** machine over their own relay. It costs
 *     nothing, it is private, and it is the thing they connected a PC in order to use. Landing
 *     on a cloud route while their GPU sits idle is the wrong default even when the cloud is
 *     faster — that PC is what they just paired;
 *   * a HomePilot persona is a configured identity with memory behind it, which beats a bare
 *     model but is a heavier thing to start on than one they own outright;
 *   * cloud is always reachable and is the right answer when the first two rungs are empty.
 *
 * These are order tests rather than behaviour tests on purpose. Nothing about the UI would look
 * wrong if the order were quietly reversed by a later change to the selector's grouping, and
 * nobody would notice until a user's own machine stopped being used.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadLLMManager() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'LLMManager.js'), 'utf8');
    const sandbox = { window: {}, console, setTimeout, clearTimeout };
    sandbox.global = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    return sandbox.window.LLMManager || sandbox.LLMManager;
}

const LLMManager = loadLLMManager();
const pick = (entries) => LLMManager.pickPreferredModel(entries);

/** The shape `_fetchOllaBridgeModels` produces, which is what the picker actually sees. */
const entry = (id, source, available = true) => ({ id, source, available, displayName: id });

const LOCAL = entry('llama3.1:8b', 'shared_device');
const AGENT = entry('persona:lina', 'homepilot');
const ROUTE = entry('free-fast', 'route_alias');
const CATALOG = entry('qwen2.5:1.5b', 'cloud_catalog');

describe('the model a paired device starts on', () => {
    test('the user own machine wins over everything else', () => {
        expect(pick([ROUTE, CATALOG, AGENT, LOCAL])).toBe(LOCAL.id);
    });

    test('and it wins regardless of the order the server listed them in', () => {
        // The ladder is a preference, not a re-reading of the server's ordering.
        expect(pick([LOCAL, ROUTE])).toBe(LOCAL.id);
        expect(pick([ROUTE, LOCAL])).toBe(LOCAL.id);
    });

    test('HomePilot comes next when there is no local model', () => {
        expect(pick([ROUTE, CATALOG, AGENT])).toBe(AGENT.id);
    });

    test('a persona listed under either source name counts as HomePilot', () => {
        // The client tags ids beginning `persona:` itself and takes `x_source` for the rest, so
        // both spellings reach this function and both mean the same rung.
        expect(pick([ROUTE, entry('persona:ana', 'persona')])).toBe('persona:ana');
    });

    test('cloud is last, and a smart route beats a fixed catalog entry', () => {
        // A route picks among candidates and degrades; a catalog entry is one model on the
        // gateway's own box.
        expect(pick([CATALOG, ROUTE])).toBe(ROUTE.id);
        expect(pick([CATALOG])).toBe(CATALOG.id);
    });

    test('an unavailable model is never the one it starts on', () => {
        // Advertising an unavailable model as the default makes the first message after pairing
        // fail, which is the worst possible moment for it.
        expect(pick([entry('llama3.1:8b', 'shared_device', false), ROUTE])).toBe(ROUTE.id);
        expect(pick([LOCAL, entry('x', 'shared_device', false)])).toBe(LOCAL.id);
    });

    test('nothing usable is null, not a guess', () => {
        // The caller shows "no models available"; inventing an id here would produce a 404 on
        // the first message instead.
        expect(pick([])).toBeNull();
        expect(pick(null)).toBeNull();
        expect(pick([entry('x', 'shared_device', false)])).toBeNull();
    });

    test('a source this build has never heard of is still better than nothing', () => {
        // The taxonomy grows on the server. A model that works should not be passed over because
        // its label is newer than this client.
        expect(pick([entry('something-new', 'managed_dedicated')])).toBe('something-new');
    });

    test('the ladder is exactly local, HomePilot, cloud', () => {
        // Written out so a reordering is a failing test rather than a silent change of default.
        expect(LLMManager.MODEL_PREFERENCE).toEqual([
            'shared_device',
            'homepilot',
            'persona',
            'route_alias',
            'route',
            'cloud_catalog',
        ]);
    });

    test('an instance can ask as well as the class', () => {
        const manager = new LLMManager();
        expect(manager.pickPreferredModel([ROUTE, LOCAL])).toBe(LOCAL.id);
    });

    test('the live account today has only cloud routes, so it starts on one', () => {
        // What `/v1/models` actually returned for this account while testing: five route
        // aliases, no device attached, no HomePilot. The ladder falls through to cloud, which is
        // correct — and this test is what will notice when a PC is finally attached.
        const live = [
            entry('free-best', 'route_alias'),
            entry('free-fast', 'route_alias'),
            entry('qwen2.5:1.5b', 'route_alias'),
            entry('free-flex', 'route_alias'),
            entry('cheap-reasoning', 'route_alias'),
        ];
        expect(pick(live)).toBe('free-best');
    });
});
