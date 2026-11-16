#!/usr/bin/env node
/**
 * NL8. Positions and animations asked for in words, on the real page, judged by her body.
 *
 *   node tools/qa/natural-language-motion-acceptance.mjs [--only en,it,phone,vr] [--out dir]
 *                                                        [--url http://127.0.0.1:8080]
 *
 * Five runs, each a fresh page with the avatar the app loads itself:
 *   en     desktop 1440×900, English: every sentence typed into the real chat box and sent with
 *          the real Send button; two through the real microphone handler (a stand-in recognizer
 *          hands it a transcript: there is no audio in a headless browser).
 *   it     the same, Italian session, Italian sentences; one English sentence to show it is not
 *          read in an Italian session.
 *   phone  390×844, a shorter English run.
 *   vr     an emulated Meta Quest 3 (IWER, as tools/vr/xr-entry-scenarios.mjs): ENTER VR, then
 *          transcripts handed to the VR panel's own handler, the function the headset's
 *          recognizer calls. This is emulation. It says nothing about a real headset.
 *   switch another character picked while a position is still landing, then the same requests
 *          on the new one.
 *
 * What is measured after every sentence, from the page:
 *   - the request's lifecycle (`NEXUS_BODY_POSES.current()`): its id, the avatar it was made
 *     for, each state it went through;
 *   - her rendered skeleton (`NEXUS_BODY_POSES.measure()`: hips height, trunk tilt, from the
 *     bones the mesh is skinned to) and, for animations, how far her hands, head and hips moved
 *     in 600 ms;
 *   - the status lines shown under the header;
 *   - the system prompt the reply was asked for with. No language model is connected in this
 *     run: `_nexusLLM` is replaced by a recorder that returns a fixed line, so what is checked
 *     is what the model is *told* about her body at the moment it is asked, not what a model
 *     then writes.
 *
 * Only presets Pose Studio offers with Spicy mode off are asked for. Writes
 * audits/nl-motion/runs/<stamp>/{report.json, report.md, *.png}. Exit 1 on a failed check.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
};
const only = arg('--only', 'en,it,phone,vr,switch').split(',');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(arg('--out', path.join(ROOT, 'audits/nl-motion/runs', stamp)));
const IWER_CDN = 'https://cdn.jsdelivr.net/npm/iwer@2.7.0/build/iwer.min.js';

// Each step: [label, how, said, expectation, shoot?]. `how`: typed | mic | vr | rapid.
const pose = (preset) => ({ kind: 'pose', preset });
const STAND = { kind: 'stand' };
const clip = (re) => ({ kind: 'clip', re });
const fast = (label) => ({ kind: 'fast', label });
const refused = (status) => ({ kind: 'refused', status });

const EN = [
    ['kneel', 'typed', 'Kneel down.', pose('kneeling'), true],
    ['kneel-held-6s', 'wait', 6000, { kind: 'still', preset: 'kneeling' }],
    ['lie-on-back', 'typed', 'Lie on your back.', pose('lyingBack'), true],
    ['previous', 'typed', 'Go back to the previous position.', pose('kneeling')],
    ['stand-up', 'typed', 'Stand up.', STAND, true],
    ['previous-after-standing', 'typed', 'Go back to the previous position.', pose('kneeling')],
    ['sit-crossed', 'typed', 'Sit with your legs crossed.', pose('sittingCrossed'), true],
    ['lie-on-side', 'typed', 'Lie on your side.', pose('lyingSide'), true],
    ['bend-forward', 'typed', 'Bend forward.', pose('standingBendForward'), true],
    ['sit-comfortably', 'typed', 'Sit comfortably.', pose('sittingLegsUp')],
    ['normal-standing', 'typed', 'Return to your normal standing position.', STAND],
    ['mic-knees', 'mic', 'get on your knees', pose('kneeling'), true],
    ['handstand', 'typed', 'Please change your position to a handstand.', refused('unsupported')],
    ['wall', 'typed', 'Lean against the wall.', refused('unsupported')],
    ['relaxed-which', 'typed', 'Get into the relaxed pose.', refused('ambiguous')],
    ['dance', 'typed', 'Dance for me.', fast('dance'), true],
    ['stop-dancing', 'typed', 'Stop dancing.', fast('stop')],
    ['rumba', 'typed', 'Play the Rumba animation.', clip(/dance_rumba/), true],
    ['next', 'typed', 'Play the next animation.', clip(/dance/)],
    ['repeat', 'typed', 'Repeat that animation.', { kind: 'repeat' }],
    ['relaxing', 'typed', 'Start the relaxing animation.', clip(/Relax\.vrma/)],
    ['happy', 'typed', 'Show me your happy animation.', clip(/emotion\/(joy|amusement)/)],
    ['clap', 'typed', 'Clap your hands.', { kind: 'gesture', name: 'clap' }],
    ['unicorn', 'typed', 'Play the unicorn animation.', refused('clip-unavailable')],
    ['idle', 'typed', 'Go back to idle.', fast('stop')],
    ['wave', 'typed', 'Wave goodbye.', { kind: 'fast-any', labels: ['wave', 'goodbye'] }],
    // "Spin around" has been the fast path's turn (to show her back) since MO10; "do a spin" is the gesture.
    ['spin-around', 'typed', 'Spin around.', fast('turn_around')],
    ['spin', 'typed', 'Do a spin.', fast('spin')],
    ['outfit', 'typed', 'Show me your outfit.', fast('show_outfit')],
    ['peace', 'typed', 'Do the peace sign.', fast('peace_sign')],
    ['sit-down', 'typed', 'Sit down.', fast('sit')],
    ['stand-from-sit', 'typed', 'Stand up.', fast('stand')],
    ['turn', 'typed', 'Turn around.', fast('turn_around')],
    ['mic-lie', 'mic', 'lie on your back', pose('lyingBack')],
    ['rapid-a-b-a', 'rapid', ['Kneel down.', 'Lie on your back.', 'Kneel down.'], pose('kneeling'), true],
    ['dance-over-pose', 'typed', 'Dance for me.', fast('dance')],
    ['stop', 'typed', 'Stop.', fast('stop')],
];

// Its own page: a position asked for, and another character picked before it has landed.
const SWITCH = [
    ['kneel', 'typed', 'Kneel down.', pose('kneeling')],
    ['stand-up', 'typed', 'Stand up.', STAND],
    ['switch-avatar', 'switch', 'Kneel down.', { kind: 'switched' }, true],
    ['kneel-new-avatar', 'typed', 'Kneel down.', pose('kneeling'), true],
    ['stand-new-avatar', 'typed', 'Stand up.', STAND],
];

const IT = [
    ['inginocchiati', 'typed', 'Inginocchiati.', pose('kneeling'), true],
    ['sulla-schiena', 'typed', 'Sdraiati sulla schiena.', pose('lyingBack'), true],
    ['precedente', 'typed', 'Torna alla posizione precedente.', pose('kneeling')],
    ['alzati', 'typed', 'Alzati.', STAND, true],
    ['gambe-incrociate', 'typed', 'Siediti a gambe incrociate.', pose('sittingCrossed'), true],
    ['sul-fianco', 'typed', 'Sdraiati sul fianco.', pose('lyingSide')],
    ['piegati', 'typed', 'Piegati in avanti.', pose('standingBendForward')],
    ['english-in-italian', 'typed', 'Kneel down.', { kind: 'unchanged', preset: 'standingBendForward' }],
    ['in-piedi', 'typed', 'Torna in piedi.', STAND],
    ['siediti', 'typed', 'Siediti.', fast('sit')],
    ['alzati-da-seduta', 'typed', 'Alzati.', fast('stand')],
    ['girati', 'typed', 'Girati.', fast('turn_around')],
    ['mic-ginocchio', 'mic', 'mettiti in ginocchio', pose('kneeling')],
    ['verticale', 'typed', 'Cambia posizione, fai la verticale.', refused('unsupported')],
    ['balla', 'typed', 'Balla per me.', fast('dance')],
    ['fermati', 'typed', 'Fermati.', fast('stop')],
    ['batti-le-mani', 'typed', 'Batti le mani.', { kind: 'gesture', name: 'clap' }],
    ['unicorno', 'typed', "Fai partire l'animazione unicorno.", refused('clip-unavailable')],
];

const PHONE = [
    ['kneel', 'typed', 'Kneel down.', pose('kneeling'), true],
    ['lie-on-back', 'typed', 'Lie on your back.', pose('lyingBack'), true],
    ['stand-up', 'typed', 'Stand up.', STAND, true],
    ['rumba', 'typed', 'Play the Rumba animation.', clip(/dance_rumba/)],
    ['unicorn', 'typed', 'Play the unicorn animation.', refused('clip-unavailable')],
    ['idle', 'typed', 'Go back to idle.', fast('stop')],
];

const VR = [
    ['vr-kneel', 'vr', 'kneel down', pose('kneeling'), true],
    ['vr-lie', 'vr', 'lie on your back', pose('lyingBack')],
    ['vr-stand', 'vr', 'stand up', STAND, true],
    ['vr-handstand', 'vr', 'change your position to a handstand', refused('unsupported')],
    ['vr-dance', 'vr', 'dance for me', fast('dance')],
    ['vr-stop', 'vr', 'stop', fast('stop')],
    ['vr-unicorn', 'vr', 'play the unicorn animation', refused('clip-unavailable')],
];

const RUNS = {
    en: { lang: 'en-US', steps: EN, viewport: { width: 1440, height: 900 } },
    it: { lang: 'it-IT', steps: IT, viewport: { width: 1440, height: 900 }, autoSend: true },
    phone: { lang: 'en-US', steps: PHONE, viewport: { width: 390, height: 844 }, mobile: true },
    vr: { lang: 'en-US', steps: VR, viewport: { width: 1280, height: 900 }, vr: true },
    switch: { lang: 'en-US', steps: SWITCH, viewport: { width: 1440, height: 900 } },
};

/** Standing: hips back within 5 cm of where they were, trunk upright, nothing held. */
const standing = (m, ref) => m && ref && Math.abs(m.hipsY - ref.hipsY) <= 0.05 && m.trunkTiltDeg <= 15;
/** The rendered shape a category must show, against her own standing hips. */
const SHAPE = {
    Kneeling: (m, ref) => m.hipsY <= ref.hipsY * 0.75 && m.trunkTiltDeg <= 25,
    // Legs up ("Lounging") keeps her hips high and brings her feet up to them instead.
    Sitting: (m, ref) => m.hipsY <= ref.hipsY * 0.8 || m.hipsAboveFeet <= ref.hipsAboveFeet * 0.8,
    Lying: (m, ref) => m.hipsY <= ref.hipsY * 0.45 && m.trunkTiltDeg >= 55,
    Standing: (m, ref) => m.hipsY >= ref.hipsY * 0.75,
};
const BEND = (m) => m.trunkTiltDeg >= 35;

function judge(step, ref) {
    const fails = [];
    const { expect: e, after: a } = step;
    const no = (what) => fails.push(what);
    const cur = a.current;
    const told = a.told || '';
    const never = () => {
        if (/confirmed on screen/.test(told) && !/not confirmed/.test(told))
            no('the reply was told a position was confirmed');
    };
    if (e.kind === 'pose') {
        if (!cur || cur.state !== 'confirmed')
            no(`request ${cur ? cur.state + '/' + cur.why : 'missing'}, expected confirmed`);
        if (a.preset !== e.preset) no(`pose system shows ${a.preset}, expected ${e.preset}`);
        if (!a.holding) no('nothing holds her');
        const shape = e.preset === 'standingBendForward' ? BEND : SHAPE[a.category];
        if (shape && a.measure && !shape(a.measure, ref))
            no(`rendered skeleton does not show it: ${JSON.stringify(a.measure)}`);
        if (cur && cur.avatarId !== a.rootUuid) no('the request was made for another avatar');
        if (!a.statuses.includes('applied')) no(`status line never said applied: ${a.statuses.join(' > ')}`);
        if (a.asked && !/confirmed on screen/.test(told))
            no(`the reply was not told it is confirmed: "${told.slice(0, 120)}"`);
    } else if (e.kind === 'stand') {
        if (!cur || cur.state !== 'confirmed') no(`stand ${cur ? cur.state + '/' + cur.why : 'missing'}`);
        if (a.holding) no('still held');
        if (!standing(a.measure, ref)) no(`not standing: ${JSON.stringify(a.measure)} vs ${JSON.stringify(ref)}`);
        if (a.asked && !/standing again/.test(told))
            no(`the reply was not told she is standing: "${told.slice(0, 120)}"`);
    } else if (e.kind === 'still') {
        if (a.preset !== e.preset || !a.holding) no(`no longer held in ${e.preset}: ${a.preset}`);
        if (Math.abs(a.measure.hipsY - step.before.measure.hipsY) > 0.03)
            no(`hips moved ${step.before.measure.hipsY} → ${a.measure.hipsY}`);
    } else if (e.kind === 'unchanged') {
        if (a.preset !== e.preset || !a.holding) no(`she changed: ${a.preset}`);
        if (a.statuses.length) no(`a status line appeared: ${a.statuses.join(' > ')}`);
    } else if (e.kind === 'refused') {
        if (!a.statuses.includes(e.status)) no(`status ${a.statuses.join(' > ') || 'none'}, expected ${e.status}`);
        if (a.preset !== step.before.preset) no(`her position changed: ${step.before.preset} → ${a.preset}`);
        if (Math.abs(a.measure.hipsY - step.before.measure.hipsY) > 0.06 && e.status !== 'clip-unavailable')
            no(`hips moved ${step.before.measure.hipsY} → ${a.measure.hipsY}`);
        never();
        if (a.asked && e.status === 'unsupported' && !/cannot take here/.test(told))
            no(`reply not told she cannot: "${told.slice(0, 120)}"`);
        if (a.asked && e.status === 'ambiguous' && !/Ask which one/.test(told))
            no(`reply not told to ask which: "${told.slice(0, 120)}"`);
        if (a.asked && e.status === 'clip-unavailable' && /Ask which one|cannot take here/.test(told))
            no(`an earlier turn's outcome is still told: "${told.slice(0, 100)}"`);
        if (a.asked && e.status === 'clip-unavailable' && !/isn't available/.test(told))
            no(`reply not told it is unavailable: "${told.slice(0, 120)}"`);
    } else if (e.kind === 'clip' || e.kind === 'repeat') {
        // Judged on what was confirmed when it started (the player showing that file, and her
        // body moving): a one-shot clip has ended, or given way to her talking, by the time
        // the reply has come back.
        const re = e.kind === 'repeat' ? null : e.re;
        const c = a.clip || {};
        const was = (step.before.clip || {}).path;
        if (c.status !== 'confirmed') no(`animation ${c.status || 'missing'}/${c.reason || ''}, expected confirmed`);
        if (re && !re.test(c.path || '')) no(`played ${c.path}, expected ${re}`);
        if (e.kind === 'repeat' && c.path !== was) no(`played ${c.path}, expected ${was} again`);
        if (e.kind === 'clip' && a.label === 'next' && c.path === was) no('the next animation is the same clip');
        if (!a.statuses.includes('clip-playing')) no(`status line never said playing: ${a.statuses.join(' > ')}`);
        if (!(c.seen && c.seen.playing === true)) no('the player never showed that clip');
        if (!(c.seen && c.seen.moved_m > 0.004)) no(`her body did not move (${c.seen && c.seen.moved_m} m)`);
        if (a.asked && !/is playing on your body now/.test(told))
            no(`reply not told it is playing: "${told.slice(0, 120)}"`);
    } else if (e.kind === 'gesture') {
        if (!a.statuses.includes('clip-playing'))
            no(`status ${a.statuses.join(' > ') || 'none'}, expected clip-playing`);
    } else if (e.kind === 'fast' || e.kind === 'fast-any') {
        // Nothing about an earlier turn's request may be told under this one.
        if (/Ask which one|cannot take here|did not show on your body|isn't available/.test(told))
            no(`an earlier turn's outcome is still told: "${told.slice(0, 100)}"`);
        const labels = e.kind === 'fast' ? [e.label] : e.labels;
        if (!a.echoes.some((x) => labels.includes(x)))
            no(`fast path echoed ${a.echoes.join(',') || 'nothing'}, expected ${labels.join('/')}`);
        if (a.holding && e.label !== 'stand') no('a position is still held under the motion');
    } else if (e.kind === 'switched') {
        if (a.rootUuid === step.before.rootUuid) no('the avatar did not change');
        if (!a.owner) no('the pose system is not on the avatar being drawn');
        if (a.holding || a.held) no('the hold was carried to the new avatar');
        // The request was for the avatar that left: cancelled if she left first, or confirmed
        // while she was still the one on screen. Never anything about the new one.
        if (cur && cur.avatarId === a.rootUuid) no('the old request reports on the new avatar');
        if (cur && !['cancelled', 'confirmed'].includes(cur.state)) no(`old request ${cur.state}/${cur.why}`);
        if (a.measure && (a.measure.trunkTiltDeg > 15 || a.measure.hipsAboveFeet < 0.6))
            no(`the new avatar is not standing: ${JSON.stringify(a.measure)}`);
        if (/confirmed on screen|moving into it/.test(a.factNow || ''))
            no(`a position is still claimed: "${a.factNow.slice(0, 100)}"`);
    }
    return fails;
}

fs.mkdirSync(out, { recursive: true });
const D = await import(pathToFileURL(path.join(ROOT, 'tools/vr/page-driver.mjs')).href);
const { playwright, why } = D.loadPlaywright();
if (!playwright) {
    process.stderr.write(why + '\n');
    process.exit(2);
}
const server = await D.ensureServer(arg('--url', 'http://127.0.0.1:8080').replace(/\/$/, ''));
const report = { startedAt: new Date().toISOString(), runs: {}, failures: [] };

/** The microphone button's recognizer, replaced by one a test can speak through. */
const FAKE_STT = `
  window.__stt = [];
  class FakeRecognition {
    constructor() { window.__stt.push(this); }
    start() { this.listening = true; setTimeout(() => this.onstart && this.onstart({}), 0); }
    // Like the browser's: stopping a recognizer that is not listening ends nothing.
    stop() { if (!this.listening) return; this.listening = false; setTimeout(() => this.onend && this.onend({}), 0); }
    abort() { this.stop(); }
    addEventListener(type, fn) { this['on' + type] = fn; }
    removeEventListener() {}
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
`;

async function run(name, def) {
    const result = { lang: def.lang, viewport: def.viewport, steps: [], errors: [], notes: [] };
    report.runs[name] = result;
    const browser = await playwright.chromium.launch({
        args: def.vr
            ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
            : D.SWIFTSHADER,
    });
    try {
        const ctx = await browser.newContext(
            def.mobile ? { viewport: def.viewport, isMobile: true, hasTouch: true } : { viewport: def.viewport }
        );
        await ctx.addInitScript(
            ([lang, autoSend]) => {
                localStorage.setItem('app_lang', lang);
                localStorage.setItem('nexus_llm_settings', JSON.stringify({ provider: 'ollabridge' }));
                // The microphone's two modes: the transcript waits for Send (default), or is sent.
                if (autoSend) localStorage.setItem('stt_auto_send', 'true');
            },
            [def.lang, Boolean(def.autoSend)]
        );
        await ctx.addInitScript(FAKE_STT);
        if (def.vr) {
            let iwer;
            try {
                iwer = await (await fetch(IWER_CDN)).text();
            } catch (e) {
                result.notes.push('IWER could not be fetched: ' + String(e.message).slice(0, 120));
                result.skipped = true;
                return;
            }
            await ctx.addInitScript(
                `${iwer}\n;(() => { const d = new IWER.XRDevice(IWER.metaQuest3); d.installRuntime({ forceInstall: true }); window.__xr = d; })();`
            );
        }
        const page = await ctx.newPage();
        page.on('pageerror', (e) => {
            const fromEmulator = /onDeviceFrame|<anonymous>/.test(e.stack || '') && !/https?:\/\//.test(e.stack || '');
            if (!fromEmulator) result.errors.push(String(e.message).slice(0, 240));
        });
        await page.goto(server.base + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
            () =>
                window.NEXUS_VIEWER?.avatarManager?.currentRoot &&
                window.vrPoseSystem?.avatarRoot &&
                window.NEXUS_MOTION?.state?.booted &&
                window.NEXUS_BODY_POSES?.request &&
                window.NEXUS_POSE_COMMANDS,
            null,
            { timeout: 240000 }
        );
        await page.waitForTimeout(4000);

        // The recorder in place of a language model, and the listeners the checks read.
        result.setup = await page.evaluate(() => {
            if (!window._nexusLLM && typeof window.LLMManager === 'function')
                window._nexusLLM = new window.LLMManager();
            window.__asks = [];
            const LINE = '(stand-in reply: no language model is connected in this run)';
            const record = (shape) => async (text, system) => {
                window.__asks.push({ text, system: String(system || '') });
                return shape === 'structured'
                    ? { choices: [{ message: { content: LINE }, finish_reason: 'stop' }] }
                    : LINE;
            };
            if (window._nexusLLM) {
                window._nexusLLM.sendMessage = record('plain');
                window._nexusLLM.sendMessageStructured = record('structured');
                window._nexusLLM.sendMessageStream = null;
            }
            window.__status = [];
            window.__echo = [];
            window.addEventListener('nexus-motion:action', (e) => {
                const d = e.detail || {};
                if (d.source === 'body_status') window.__status.push(d.status);
                else if (d.source === 'fastpath') window.__echo.push(d.label);
            });
            // No voice in a headless run; the reply's words are not what is judged.
            try {
                window.speechSynthesis && window.speechSynthesis.cancel();
            } catch (_) {}
            return {
                recorder: Boolean(window._nexusLLM),
                lang: window.NEXUS_POSE_COMMANDS.langOf(window),
                catalogue: window.NEXUS_POSE_COMMANDS.catalogueFrom(window).map((p) => p.name),
                adultInCatalogue: window.NEXUS_POSE_COMMANDS.catalogueFrom(window).filter((p) => p.adult).length,
                clips: window.NEXUS_MOTION_CLIPS.registry().length,
                clipsOff: window.NEXUS_MOTION_CLIPS.registry().filter((c) => !c.allowed).length,
                avatar: (window.NEXUS_VIEWER.avatarManager.getCurrent() || {}).name || null,
            };
        });

        if (def.vr) {
            await page.locator('#vr-button').click();
            await page
                .waitForFunction(() => window.NEXUS_XR_ENTRY?.snapshot()?.steps?.scene, null, { timeout: 120000 })
                .catch(() => result.notes.push('the emulated session never reported its scene step'));
            await page.waitForTimeout(2500);
            result.vr = await page.evaluate(async () => {
                const v = window.NEXUS_VIEWER;
                const chat = v.vrChatIntegration;
                if (chat && !chat.isInitialized) {
                    try {
                        await chat.initialize('/vendor/avatars/avatars.json');
                    } catch (e) {
                        return { presenting: v.renderer.xr.isPresenting, initError: String(e.message).slice(0, 160) };
                    }
                }
                return {
                    presenting: v.renderer.xr.isPresenting,
                    chatReady: Boolean(chat && chat.isInitialized),
                    device: 'IWER metaQuest3 (emulated)',
                };
            });
        }

        const read = () =>
            page.evaluate(async () => {
                const svc = window.NEXUS_BODY_POSES;
                const vps = window.vrPoseSystem;
                const THREE = window.THREE;
                const sample = () =>
                    ['hips', 'head', 'leftHand', 'rightHand']
                        .map((b) => {
                            const n = vps.getVisualBone && vps.getVisualBone(b);
                            return n ? n.getWorldPosition(new THREE.Vector3()) : null;
                        })
                        .filter(Boolean);
                const a = sample();
                await new Promise((r) => setTimeout(r, 600));
                const b = sample();
                let moved = 0;
                for (let i = 0; i < Math.min(a.length, b.length); i++) moved = Math.max(moved, a[i].distanceTo(b[i]));
                const cur = svc.current();
                const preset = vps.getCurrentPreset ? vps.getCurrentPreset() : null;
                const listed = window.NEXUS_POSE_COMMANDS.catalogueFrom(window).find((p) => p.name === preset);
                const ask = window.__asks[window.__asks.length - 1] || null;
                return {
                    measure: svc.measure(),
                    moved: Math.round(moved * 1000) / 1000,
                    current: cur && {
                        id: cur.id,
                        state: cur.state,
                        why: cur.why,
                        label: cur.label,
                        avatarId: cur.avatarId,
                        history: cur.history.join(' > '),
                    },
                    held: svc.held(),
                    holding: Boolean(vps.isHoldingBones && vps.isHoldingBones()),
                    preset,
                    category: listed ? listed.category : null,
                    rootUuid: vps.avatarRoot ? vps.avatarRoot.uuid : null,
                    owner: vps.avatarRoot === window.NEXUS_VIEWER.avatarManager.currentRoot,
                    factNow: window.NEXUS_MOTION.bodyFact(),
                    playback: window.NEXUS_CLIP_LOADER.getCurrentPlaybackState(),
                    clip: window.NEXUS_MOTION.bodyStatus().clip,
                    motion: {
                        sitting: !!window.NEXUS_MOTION.state.sitting,
                        laying: !!window.NEXUS_MOTION.state.laying,
                    },
                    inVR: !!window.NEXUS_VIEWER.renderer.xr.isPresenting,
                    asks: window.__asks.length,
                    told: ask
                        ? (ask.system.split('YOUR BODY, RIGHT NOW (measured, not assumed): ')[1] || '').split('\n')[0]
                        : '',
                    toldFor: ask ? ask.text : null,
                };
            });
        const settle = async (asksBefore) => {
            // The reply is asked for only once her body has answered; then anything still moving.
            await page
                .waitForFunction((n) => window.__asks.length > n, asksBefore, { timeout: 12000, polling: 100 })
                .catch(() => {});
            await page
                .waitForFunction(
                    () => {
                        const c = window.NEXUS_BODY_POSES.current();
                        const v = window.vrPoseSystem;
                        const pending = c && ['requested', 'validated', 'started', 'applied'].includes(c.state);
                        return !pending && !(v.isSettling && v.isSettling()) && !window.NEXUS_MOTION.whenBodySettled(1);
                    },
                    null,
                    { timeout: 20000, polling: 150 }
                )
                .catch(() => {});
            await page.waitForTimeout(1500);
        };
        const send = async (how, said) => {
            if (how === 'typed') {
                await page.locator('#speech-text').fill(said);
                await page.locator('#speak-btn').click();
            } else if (how === 'mic') {
                // The real microphone button and its real result handler; the recognizer is the
                // stand-in above, and this is the transcript it "heard".
                // The page makes its recognizer once, at load; the button starts it listening.
                const hear = () =>
                    page.evaluate((text) => {
                        const r = window.__stt.filter((x) => x.listening).pop();
                        if (!r || typeof r.onresult !== 'function') return false;
                        const result = Object.assign([{ transcript: text, confidence: 0.94 }], { isFinal: true });
                        r.onresult({ results: [result], resultIndex: 0 });
                        return true;
                    }, said);
                let heard = false;
                for (let attempt = 0; attempt < 3 && !heard; attempt++) {
                    await page.locator('#listen-btn').click();
                    await page.waitForTimeout(600);
                    heard = await hear();
                }
                if (!heard) throw new Error('the microphone button never started the recognizer');
                await page.waitForTimeout(400);
                // With auto-send off (the default) the transcript waits in the box for Send.
                const waiting = await page.evaluate(() => document.getElementById('speech-text').value || '');
                if (waiting.trim()) await page.locator('#speak-btn').click();
            } else if (how === 'vr') {
                await page.evaluate((text) => window.NEXUS_VIEWER.vrChatIntegration.handleUserMessage(text), said);
            }
        };
        const shoot = async (label) => {
            const file = path.join(out, `${name}-${label}.png`);
            if (def.mobile || def.vr) await page.screenshot({ path: file });
            else await page.locator('#avatar-viewport canvas, canvas').first().screenshot({ path: file });
            return path.basename(file);
        };

        let ref = (await read()).measure;
        result.ref = ref;
        result.shots = { start: await shoot('00-start') };
        let n = 0;
        for (const [label, how, said, expect, wantShot] of def.steps) {
            n += 1;
            const id = `${String(n).padStart(2, '0')}-${label}`;
            const before = await read();
            await page.evaluate(() => {
                window.__status = [];
                window.__echo = [];
            });
            if (how === 'wait') await page.waitForTimeout(said);
            else if (how === 'rapid') {
                // Three sentences, none waited for: the last one must be the one she ends in.
                for (const line of said) {
                    await page.evaluate((t) => window.NEXUS_MOTION.onUserUtterance(t), line);
                    await page.waitForTimeout(120);
                }
                await settle(1e9).catch(() => {});
            } else if (how === 'switch') {
                // Asked for a position, and another character picked before it has landed. The
                // switch goes through the viewer's own load (what the avatar picker calls): it
                // rebinds the pose system and tells the motion stack. The file is fetched first,
                // so the new character can arrive while the position is still landing.
                await page.evaluate(async () => {
                    const now = String((window.NEXUS_VIEWER.avatarManager.getCurrent() || {}).url || '');
                    const other = /AvatarSample_B/.test(now) ? 'AvatarSample_A' : 'AvatarSample_B';
                    window.__other = [`/vendor/avatars/${other}.vrm`, other];
                    await fetch(window.__other[0]).then((r) => r.arrayBuffer());
                });
                await page.evaluate((t) => window.NEXUS_MOTION.onUserUtterance(t), said);
                await page.waitForTimeout(150);
                await page.evaluate(() => {
                    window.NEXUS_VIEWER.loadAvatar(window.__other[0], window.__other[1]);
                });
                await page
                    .waitForFunction(
                        (u) => window.vrPoseSystem.avatarRoot && window.vrPoseSystem.avatarRoot.uuid !== u,
                        before.rootUuid,
                        {
                            timeout: 120000,
                        }
                    )
                    .catch(() => {});
                await page.waitForTimeout(5000);
            } else {
                await send(how, said);
                await settle(before.asks);
            }
            const after = await read();
            after.statuses = await page.evaluate(() => window.__status.slice());
            after.echoes = await page.evaluate(() => window.__echo.slice());
            after.asked = after.asks > before.asks && after.toldFor != null;
            after.label = label;
            const step = {
                id,
                how,
                said,
                expect: expect.kind === 'clip' ? { kind: 'clip', re: String(expect.re) } : expect,
                before,
                after,
            };
            const fails = judge({ expect, before, after }, ref);
            // Another character stands at her own height: later steps are judged against it.
            if (how === 'switch' && after.measure) ref = after.measure;
            step.ok = fails.length === 0;
            step.fails = fails;
            if (wantShot || fails.length) step.shot = await shoot(id);
            result.steps.push(step);
            for (const f of fails) report.failures.push(`${name} ${id}: ${f}`);
            process.stderr.write(
                `${name} ${id} [${how}] ${JSON.stringify(said).slice(0, 60)} → ${step.ok ? 'ok' : 'FAIL ' + fails.join('; ')} | ${after.current ? after.current.state : '-'} preset=${after.preset} hips=${after.measure && after.measure.hipsY} tilt=${after.measure && after.measure.trunkTiltDeg} moved=${after.moved} status=${after.statuses.join('>')} echo=${after.echoes.join(',')}\n`
            );
        }
        // The session ends: nothing may stay held.
        await page.evaluate(() => window.NEXUS_BODY_POSES.release('session-ended'));
        await page.waitForTimeout(2500);
        const end = await read();
        result.end = end;
        if (end.holding || end.held) report.failures.push(`${name} end: still held after the session ended`);
        if (result.errors.length)
            report.failures.push(`${name}: page errors: ${result.errors.join(' | ').slice(0, 300)}`);
        await ctx.close();
    } catch (e) {
        result.crash = String(e && e.stack ? e.stack : e).slice(0, 1200);
        report.failures.push(`${name}: crashed: ${String(e.message).slice(0, 200)}`);
    } finally {
        await browser.close();
    }
}

function writeReport() {
    const lines = [
        '# Natural-language motion acceptance',
        '',
        `Started ${report.startedAt}. ${report.failures.length} failed checks.`,
        '',
    ];
    for (const [name, r] of Object.entries(report.runs)) {
        lines.push(`## ${name} (${r.lang}, ${r.viewport.width}×${r.viewport.height})`, '');
        if (r.skipped) {
            lines.push('Skipped: ' + r.notes.join(' '), '');
            continue;
        }
        if (r.vr) lines.push(`Emulated session: ${JSON.stringify(r.vr)}`, '');
        if (r.ref)
            lines.push(
                `Standing reference: hips ${r.ref.hipsY} m, trunk ${r.ref.trunkTiltDeg}°. Avatar: ${r.setup && r.setup.avatar}.`,
                ''
            );
        lines.push(
            '| step | via | said | result | lifecycle | preset | hips m | trunk ° | moved m | status line | told the reply |',
            '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
        );
        for (const s of r.steps) {
            const a = s.after;
            lines.push(
                `| ${s.id} | ${s.how} | ${Array.isArray(s.said) ? s.said.join(' / ') : s.said} | ${s.ok ? 'ok' : 'FAIL: ' + s.fails.join('; ')} | ${a.current ? a.current.history : ''} | ${a.preset || ''}${a.holding ? '' : ' (free)'} | ${a.measure ? a.measure.hipsY : ''} | ${a.measure ? a.measure.trunkTiltDeg : ''} | ${a.moved} | ${a.statuses.join(' > ')}${a.echoes.length ? ' [' + a.echoes.join(',') + ']' : ''} | ${a.asked ? (a.told || '(no body fact)').slice(0, 110) : '(no reply asked)'} |`
            );
        }
        lines.push('');
        if (r.errors.length) lines.push('Page errors: ' + r.errors.join(' | '), '');
    }
    if (report.failures.length) lines.push('## Failed checks', '', ...report.failures.map((f) => `- ${f}`), '');
    fs.writeFileSync(path.join(out, 'report.md'), lines.join('\n'));
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
}

try {
    for (const name of Object.keys(RUNS)) if (only.includes(name)) await run(name, RUNS[name]);
} finally {
    report.finishedAt = new Date().toISOString();
    writeReport();
    process.stdout.write(`${path.relative(ROOT, out)}: ${report.failures.length} failed checks\n`);
    for (const f of report.failures) process.stdout.write(`  ${f.slice(0, 260)}\n`);
    server.stop();
    process.exit(report.failures.length ? 1 : 0);
}
