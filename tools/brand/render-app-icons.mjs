#!/usr/bin/env node
/**
 * render-app-icons — Q9. Render the HomePilot app icon to every size the app ships.
 *
 *   node tools/brand/render-app-icons.mjs
 *
 * Sources (both in this repository, Apache-2.0, derived from assets/homepilot-logo.svg):
 *   assets/app-icon.svg            the icon, mark at full size
 *   assets/app-icon-maskable.svg   the same icon with the mark inside the maskable safe zone
 *
 * Writes:
 *   assets/app-icon-512.png, assets/app-icon-192.png          manifest "any"
 *   assets/app-icon-maskable-512.png, -maskable-192.png       manifest "maskable"
 *   assets/app-icon-180.png                                    apple-touch-icon
 *   favicon.ico                                                16/32/48 px, PNG-in-ICO
 *
 * Why a tool and not hand-exported PNGs: the PNGs are what a Quest, an Android launcher and a
 * browser tab actually show, and a tool is how they stay the same picture as the SVG the next time
 * the mark changes. Chromium rasterises the SVG (the same engine that draws the page), and the
 * .ico is written here as a plain PNG-in-ICO container, which every current browser reads, so
 * nothing beyond Playwright is needed. Needs Playwright with Chromium, as tools/try-on-tour.mjs:
 * `npm i --no-save playwright && npx playwright install chromium`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const JOBS = [
    { svg: 'assets/app-icon.svg', size: 512, out: 'assets/app-icon-512.png' },
    { svg: 'assets/app-icon.svg', size: 192, out: 'assets/app-icon-192.png' },
    { svg: 'assets/app-icon.svg', size: 180, out: 'assets/app-icon-180.png' },
    { svg: 'assets/app-icon-maskable.svg', size: 512, out: 'assets/app-icon-maskable-512.png' },
    { svg: 'assets/app-icon-maskable.svg', size: 192, out: 'assets/app-icon-maskable-192.png' },
];
const FAVICON_SIZES = [16, 32, 48];

async function loadPlaywright() {
    try {
        return await import('playwright');
    } catch {
        // A globally installed Playwright is found through NODE_PATH, which require() honours and
        // ESM import() does not.
        try {
            return createRequire(import.meta.url)('playwright');
        } catch {
            console.error('Playwright is not installed: npm i --no-save playwright && npx playwright install chromium');
            process.exit(2);
        }
    }
}

/** One PNG of `svgFile` at `size` × `size`, drawn by Chromium. */
async function render(page, svgFile, size) {
    const svg = fs.readFileSync(path.join(ROOT, svgFile), 'utf8');
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
        `<html><body style="margin:0;background:transparent">` +
            svg.replace('<svg ', `<svg style="display:block;width:${size}px;height:${size}px" `) +
            `</body></html>`
    );
    return page.screenshot({ clip: { x: 0, y: 0, width: size, height: size }, omitBackground: true });
}

/** A .ico holding PNG images — ICONDIR, one ICONDIRENTRY per image, then the PNG bytes. */
function pngIco(images) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(images.length, 4);
    const entries = [];
    let offset = 6 + 16 * images.length;
    for (const { size, png } of images) {
        const e = Buffer.alloc(16);
        e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
        e.writeUInt8(size >= 256 ? 0 : size, 1); // height
        e.writeUInt8(0, 2); // palette colours
        e.writeUInt8(0, 3); // reserved
        e.writeUInt16LE(1, 4); // colour planes
        e.writeUInt16LE(32, 6); // bits per pixel
        e.writeUInt32LE(png.length, 8);
        e.writeUInt32LE(offset, 12);
        offset += png.length;
        entries.push(e);
    }
    return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage();
try {
    for (const job of JOBS) {
        const png = await render(page, job.svg, job.size);
        fs.writeFileSync(path.join(ROOT, job.out), png);
        console.log(`wrote ${job.out} (${job.size}×${job.size}, ${png.length} bytes)`);
    }
    const images = [];
    for (const size of FAVICON_SIZES) images.push({ size, png: await render(page, 'assets/app-icon.svg', size) });
    const ico = pngIco(images);
    fs.writeFileSync(path.join(ROOT, 'favicon.ico'), ico);
    console.log(`wrote favicon.ico (${FAVICON_SIZES.join('/')} px, ${ico.length} bytes)`);
} finally {
    await browser.close();
}
