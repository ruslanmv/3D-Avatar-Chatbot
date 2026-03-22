#!/usr/bin/env node
/**
 * Test: VRM Manager Catalog Sort & Filter System
 *
 * Validates that the sort dropdown, like_count metadata, format priority,
 * and source priority work correctly — matching industry best practices
 * from the Avatar Catalog reference implementation.
 *
 * Usage:  node tests/test-catalog-sort.cjs
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function log(status, msg) {
    const icon = status === 'PASS' ? '\x1b[32m✓\x1b[0m' : status === 'FAIL' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m→\x1b[0m';
    console.log(`  ${icon} ${msg}`);
    if (status === 'PASS') passed++;
    if (status === 'FAIL') failed++;
}

const vrmCode = fs.readFileSync(path.join(__dirname, '..', 'vrm-manager.js'), 'utf8');
const htmlCode = fs.readFileSync(path.join(__dirname, '..', 'vrm-manager.html'), 'utf8');

// Extract the applyFilters method body precisely (definition, not call sites)
const applyStart = vrmCode.indexOf('    applyFilters() {');
const applyEnd = vrmCode.indexOf('    renderGrid(', applyStart);
const applyBody = applyStart > 0 && applyEnd > applyStart ? vrmCode.substring(applyStart, applyEnd) : '';

// Extract fetchHomePilotCatalog method body
const fetchHPStart = vrmCode.indexOf('    async fetchHomePilotCatalog()');
const fetchHPEnd = vrmCode.indexOf('\n    },', fetchHPStart);
const fetchHPBody = fetchHPStart > 0 && fetchHPEnd > fetchHPStart ? vrmCode.substring(fetchHPStart, fetchHPEnd) : '';

// ─── Sort Dropdown UI ────────────────────────────────────────

function testSortDropdown() {
    console.log('\n--- Sort Dropdown UI ---');

    log(htmlCode.includes('id="vm-filter-sort"') ? 'PASS' : 'FAIL',
        'Sort dropdown exists in HTML (vm-filter-sort)');

    const sortOptions = ['popular', 'name', 'name-desc', 'size', 'size-desc', 'source'];
    for (const opt of sortOptions) {
        log(htmlCode.includes(`value="${opt}"`) ? 'PASS' : 'FAIL',
            `Sort option "${opt}" present in dropdown`);
    }

    // Default should be "popular" (first option)
    const sortSection = htmlCode.substring(
        htmlCode.indexOf('id="vm-filter-sort"'),
        htmlCode.indexOf('</select>', htmlCode.indexOf('id="vm-filter-sort"'))
    );
    const firstOption = sortSection.match(/value="([^"]+)"/);
    log(firstOption && firstOption[1] === 'popular' ? 'PASS' : 'FAIL',
        'Default sort is "Most Popular" (first option)');
}

// ─── Sort Event Wiring ──────────────────────────────────────

function testSortWiring() {
    console.log('\n--- Sort Event Wiring ---');

    log(vrmCode.includes("el('vm-filter-sort').addEventListener") ? 'PASS' : 'FAIL',
        'Sort dropdown has change event listener');

    // Should trigger applyFilters — search near the listener registration
    const wireIdx = vrmCode.indexOf("el('vm-filter-sort').addEventListener");
    const wireSection = wireIdx > 0 ? vrmCode.substring(wireIdx, wireIdx + 120) : '';
    log(wireSection.includes('applyFilters') ? 'PASS' : 'FAIL',
        'Sort change triggers applyFilters()');
}

// ─── Like Count Metadata ────────────────────────────────────

function testLikeCountPreservation() {
    console.log('\n--- Like Count Metadata ---');

    log(fetchHPBody.includes('likeCount') ? 'PASS' : 'FAIL',
        'fetchHomePilotCatalog preserves likeCount field');

    log(fetchHPBody.includes('like_count') ? 'PASS' : 'FAIL',
        'fetchHomePilotCatalog reads metadata.like_count from catalog');

    log(fetchHPBody.includes("quality: entry.quality") ? 'PASS' : 'FAIL',
        'fetchHomePilotCatalog preserves quality field');

    log(fetchHPBody.includes('sourceCategory') ? 'PASS' : 'FAIL',
        'fetchHomePilotCatalog preserves sourceCategory field');
}

// ─── Sort Logic ─────────────────────────────────────────────

function testSortLogic() {
    console.log('\n--- Sort Logic (applyFilters) ---');

    // Format priority always first
    log(applyBody.includes('FORMAT_ORDER') ? 'PASS' : 'FAIL',
        'Uses FORMAT_ORDER constant for format priority');

    log(applyBody.includes("vrm: 0") ? 'PASS' : 'FAIL',
        'VRM has highest format priority (0)');

    // Sort switch cases
    log(applyBody.includes("case 'popular'") ? 'PASS' : 'FAIL',
        'Has "popular" sort case (like_count based)');

    log(applyBody.includes("case 'name'") ? 'PASS' : 'FAIL',
        'Has "name" sort case');

    log(applyBody.includes("case 'name-desc'") ? 'PASS' : 'FAIL',
        'Has "name-desc" sort case');

    log(applyBody.includes("case 'size'") ? 'PASS' : 'FAIL',
        'Has "size" sort case');

    log(applyBody.includes("case 'size-desc'") ? 'PASS' : 'FAIL',
        'Has "size-desc" sort case');

    log(applyBody.includes("case 'source'") ? 'PASS' : 'FAIL',
        'Has "source" (collection) sort case');

    // Popular sort uses likeCount
    log(applyBody.includes('likeCount') ? 'PASS' : 'FAIL',
        '"popular" sort uses likeCount for ranking');

    // Installed items still sink to bottom
    log(applyBody.includes('isInstalled') ? 'PASS' : 'FAIL',
        'Installed items still sorted to bottom');

    // Format priority applied before sort switch (VRM first always)
    const fmtDiffIdx = applyBody.indexOf('fmtDiff');
    const switchIdx = applyBody.indexOf('switch (sortBy)');
    log(fmtDiffIdx > 0 && switchIdx > 0 && fmtDiffIdx < switchIdx ? 'PASS' : 'FAIL',
        'Format priority applied BEFORE sort switch (VRM always first)');
}

// ─── Source Priority ────────────────────────────────────────

function testSourcePriority() {
    console.log('\n--- Source Priority ---');

    // Category-based priority (matches catalog: vroid=0, open_source=2)
    log(applyBody.includes('CAT_ORDER') ? 'PASS' : 'FAIL',
        'Uses CAT_ORDER for category-based source priority');

    log(applyBody.includes("vroid: 0") ? 'PASS' : 'FAIL',
        'VRoid Hub has highest source priority (0)');

    log(applyBody.includes("open_source: 2") ? 'PASS' : 'FAIL',
        'Open Source Avatars have lowest source priority (2)');

    // srcPri function uses sourceCategory when available
    log(applyBody.includes('sourceCategory') ? 'PASS' : 'FAIL',
        'srcPri uses sourceCategory from catalog data');
}

// ─── Consistency with Avatar Catalog ────────────────────────

function testCatalogConsistency() {
    console.log('\n--- Consistency with Avatar Catalog ---');

    const catalogAppPath = path.join(__dirname, '..', '..', 'vrm-avatar-catalog', 'docs', 'app.js');
    try {
        const catalogCode = fs.readFileSync(catalogAppPath, 'utf8');

        // Both have format-first sort
        log(catalogCode.includes('formatPriority') && vrmCode.includes('FORMAT_ORDER') ? 'PASS' : 'FAIL',
            'Both apps sort VRM before GLB (format priority)');

        // Both have popular sort with like_count
        log(catalogCode.includes('like_count') && vrmCode.includes('likeCount') ? 'PASS' : 'FAIL',
            'Both apps support popularity sort via like_count');

        // Both have same sort options
        const catalogSortOptions = ['popular', 'name', 'name-desc', 'size', 'size-desc', 'source'];
        const vrmHasSameOptions = catalogSortOptions.every(opt =>
            vrmCode.includes(`case '${opt}'`) || vrmCode.includes(`value="${opt}"`)
        );
        log(vrmHasSameOptions ? 'PASS' : 'FAIL',
            'VRM Manager has all 6 sort options matching Avatar Catalog');

        // Both prioritize vroid_hub
        log(catalogCode.includes('vroid_hub: 0') && vrmCode.includes('vroid: 0') ? 'PASS' : 'FAIL',
            'Both apps prioritize VRoid Hub models first');
    } catch (e) {
        log('FAIL', `Could not read catalog app.js: ${e.message}`);
    }
}

// ─── Main ────────────────────────────────────────────────────

function main() {
    console.log('==============================================');
    console.log(' VRM Manager Catalog Sort & Filter Tests');
    console.log('==============================================');

    testSortDropdown();
    testSortWiring();
    testLikeCountPreservation();
    testSortLogic();
    testSourcePriority();
    testCatalogConsistency();

    console.log('\n==============================================');
    console.log(` Results: \x1b[32m${passed} passed\x1b[0m, \x1b[${failed > 0 ? '31' : '32'}m${failed} failed\x1b[0m`);
    console.log('==============================================\n');

    process.exit(failed > 0 ? 1 : 0);
}

main();
