#!/usr/bin/env node
/**
 * Test: VRM Avatar Install Flow
 *
 * Tests the full download chain for avatars served from the R2 custom domain.
 * Validates: DNS, HTTPS, CORS headers, proxy allowlist, content-type, download.
 *
 * Network tests use curl (reliable in all environments).
 * Code logic tests verify source files directly.
 *
 * Usage:  node tests/test-install-flow.cjs
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEST_URL = 'https://avatars.yourfriend.online/vroid_hub/ruby-the-demon-7966170650761748708.vrm';
const CUSTOM_DOMAIN = 'avatars.yourfriend.online';
const ORIGINS = [
    'https://www.yourfriend.online',
    'https://yourfriend.online',
    'https://homepilotai.github.io',
];

let passed = 0;
let failed = 0;

function log(status, msg) {
    const icon = status === 'PASS' ? '\x1b[32m✓\x1b[0m' : status === 'FAIL' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m→\x1b[0m';
    console.log(`  ${icon} ${msg}`);
    if (status === 'PASS') passed++;
    if (status === 'FAIL') failed++;
}

function curl(args) {
    try {
        return execSync(`curl -s --connect-timeout 10 --max-time 15 ${args}`, {
            encoding: 'utf8',
            timeout: 20000,
        }).trim();
    } catch (e) {
        return e.stdout ? e.stdout.trim() : `ERROR: ${e.message}`;
    }
}

// ─── Network Tests (via curl) ───────────────────────────────

function testDNS() {
    console.log('\n--- DNS Resolution ---');
    const result = curl(`-o /dev/null -w "%{remote_ip}" "${TEST_URL}"`);
    if (result && !result.startsWith('ERROR')) {
        log('PASS', `DNS resolves ${CUSTOM_DOMAIN} → ${result}`);
    } else {
        log('FAIL', `DNS resolution failed: ${result}`);
    }
}

function testHTTPS() {
    console.log('\n--- HTTPS Connectivity ---');
    const result = curl(`-o /dev/null -w "status:%{http_code}|size:%{size_download}|time:%{time_total}|type:%{content_type}" "${TEST_URL}"`);
    const parts = {};
    result.split('|').forEach(p => {
        const [k, v] = p.split(':');
        parts[k] = v;
    });

    const status = parseInt(parts.status || '0');
    log(status === 200 ? 'PASS' : 'FAIL', `HTTP ${status} from ${CUSTOM_DOMAIN}`);

    const ct = parts.type || '';
    log(ct.includes('gltf') || ct.includes('octet') ? 'PASS' : 'FAIL', `Content-Type: ${ct}`);

    const sizeMB = parseInt(parts.size || '0') / 1024 / 1024;
    log(sizeMB > 1 ? 'PASS' : 'FAIL', `Downloaded: ${sizeMB.toFixed(1)} MB`);

    const time = parseFloat(parts.time || '0');
    log('INFO', `Time: ${time.toFixed(2)}s`);
}

function testCORS() {
    console.log('\n--- CORS Headers (GET with Origin) ---');
    for (const origin of ORIGINS) {
        const headers = curl(`-I -H "Origin: ${origin}" "${TEST_URL}" 2>&1`);
        const acao = (headers.match(/access-control-allow-origin:\s*(.+)/i) || [])[1]?.trim();
        log(acao === origin ? 'PASS' : 'FAIL',
            `Origin ${origin} → ACAO: ${acao || '(missing)'}`);
    }
}

function testPreflight() {
    console.log('\n--- CORS Preflight (OPTIONS) ---');
    for (const origin of ORIGINS) {
        const headers = curl(`-X OPTIONS -H "Origin: ${origin}" -H "Access-Control-Request-Method: GET" -D - -o /dev/null "${TEST_URL}" 2>&1`);
        const status = (headers.match(/HTTP\/\d\.?\d?\s+(\d+)/g) || []).pop();
        const statusCode = status ? parseInt(status.match(/(\d+)$/)[1]) : 0;
        const acao = (headers.match(/access-control-allow-origin:\s*(.+)/i) || [])[1]?.trim();
        const methods = (headers.match(/access-control-allow-methods:\s*(.+)/i) || [])[1]?.trim();
        log(statusCode >= 200 && statusCode < 300 ? 'PASS' : 'FAIL',
            `OPTIONS ${origin} → ${statusCode}, ACAO: ${acao || '(missing)'}, Methods: ${methods || '(missing)'}`);
    }
}

function testNoRedirects() {
    console.log('\n--- No Redirect Check ---');
    const result = curl(`-o /dev/null -w "%{num_redirects}|%{url_effective}" -L "${TEST_URL}"`);
    const [redirects, finalUrl] = result.split('|');
    log(redirects === '0' ? 'PASS' : 'FAIL',
        `Redirects: ${redirects} (final URL: ${finalUrl || TEST_URL})`);
}

function testDownload() {
    console.log('\n--- Partial Download (magic bytes) ---');
    try {
        const data = execSync(`curl -s --connect-timeout 10 -r 0-3 "${TEST_URL}"`, {
            encoding: 'buffer',
            timeout: 15000,
        });
        const magic = data.slice(0, 4).toString('ascii');
        log(magic === 'glTF' ? 'PASS' : 'FAIL',
            `Magic bytes: ${magic === 'glTF' ? 'glTF (valid VRM/GLB binary)' : `"${magic}" (expected "glTF")`}`);
    } catch (e) {
        log('FAIL', `Download test failed: ${e.message}`);
    }
}

// ─── Code Logic Tests ──────────────────────────────────────

function testProxyAllowlist() {
    console.log('\n--- Proxy Allowlist Check ---');
    const proxyPath = path.join(__dirname, '..', 'api', 'avatar-proxy.js');
    try {
        const code = fs.readFileSync(proxyPath, 'utf8');
        log(code.includes("'avatars.yourfriend.online'") ? 'PASS' : 'FAIL',
            'avatar-proxy.js ALLOWED_HOSTS includes avatars.yourfriend.online');
    } catch (e) {
        log('FAIL', `Could not read proxy file: ${e.message}`);
    }

    const nexusPath = path.join(__dirname, '..', 'nexus-proxy', 'server.js');
    try {
        const code = fs.readFileSync(nexusPath, 'utf8');
        log(code.includes("'avatars.yourfriend.online'") ? 'PASS' : 'FAIL',
            'nexus-proxy/server.js includes avatars.yourfriend.online');
    } catch (e) {
        log('FAIL', `Could not read nexus proxy: ${e.message}`);
    }
}

function testFetchModelUrl() {
    console.log('\n--- fetchModelUrl Logic Check ---');
    const vrmPath = path.join(__dirname, '..', 'vrm-manager.js');
    try {
        const code = fs.readFileSync(vrmPath, 'utf8');

        // Check custom domain detection
        log(code.includes("url.includes('avatars.yourfriend.online')") ? 'PASS' : 'FAIL',
            'fetchModelUrl detects avatars.yourfriend.online');

        // Check it tries direct CORS first for custom domain (faster, more reliable)
        const customStart = code.indexOf('if (isR2Custom)');
        const customEnd = code.indexOf('if (isR2Dev)');
        const customBlock = customStart > 0 && customEnd > customStart
            ? code.substring(customStart, customEnd) : '';
        log(customBlock.includes('proxy') && customBlock.includes('cors') ? 'PASS' : 'FAIL',
            'fetchModelUrl has both direct CORS and proxy paths for custom domain');

        // Check direct CORS comes before proxy for custom domain
        const corsIdx = customBlock.indexOf("fetch(url, { mode: 'cors' }");
        const proxyIdx = customBlock.indexOf("fetch(proxyUrl)");
        log(corsIdx > 0 && proxyIdx > 0 && corsIdx < proxyIdx ? 'PASS' : 'FAIL',
            'fetchModelUrl tries direct CORS before proxy for custom domain');

        // Check detailed logging
        log(code.includes('Custom domain detected') ? 'PASS' : 'FAIL',
            'fetchModelUrl has detailed logging for custom domain path');

        // Check proper error message
        log(code.includes('both direct CORS and proxy failed') ? 'PASS' : 'FAIL',
            'fetchModelUrl throws descriptive error when all paths fail');

        // Check catalog filter includes custom domain
        log(code.includes("!url.includes('avatars.yourfriend.online')") ? 'PASS' : 'FAIL',
            'fetchHomePilotCatalog filter recognizes custom domain URLs');
    } catch (e) {
        log('FAIL', `Could not read vrm-manager.js: ${e.message}`);
    }
}

function testInstallFromUrlStreaming() {
    console.log('\n--- installFromUrl Body Streaming ---');
    const vrmPath = path.join(__dirname, '..', 'vrm-manager.js');
    const code = fs.readFileSync(vrmPath, 'utf8');

    // Find the installFromUrl function (ends at the next method in the object)
    const fnStart = code.indexOf('async installFromUrl(');
    // The function ends before the RPM Creator section
    const fnEnd = code.indexOf('/* ── Ready Player Me iFrame Creator');
    const fnBlock = fnStart > 0 && fnEnd > fnStart ? code.substring(fnStart, fnEnd) : '';

    // Check it uses streaming getReader instead of res.blob()
    log(fnBlock.includes('res.body.getReader()') ? 'PASS' : 'FAIL',
        'installFromUrl uses streaming res.body.getReader() (not res.blob())');

    // Check it does NOT use await res.blob() which fails on large streamed responses
    log(!fnBlock.includes('await res.blob()') ? 'PASS' : 'FAIL',
        'installFromUrl does NOT use await res.blob() (fragile for proxied streams)');

    // Check it assembles chunks into a Blob
    log(fnBlock.includes('new Blob(chunks)') ? 'PASS' : 'FAIL',
        'installFromUrl assembles streamed chunks into Blob');
}

function testInstallFromUrlValidation() {
    console.log('\n--- installFromUrl URL Validation ---');
    const vrmPath = path.join(__dirname, '..', 'vrm-manager.js');
    const code = fs.readFileSync(vrmPath, 'utf8');

    // Test the URL regex pattern used in installFromUrl
    const regex = /^https?:\/\/.+\.(vrm|glb|gltf)(\?.*)?$/i;

    const validUrls = [
        'https://avatars.yourfriend.online/vroid_hub/ruby-the-demon-7966170650761748708.vrm',
        'https://pub-c8f0641365ad47e5b3e1c85c39874909.r2.dev/vroid_hub/model.vrm',
        'https://example.com/model.glb',
        'https://example.com/model.gltf?v=2',
    ];

    const invalidUrls = [
        'https://hub.vroid.com/en/characters/123/models/456',
        'http://example.com/page.html',
        'not-a-url',
    ];

    for (const url of validUrls) {
        log(regex.test(url) ? 'PASS' : 'FAIL', `Valid URL accepted: ${url.slice(0, 70)}...`);
    }

    for (const url of invalidUrls) {
        log(!regex.test(url) ? 'PASS' : 'FAIL', `Invalid URL rejected: ${url.slice(0, 70)}`);
    }
}

function testCatalogIntegration() {
    console.log('\n--- Catalog Integration (vrm-avatar-catalog) ---');

    const catalogAppPath = path.join(__dirname, '..', '..', 'vrm-avatar-catalog', 'docs', 'app.js');
    try {
        const code = fs.readFileSync(catalogAppPath, 'utf8');

        // Check isDirectModelUrl recognizes custom domain
        log(code.includes("avatars.yourfriend.online") ? 'PASS' : 'FAIL',
            'Catalog isDirectModelUrl recognizes custom domain');

        // Check "Use in App" URL format
        log(code.includes('vrm-manager.html?install=') ? 'PASS' : 'FAIL',
            'Catalog "Use in App" uses correct URL format (?install=)');

        // Check it targets the right host
        log(code.includes('www.yourfriend.online/vrm-manager.html') ? 'PASS' : 'FAIL',
            'Catalog redirects to correct host (www.yourfriend.online)');
    } catch (e) {
        log('FAIL', `Could not read catalog app.js: ${e.message}`);
    }

    // Check catalog.json uses custom domain
    const catalogJsonPath = path.join(__dirname, '..', '..', 'vrm-avatar-catalog', 'docs', 'catalog.json');
    try {
        const catalog = fs.readFileSync(catalogJsonPath, 'utf8');
        log(!catalog.includes('pub-c8f0641365ad47e5b3e1c85c39874909.r2.dev') ? 'PASS' : 'FAIL',
            'catalog.json has no old r2.dev URLs');
        log(catalog.includes('avatars.yourfriend.online') ? 'PASS' : 'FAIL',
            'catalog.json uses custom domain URLs');
    } catch (e) {
        log('FAIL', `Could not read catalog.json: ${e.message}`);
    }
}

// ─── Main ──────────────────────────────────────────────────

function main() {
    console.log('==============================================');
    console.log(' VRM Avatar Install Flow Tests');
    console.log(` Target: ${TEST_URL}`);
    console.log('==============================================');

    // Network tests
    testDNS();
    testHTTPS();
    testCORS();
    testPreflight();
    testNoRedirects();
    testDownload();

    // Code logic tests
    testProxyAllowlist();
    testFetchModelUrl();
    testInstallFromUrlStreaming();
    testInstallFromUrlValidation();
    testCatalogIntegration();

    console.log('\n==============================================');
    console.log(` Results: \x1b[32m${passed} passed\x1b[0m, \x1b[${failed > 0 ? '31' : '32'}m${failed} failed\x1b[0m`);
    console.log('==============================================\n');

    process.exit(failed > 0 ? 1 : 0);
}

main();
