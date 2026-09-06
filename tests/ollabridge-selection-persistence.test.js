/**
 * @jest-environment node
 *
 * The model a paired device starts on has to be written to *both* places this app keeps it.
 *
 * `src/main.js` keeps the chosen model twice: `_nexusLLM`'s settings, which is what actually
 * sends the request, and `config`, an in-memory copy read from localStorage once at page load,
 * which is what the model dropdown restores from and what SAVE writes back.
 *
 * The post-pairing picker wrote only the first, and the failure that produced was four steps
 * long and looked like nothing to do with the pick:
 *
 *   1. pair — the dropdown shows the chosen model, chat works;
 *   2. press Fetch — `fetchAndPopulateModels` resets the dropdown and restores from
 *      `config.model`, which is still empty, so it lands on "Select a model…";
 *   3. press SAVE — which reads the dropdown, so `''` is written over the good value and the
 *      manager's model becomes `default`;
 *   4. speak — the gateway answers `default` with an empty string, and the app shows
 *      "Sorry, I encountered an error."
 *
 * Replayed in a real browser against the live gateway, before and after: the old code gives
 * `select: ""`, `label: "Select a model..."`, `nowSaved: "default"` and a "No response" reply;
 * the fixed code holds `free-best` through all four steps and answers "OK".
 *
 * That replay needs a live pairing token, so it cannot run here. What can is the invariant it
 * was violating, and it is worth pinning at the source: **a code path that chooses a model on
 * the user's behalf writes it to both stores.** Leaving them to converge on the next page load
 * is not enough — the window between pairing and reloading is exactly the window somebody uses
 * the app in.
 */

const fs = require('fs');
const path = require('path');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

/** The body of the post-pairing picker, which is where the regression lived. */
function pickerBody() {
    const start = MAIN.indexOf('function __nexusSelectPreferredOllaBridgeModel');
    expect(start).toBeGreaterThan(-1);
    const end = MAIN.indexOf('\nfunction ', start + 10);
    return MAIN.slice(start, end === -1 ? undefined : end);
}

describe('choosing a model on the user behalf', () => {
    test('writes it to the manager, which is what sends the request', () => {
        expect(pickerBody()).toMatch(/updateSettings\(\{\s*ollabridge:\s*\{\s*model:\s*chosen\s*\}\s*\}\)/);
    });

    test('and to config, which is what the dropdown and SAVE read', () => {
        // Without this line the pick survives until the next Fetch and is then silently
        // replaced by an empty selection, which SAVE writes back over it.
        expect(pickerBody()).toMatch(/config\.model\s*=\s*chosen/);
    });

    test('and reflects it in the dropdown', () => {
        expect(pickerBody()).toMatch(/selectElement\.value\s*=\s*chosen/);
    });
});

describe('repopulating the dropdown', () => {
    /** The restore step at the end of `fetchAndPopulateModels`. */
    function restoreBlock() {
        const marker = MAIN.indexOf('// Restore current selection if it exists');
        expect(marker).toBeGreaterThan(-1);
        return MAIN.slice(marker, marker + 900);
    }

    test('falls back to the stored model when config has none', () => {
        // The second half of the fix: a model chosen by something other than the settings form
        // must survive a Fetch rather than reverting to the placeholder. Belt and braces on
        // purpose — either half alone closes the reported bug, and the pair closes the class.
        const block = restoreBlock();
        expect(block).toMatch(/config\.model/);
        expect(block).toMatch(/getSettings\(\)\[provider\]/);
    });

    test('and writes the restored value back to config, so the two cannot drift', () => {
        expect(restoreBlock()).toMatch(/config\.model\s*=\s*restore/);
    });

    test('it still only restores a model that is actually in the list', () => {
        // Restoring an id the gateway no longer offers would select nothing and read as the
        // same placeholder bug from the other direction.
        expect(restoreBlock()).toMatch(/result\.models\.includes\(restore\)/);
    });
});
