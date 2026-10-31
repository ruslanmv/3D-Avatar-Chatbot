/**
 * Q9 — the app's icons: what a Quest, an Android launcher and a browser tab show for HomePilot.
 *
 * Guards three failures that shipped before: index.html linked a favicon.ico that did not exist
 * (every tab fell back to a generic globe), the manifest's "maskable" icons were the "any"
 * pictures (launchers crop to the central 40% circle, and half the silhouette was outside it),
 * and the icons were a generic person rather than the HomePilot mark.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file) {
    const b = fs.readFileSync(path.join(ROOT, file));
    expect(b.slice(1, 4).toString()).toBe('PNG');
    return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

test('every manifest icon exists at the size it declares', () => {
    const all = [...manifest.icons, ...(manifest.shortcuts || []).flatMap((s) => s.icons || [])];
    expect(all.length).toBeGreaterThan(0);
    for (const icon of all) {
        expect([icon.src, pngSize(icon.src)]).toEqual([icon.src, icon.sizes]);
    }
});

test('a 512 px icon exists for both purposes — what Meta and Bubblewrap pick', () => {
    for (const purpose of ['any', 'maskable']) {
        expect(manifest.icons.some((i) => i.purpose === purpose && i.sizes === '512x512')).toBe(true);
    }
});

test('maskable icons are their own padded pictures, not the "any" ones', () => {
    const any = new Set(manifest.icons.filter((i) => i.purpose === 'any').map((i) => i.src));
    const maskable = manifest.icons.filter((i) => i.purpose === 'maskable');
    expect(maskable.length).toBeGreaterThan(0);
    for (const icon of maskable) expect(any.has(icon.src)).toBe(false);
});

test('the launcher label is the brand and fits a Quest tile', () => {
    expect(manifest.short_name).toBe('HomePilot');
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
});

test('every icon index.html links to exists — favicon.ico included', () => {
    const hrefs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toContain('favicon.ico');
    for (const href of hrefs) expect([href, fs.existsSync(path.join(ROOT, href))]).toEqual([href, true]);
});

test('favicon.ico is a real icon file with 16, 32 and 48 px images', () => {
    const b = fs.readFileSync(path.join(ROOT, 'favicon.ico'));
    expect(b.readUInt16LE(0)).toBe(0); // reserved
    expect(b.readUInt16LE(2)).toBe(1); // type: icon
    const count = b.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => b.readUInt8(6 + i * 16));
    expect(sizes).toEqual([16, 32, 48]);
});
