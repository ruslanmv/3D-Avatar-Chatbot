/**
 * V3. The Avatar Library's first load reads as loading, not as a broken page.
 *
 * My Avatars is local, but it was drawn only after every remote source had answered — with
 * VRoid Hub connected, a discovery of thousands of models — so the page opened on an empty
 * tab under a line of static text. vrm-manager.js is a plain script Jest cannot require, so
 * the order is pinned in its source and setStatus is run from its own text.
 */

/* global describe, test, expect */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const manager = fs.readFileSync(path.join(ROOT, 'vrm-manager.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'vrm-manager.css'), 'utf8');

function method(head) {
    const body = manager.slice(manager.indexOf(head));
    return body.slice(0, body.indexOf('\n    },'));
}

describe('first paint', () => {
    test('My Avatars is drawn before the catalogue is fetched', () => {
        const init = method('    async init() {');
        const early = init.indexOf('this.renderInstalledGrid()');
        const fetch = init.indexOf('await this.loadCatalog()');
        expect(early).toBeGreaterThan(-1);
        expect(early).toBeLessThan(fetch);
    });

    test('its thumbnails are restored before that first draw, and given to the catalogue after', () => {
        const init = method('    async init() {');
        expect(init.indexOf('await restoreThumbnailsFromDB()')).toBeLessThan(
            init.indexOf('this.renderInstalledGrid()')
        );
        expect(init.lastIndexOf('await restoreThumbnailsFromDB()')).toBeGreaterThan(
            init.indexOf('await this.loadCatalog()')
        );
    });

    test('each source is merged as it arrives, without starting a search, and all are awaited', () => {
        const load = method('    async loadCatalog() {');
        expect(load).toMatch(/fetchers\.map\(/);
        expect(load).toMatch(/allItems = allItems\.concat\(items\)/);
        expect(load).toMatch(/this\._skipVroidSearch = true; \/\/ a merge is not a new search/);
        expect(load).toMatch(/await Promise\.allSettled\(merged\)/);
        // Merged once each: the old concat-after-allSettled is gone, so nothing is added twice.
        expect((load.match(/allItems = allItems\.concat\(/g) || []).length).toBe(1);
    });
});

describe('setStatus', () => {
    const source = manager.slice(manager.indexOf('function setStatus('));
    const fnText = source.slice(0, source.indexOf('\n}\n') + 2);
    // eslint-disable-next-line no-new-func
    const setStatus = new Function('el', `${fnText}; return setStatus;`)((id) => document.getElementById(id));

    test('busy shows a spinner, the message and a bar, and says so to assistive tech', () => {
        document.body.innerHTML = '<div id="vm-status"></div>';
        setStatus('Loading avatar catalog… 1 of 3 sources', { busy: true });
        const status = document.getElementById('vm-status');
        expect(status.classList.contains('vm-status-busy')).toBe(true);
        expect(status.getAttribute('aria-busy')).toBe('true');
        expect(status.querySelector('.vm-status-spinner')).not.toBeNull();
        expect(status.querySelector('.vm-status-bar')).not.toBeNull();
        expect(status.textContent).toBe('Loading avatar catalog… 1 of 3 sources');
    });

    test('plain messages and clearing are exactly as before', () => {
        document.body.innerHTML = '<div id="vm-status"></div>';
        const status = document.getElementById('vm-status');
        setStatus('Working', { busy: true });
        setStatus('');
        expect(status.textContent).toBe('');
        expect(status.classList.contains('vm-status-busy')).toBe(false);
        setStatus('Saved');
        expect(status.innerHTML).toBe('Saved');
    });

    test('the animation stops for people who ask for less motion', () => {
        expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.vm-status-spinner/);
    });
});

describe('V4: each tab shows its own status and count', () => {
    const html = fs.readFileSync(path.join(ROOT, 'vrm-manager.html'), 'utf8');

    test('the page opens on My Avatars, and the catalogue status is hidden there', () => {
        expect(html).toMatch(/<main class="vm-main" data-tab="installed">/);
        expect(css).toMatch(/\.vm-main\[data-tab='installed'\] \.vm-status \{\s*display: none;/);
    });

    test('switching tabs records the tab and recounts', () => {
        const fn = method('    switchTab(tabName) {');
        expect(fn).toMatch(/main\.dataset\.tab = tabName/);
        expect(fn).toMatch(/this\.updateStats\(\)/);
    });

    test('My Avatars counts installed avatars; Browse Catalog keeps its count', () => {
        const fn = method('    updateStats() {');
        const installed = fn.indexOf("main.dataset.tab === 'installed'");
        expect(installed).toBeGreaterThan(-1);
        expect(fn).toMatch(/\$\{allInst\.length\} installed \| \$\{coreCount\} core \+ \$\{userCount\} user-installed/);
        expect(fn).toMatch(
            /\$\{shown\} of \$\{total\} avatars \| \$\{coreCount\} core \+ \$\{userCount\} user-installed/
        );
    });
});
