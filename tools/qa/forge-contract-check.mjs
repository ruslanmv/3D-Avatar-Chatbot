#!/usr/bin/env node
/**
 * BI5. This app's own Forge clients against a running Forge: does the contract still hold?
 *
 *   node tools/qa/forge-contract-check.mjs --forge http://127.0.0.1:8093 \
 *        [--admin-password-file f --identity-secret-file f] [--slug avatar-sample-b] [--out dir]
 *
 * Forge gained account capabilities (AC1), durable withdrawal (WD1) and a new fitting pass for
 * bottoms under a kept top (KL3) on one branch. The Jest tests here stub Forge; this runs the
 * real `WardrobeClient` and `ForgeLibraryClient` modules (the same files the page loads, in
 * Node) against a Forge started from that branch, so a change on either side that breaks the
 * other shows up as a failed request rather than in production.
 *
 * Always (no credentials):
 *   1. `GET /v1/library`, `GET /v1/wardrobes/{slug}`: the shapes the registry reads.
 *   2. A clothed look made for her on the library route exactly as TryOnGenerator asks
 *      (`ensureFoundation`), polled to its end, its VRM downloaded: a GLB, the size Forge said.
 *      When she keeps a top, the fit report says which rules tucked the bottom under it.
 *   3. `GET /v1/access`: what the deployment says about capabilities; a made-up grant changes
 *      nothing a public caller sees.
 *
 * With an operator's password and the identity secret (a local Forge only; this script then
 * plays the operator and the site's server, which the page never does):
 *   4. An operator grant is accepted on the same requests.
 *   5. A capability: a tiny local endpoint stands in for the site's `forge.capabilityUrl`,
 *      signs who is "signed in" and exchanges it at Forge; `WardrobeClient.currentGrant()` asks
 *      it, sends the capability, and Forge reads it as that account's (checked by revoking the
 *      account and seeing Forge refuse to issue another).
 *
 * Prints one line per check and writes report.json; exit 1 on any failure.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
};
const FORGE = arg('--forge', 'http://127.0.0.1:8093').replace(/\/$/, '');
const SLUG = arg('--slug', 'avatar-sample-b');
const out = arg('--out', null);
const read = (flag) => (arg(flag, null) ? fs.readFileSync(arg(flag), 'utf8').trim() : null);
const PASSWORD = read('--admin-password-file');
const ID_SECRET = read('--identity-secret-file');

// The page's own files. Each is an IIFE that hangs its API on the global (and on
// `module.exports` under Jest); here they are read from the global, as the page reads them.
require(path.join(ROOT, 'src/wardrobe/WardrobeClient.js'));
require(path.join(ROOT, 'src/wardrobe/ForgeLibraryClient.js'));
const { WardrobeClient } = globalThis.NEXUS_WARDROBE_CLIENT;
const { ForgeLibraryClient } = globalThis.NEXUS_FORGE_LIBRARY_CLIENT;

const report = { forge: FORGE, slug: SLUG, checks: [], failures: [] };
const check = (name, ok, detail) => {
    report.checks.push({ name, ok: Boolean(ok), detail: detail || null });
    if (!ok) report.failures.push(`${name}: ${detail || 'failed'}`);
    console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

try {
    // ---- 1. The shapes the registry reads -----------------------------------------------------
    const client = new WardrobeClient({ baseUrl: FORGE, fetchImpl: fetch });
    const library = new ForgeLibraryClient({ client, pollIntervalMs: 1000, timeoutMs: 10 * 60 * 1000 });
    const listed = await library.library();
    const her = (Array.isArray(listed) ? listed : listed.avatars || []).find((a) => a.slug === SLUG);
    check(
        'library lists her with her pinned hash',
        her && /^[0-9a-f]{64}$/.test(her.sha256 || ''),
        her ? her.sha256.slice(0, 12) : 'not listed'
    );
    const wardrobe = await client.getWardrobe(SLUG);
    check('her wardrobe answers with looks[]', Array.isArray(wardrobe.looks), `${wardrobe.looks.length} looks`);
    check(
        'a public caller is shown no private look',
        wardrobe.looks.every((look) => !look.private)
    );

    // ---- 2. A clothed look, as TryOnGenerator asks for one ------------------------------------
    const started = await library.createJob(
        SLUG,
        { prompt: 'blue straight jeans', templateId: 'jeans-straight-v1', mode: 'template', color: 'blue' },
        { ensureFoundation: true, renderPreview: false }
    );
    const job = await library.wait(started.id || started.jobId);
    const look = job.look;
    check(
        'the job completed with a look',
        job.state === 'completed' && look && look.vrmUrl,
        look ? look.id : job.state
    );
    const fit = job.fitReport || job.fit_report || {};
    // The report's own verdicts: a valid VRM with her rig, weights and skeleton, and no clipping.
    const sound = ['vrmValid', 'humanoidValid', 'weightsValid', 'skeletonPreserved'].filter((key) => fit[key] !== true);
    check(
        'the fit report says a valid, unclipped look',
        sound.length === 0 && fit.clippingCheck !== 'failed',
        sound.length ? `not true: ${sound.join(', ')}` : `clipping ${fit.clippingCheck}`
    );
    if (fit.keptTopTuck) {
        const tuck = fit.keptTopTuck;
        check(
            'her kept top: the bottom was fitted under it by the current rules',
            tuck.version >= 3 && tuck.noRoom === 0,
            JSON.stringify(tuck)
        );
    }
    const url = client.resolveUrl(look.vrmUrl);
    const response = await fetch(url, { headers: client.downloadHeaders(url) });
    const bytes = Buffer.from(await response.arrayBuffer());
    check(
        'the look downloads as a GLB',
        response.ok && bytes.subarray(0, 4).toString('latin1') === 'glTF',
        `${bytes.length} bytes`
    );
    report.look = { id: look.id, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
    if (out) {
        fs.mkdirSync(out, { recursive: true });
        fs.writeFileSync(path.join(out, `${SLUG}-jeans.vrm`), bytes);
    }
    const after = await client.getWardrobe(SLUG);
    check(
        'her wardrobe now lists the look',
        after.looks.some((item) => item.id === look.id)
    );

    // ---- 3. Access, as a public caller sees it -------------------------------------------------
    const access = await client.request('/v1/access');
    check(
        'Forge says whether it issues capabilities',
        typeof access.capabilities === 'boolean',
        JSON.stringify(access)
    );
    const forged = new WardrobeClient({
        baseUrl: FORGE,
        fetchImpl: fetch,
        grant: `${b64({ slugs: [SLUG], iat: 1, exp: 9e9 })}.${b64('nobody')}`,
    });
    const asForged = await forged.getWardrobe(SLUG);
    check(
        'a made-up grant changes nothing',
        asForged.looks.length === after.looks.length && asForged.looks.every((l) => !l.private)
    );
    let refused = null;
    try {
        await client.request('/v1/access/capabilities', { method: 'POST', body: JSON.stringify({ avatars: [SLUG] }) });
    } catch (error) {
        refused = error.status;
    }
    check('no identity, no capability', refused === 401 || refused === 503, `HTTP ${refused}`);

    if (PASSWORD && ID_SECRET) {
        // ---- 4. The operator's grant (this script is the operator here) ------------------------
        const post = async (route, body, headers) =>
            fetch(FORGE + route, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(headers || {}) },
                body: JSON.stringify(body),
            });
        const session = await (await post('/v1/admin/session', { username: 'admin', password: PASSWORD })).json();
        const admin = { 'X-Wardrobe-Admin': session.token };
        const minted = await (await post('/v1/admin/grants', { slugs: [SLUG], ttlSeconds: 600 }, admin)).json();
        const granted = new WardrobeClient({ baseUrl: FORGE, fetchImpl: fetch, grant: minted.token });
        const asGranted = await granted.getWardrobe(SLUG);
        check(
            'an operator grant is accepted',
            Array.isArray(asGranted.looks) && asGranted.looks.some((l) => l.id === look.id)
        );
        check(
            'the grant goes to a download on that Forge and nowhere else',
            granted.downloadHeaders(url)['X-Wardrobe-Grant'] === minted.token &&
                !('X-Wardrobe-Grant' in granted.downloadHeaders('https://elsewhere.invalid/look.vrm'))
        );

        // ---- 5. A capability, through a stand-in for the site's own endpoint -------------------
        const sign = (claims) => {
            const head = b64({ alg: 'HS256', typ: 'JWT' });
            const body = b64(claims);
            const mac = crypto.createHmac('sha256', ID_SECRET).update(`${head}.${body}`).digest('base64url');
            return `${head}.${body}.${mac}`;
        };
        const account = `acct-contract-${Date.now().toString(36)}`;
        const asked = [];
        const site = http.createServer(async (req, res) => {
            let raw = '';
            for await (const chunk of req) raw += chunk;
            const wanted = JSON.parse(raw || '{}').avatars || [];
            asked.push(wanted);
            const now = Math.floor(Date.now() / 1000);
            // The site knows who is signed in (here: `account`) and which avatars they may see.
            const assertion = sign({
                iss: 'nexus-app',
                aud: 'wardrobe-forge',
                sub: account,
                iat: now,
                exp: now + 120,
                avatars: [SLUG],
                adult: true,
            });
            const issued = await post(
                '/v1/access/capabilities',
                { avatars: wanted },
                { 'X-Wardrobe-Identity': assertion }
            );
            res.writeHead(issued.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(await issued.text());
        });
        await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
        const capabilityUrl = `http://127.0.0.1:${site.address().port}/api/wardrobe/capability`;
        try {
            const signedIn = new WardrobeClient({
                baseUrl: FORGE,
                fetchImpl: fetch,
                capabilityUrl,
                capabilityFor: () => SLUG,
            });
            const token = await signedIn.currentGrant();
            const claims = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
            check(
                'the client was issued a capability for the avatar on stage',
                claims.sub === account && claims.slugs.join() === SLUG,
                `sub ${claims.sub}, ${claims.exp - claims.iat} s`
            );
            check('it is short-lived', claims.exp - claims.iat <= 900);
            const asAccount = await signedIn.getWardrobe(SLUG);
            check(
                'Forge accepts the capability on the wardrobe',
                asAccount.looks.some((l) => l.id === look.id)
            );
            check(
                'the site was asked once for two requests',
                (await signedIn.getWardrobe(SLUG)) && asked.length === 1,
                `${asked.length} asks`
            );
            // Revoke the account: Forge must refuse to issue it another.
            await post('/v1/admin/access/revocations', { subject: account, reason: 'contract check' }, admin);
            const again = new WardrobeClient({
                baseUrl: FORGE,
                fetchImpl: fetch,
                capabilityUrl,
                capabilityFor: () => SLUG,
            });
            const quiet = console.warn;
            console.warn = () => {};
            const none = await again.currentGrant();
            console.warn = quiet;
            check(
                'a revoked account is issued nothing, and the wardrobe still answers',
                none === '' && Array.isArray((await again.getWardrobe(SLUG)).looks)
            );
            await fetch(`${FORGE}/v1/admin/access/revocations/subjects/${account}`, {
                method: 'DELETE',
                headers: admin,
            });
        } finally {
            site.close();
        }
    } else {
        console.log('skip  operator grant and capability (no --admin-password-file / --identity-secret-file)');
    }
} catch (error) {
    check('driver', false, String(error && error.message));
}
report.passed = report.failures.length === 0;
if (out) {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(
    JSON.stringify({ passed: report.passed, checks: report.checks.length, failures: report.failures }, null, 2)
);
process.exit(report.passed ? 0 : 1);
