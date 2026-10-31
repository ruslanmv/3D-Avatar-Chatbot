/**
 * XREntryTrace — XL4. Every step of entering VR, written down, so a freeze says where it froze.
 *
 * The person entered VR from a PC over Quest Link and the headset stayed on the loading screen.
 * The console showed the session start, the warm-up finish (226 ms) and the controllers connect —
 * and then nothing until they gave up and the session ended. Nothing in that log could say whether
 * the headset ever asked the page for a frame, whether the loading card drew, whether her scene's
 * loop ever started, or whether it started and died on its first frame. Every one of those looks
 * the same from inside the headset: a picture that does not change.
 *
 * So entry is now a sequence of named steps (STEPS below), each recorded with its time, and the
 * two render loops count their frames: `card` while the HomePilot loading card is up, `scene` once
 * she is. Whatever a per-frame subsystem throws is caught by the loop (ViewerEngine.animate guards
 * each one — an exception escaping a WebXR frame callback stops three's XR loop for good, which
 * is exactly a frozen headset) and reported here once per subsystem, with its stack.
 *
 * The report prints when the session ends, however it ends — so the person who quits a frozen
 * session gets the answer in the console without doing anything — and on demand with
 * `NEXUS_XR_ENTRY.report()`. `diagnose()` turns the counters into one sentence: which step it is
 * waiting on and what that usually means. The step being waited on is also shown on the loading
 * card in the headset and on the desktop ENTER VR button.
 *
 * Pure (time and logging injected), IIFE with the dual export; tests/xr-entry-trace.test.js.
 */
(function (global) {
    'use strict';

    /**
     * The steps of an entry, in order, with what the person is shown while each is running: `label`
     * on the loading card in the headset, `short` on the desktop ENTER VR button (which must not
     * grow — it sits in a row of launch buttons).
     */
    const STEPS = [
        { id: 'request', label: 'Asking the headset…', short: 'Headset…' },
        { id: 'granted', label: 'Connecting to the headset…', short: 'Connecting…' },
        { id: 'gpu', label: 'Moving graphics to the headset…', short: 'GPU…' },
        { id: 'card', label: 'Getting ready…', short: 'Loading…' },
        { id: 'session', label: 'Starting the session…', short: 'Session…' },
        { id: 'warmup', label: 'Preparing graphics…', short: 'Shaders…' },
        { id: 'warmed', label: 'Almost ready…', short: 'Almost…' },
        { id: 'finished', label: 'Starting…', short: 'Starting…' },
        { id: 'scene', label: '', short: '' },
    ];
    const ORDER = STEPS.map((s) => s.id);

    function labelOf(id) {
        const s = STEPS.find((x) => x.id === id);
        return s ? s.label : '';
    }

    function shortOf(id) {
        const s = STEPS.find((x) => x.id === id);
        return s ? s.short : '';
    }

    /**
     * One sentence for where entry is, given a snapshot and the time now. `null` when nothing is
     * wrong yet. Thresholds are deliberately generous: a GPU move over Link takes ~1 s and a
     * first warm-up a few, and a false alarm in the console is worse than a late one.
     */
    function diagnose(snap, now) {
        if (!snap || !snap.started) return null;
        const at = (id) => (snap.steps[id] ? snap.steps[id].at : null);
        const since = (id) => (at(id) == null ? 0 : now - at(id));
        if (snap.failed) return `Entry failed at "${snap.failed.step}": ${snap.failed.message}`;
        if (snap.ended && !at('session'))
            return 'The session ended before it started drawing (refused or closed by the headset).';
        // XL6. A session that has ended is judged whole, not against "has it been 3 s yet": a Link
        // session that went hidden and ended 1.6 s in, having drawn nothing, was reported as
        // "no problem detected".
        if (snap.ended && snap.frames.card === 0 && snap.frames.scene === 0) {
            const lived = ((snap.ended.at - at('session')) / 1000).toFixed(1);
            const who = snap.endedBy
                ? `This page ended it (${snap.endedBy}).`
                : 'This page did not end it' +
                  (snap.wentHidden ? ', and it went hidden first' : '') +
                  ': it was closed from the headset (someone exiting) or by its XR runtime.';
            const waited = slowGrant(snap)
                ? ` The headset only started this session ${Math.round((at('granted') - at('request')) / 1000)} s ` +
                  'after ENTER VR — if it was exited because nothing seemed to happen, that wait is the problem.'
                : '';
            return (
                `The session ended ${lived} s after it started without the headset asking for a single frame ` +
                `(loading card 0, her scene 0). ${who}${waited}`
            );
        }
        if (at('request') != null && at('granted') == null && since('request') > 15000) {
            return 'Still waiting for the headset to grant the session — is Quest Link / Air Link active and the headset awake?';
        }
        if (at('gpu') != null && at('card') == null && since('gpu') > 10000) {
            return 'Stuck moving the 3D context to the headset’s GPU (makeXRCompatible). Restarting the browser usually clears this.';
        }
        if (at('session') != null && snap.frames.card === 0 && snap.frames.scene === 0 && since('session') > 3000) {
            return 'The headset is not asking this page for frames: the session started but no frame callback has run. The XR runtime is not delivering frames to the browser (Link app, focus, or the headset’s own menu in front).';
        }
        if (at('warmup') != null && at('warmed') == null && since('warmup') > 25000) {
            return 'The graphics warm-up has not finished — a shader or texture is not completing on this GPU.';
        }
        if (at('finished') != null && snap.entered && snap.frames.scene === 0 && since('finished') > 2000) {
            return snap.frames.card > 0
                ? 'Stuck on the loading card: entry finished but her scene loop has not drawn a frame.'
                : 'Entry finished but nothing has drawn a frame in the headset.';
        }
        const failing = Object.keys(snap.errors).filter((k) => snap.errors[k].count > 0);
        if (snap.frames.scene > 0 && failing.length) {
            const first = snap.errors[failing[0]];
            return `Her scene is running, but ${failing.join(', ')} threw during frames (first: ${first.message}).`;
        }
        return null;
    }

    /**
     * XL6. A grant that took this long is the browser and the XR runtime, not the page: nothing of
     * this app runs between requestSession() and its answer. A Chrome 157 / Windows / Quest Link
     * log showed 55 166 ms here, matching a report on Meta's tracker ("WebXR Immersive VR Session
     * Startup Delay on Meta Horizon Link 207"): Chrome's sandboxed XR service retries in ~11 s
     * cycles before the runtime creates the session. Said in the report so it is not chased in code.
     */
    const SLOW_GRANT_MS = 20000;
    function slowGrant(snap) {
        const req = snap && snap.steps.request;
        const got = snap && snap.steps.granted;
        if (!req || !got || got.at - req.at < SLOW_GRANT_MS) return null;
        const s = Math.round((got.at - req.at) / 1000);
        return (
            `the headset took ${s} s to grant the session. Nothing of this page runs in that time: it is ` +
            'the browser and the XR runtime (on Chrome + Meta Horizon Link, a known sandbox start-up delay).'
        );
    }

    function create(deps) {
        const d = deps || {};
        const now = typeof d.now === 'function' ? d.now : () => Date.now();
        const log = typeof d.log === 'function' ? d.log : () => {};
        const warn = typeof d.warn === 'function' ? d.warn : log;
        const onStep = typeof d.onStep === 'function' ? d.onStep : null;

        let snap = null;

        function fresh(info) {
            return {
                started: now(),
                info: info || {},
                steps: {},
                current: null,
                frames: { card: 0, scene: 0 },
                firstFrame: { card: null, scene: null },
                lastFrame: { card: null, scene: null },
                errors: {},
                events: [],
                entered: false,
                failed: null,
                ended: null,
                reported: false,
            };
        }

        function rel(t) {
            return snap ? Math.round(t - snap.started) : 0;
        }

        function step(id, detail) {
            if (!snap) return;
            const t = now();
            snap.steps[id] = { at: t, detail: detail === undefined ? null : detail };
            snap.current = id;
            const n = ORDER.indexOf(id);
            const tag = n >= 0 ? `${n + 1}/${ORDER.length}` : '·';
            log(`[VR entry] ${tag} ${id} +${rel(t)} ms${detail != null ? ' ' + JSON.stringify(detail) : ''}`);
            if (onStep) {
                try {
                    onStep(id, labelOf(id), shortOf(id), detail);
                } catch (_) {
                    /* a status line that fails to draw must not stop entry */
                }
            }
        }

        function frame(kind) {
            if (!snap || (kind !== 'card' && kind !== 'scene')) return;
            const t = now();
            snap.frames[kind] += 1;
            snap.lastFrame[kind] = t;
            if (snap.firstFrame[kind] == null) {
                snap.firstFrame[kind] = t;
                if (kind === 'scene') step('scene');
                else log(`[VR entry] first loading-card frame +${rel(t)} ms`);
            }
        }

        /** A per-frame subsystem threw. The first throw of each is printed with its stack. */
        function error(where, err) {
            const target = snap || (snap = fresh({ lateError: true }));
            const e = target.errors[where] || (target.errors[where] = { count: 0, message: '', stack: '' });
            e.count += 1;
            if (e.count === 1) {
                e.message = String((err && err.message) || err);
                e.stack = String((err && err.stack) || '');
                warn(`[VR frame] ${where} threw — the loop carries on without it this frame:`, err);
            }
        }

        function snapshot() {
            return snap;
        }

        function report() {
            if (!snap) return '[VR entry] no entry recorded in this page yet';
            const t = now();
            const lines = [`[VR entry] report — ${new Date(Date.now()).toISOString()}`];
            for (const id of ORDER) {
                const s = snap.steps[id];
                lines.push(
                    `  ${s ? '✔' : '·'} ${id.padEnd(9)} ${s ? '+' + rel(s.at) + ' ms' : '(not reached)'}` +
                        (s && s.detail != null ? ' ' + JSON.stringify(s.detail) : '')
                );
            }
            lines.push(
                `  frames: loading card ${snap.frames.card}, her scene ${snap.frames.scene}` +
                    (snap.lastFrame.scene ? ` (last ${Math.round(t - snap.lastFrame.scene)} ms ago)` : '')
            );
            for (const ev of snap.events) lines.push(`  event +${rel(ev.at)} ms: ${ev.what}`);
            for (const [where, e] of Object.entries(snap.errors)) {
                lines.push(`  ✖ ${where} threw ${e.count}× — ${e.message}`);
            }
            if (snap.failed) lines.push(`  ✖ failed at ${snap.failed.step}: ${snap.failed.message}`);
            if (snap.ended) lines.push(`  session ended +${rel(snap.ended.at)} ms`);
            const slow = slowGrant(snap);
            if (slow) lines.push(`  ⚠ ${slow}`);
            const why = diagnose(snap, t);
            lines.push(why ? `  → ${why}` : '  → no problem detected');
            return lines.join('\n');
        }

        return {
            STEPS,
            /** A new attempt: forget the last one. */
            begin(info) {
                snap = fresh(info);
                step('request', info || null);
            },
            step,
            frame,
            error,
            /** Something worth a line in the report (visibility changes, the context moving). */
            note(what) {
                if (snap) {
                    snap.events.push({ at: now(), what: String(what) });
                    if (/^session visibility → hidden/.test(String(what))) snap.wentHidden = true;
                }
                log(`[VR entry] ${what}`);
            },
            finished(entered) {
                if (!snap) return;
                snap.entered = !!entered;
                step('finished', { entered: !!entered });
            },
            /** XL6. This page is about to end the session itself — and why — so the report can tell. */
            pageEnding(reason) {
                if (!snap || snap.ended) return;
                snap.endedBy = String(reason || 'this page');
                snap.events.push({ at: now(), what: `this page ends the session: ${snap.endedBy}` });
            },
            fail(stepId, err) {
                if (!snap) return;
                snap.failed = { step: stepId || snap.current, message: String((err && err.message) || err) };
                warn(`[VR entry] failed at ${snap.failed.step}:`, err);
            },
            /** The session ended — print the report once, so a person who quit a frozen headset has it. */
            ended() {
                if (!snap || snap.ended) return;
                snap.ended = { at: now() };
                if (!snap.reported) {
                    snap.reported = true;
                    log(report());
                }
            },
            /**
             * XL5. One status line while the session runs — frames so far and the finding, if
             * any — so a log copied from inside a stuck session already says whether the headset
             * is drawing anything.
             */
            pulse() {
                if (!snap) return null;
                const t = now();
                const why = diagnose(snap, t);
                log(
                    `[VR entry] status +${rel(t)} ms: loading card ${snap.frames.card} frames, ` +
                        `her scene ${snap.frames.scene} frames, step ${snap.current || '—'}` +
                        (why ? ` — ${why}` : ' — ok')
                );
                if (why && why !== snap.lastWarned) {
                    snap.lastWarned = why;
                    warn(`[VR entry] ${why}`);
                }
                return why;
            },
            /** Check now; warn once per distinct finding. Returns the finding or null. */
            check() {
                if (!snap) return null;
                const why = diagnose(snap, now());
                if (why && why !== snap.lastWarned) {
                    snap.lastWarned = why;
                    warn(`[VR entry] ${why}`);
                }
                return why;
            },
            snapshot,
            report,
        };
    }

    const api = { STEPS, labelOf, shortOf, diagnose, slowGrant, SLOW_GRANT_MS, create };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_XR_ENTRY_TRACE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
