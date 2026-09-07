/**
 * Finding out *where* a provider stops working (batch M11).
 *
 * What Test Connection used to say, at its most helpful:
 *
 *     ✅ Connected. Reply: [object Object]
 *
 * and at its least:
 *
 *     ❌ Sorry, I encountered an error.
 *
 * Neither is a diagnosis. The first is a success that cannot show what came back; the second
 * is every possible failure — offline, wrong URL, expired token, model not installed, model
 * loaded and silent — wearing the same sentence. A person reading either one has to guess,
 * and the guesses that look most obvious ("the key must be wrong") are usually not it.
 *
 * ## Stages, because a provider fails in stages
 *
 * A round trip to a model passes through several places it can stop, and each has a different
 * fix. So the check walks them in order and reports each one:
 *
 *   config      — is there a provider, a URL, a credential, a model?   (fix: fill it in)
 *   reach       — does the host answer at all?                          (fix: network, URL)
 *   auth        — does it accept the credential?                        (fix: pair again)
 *   model       — is the chosen model in the catalog it returned?       (fix: pick another)
 *   completion  — does a one-word prompt come back?                     (fix: model, quota)
 *   content     — was there anything *in* the answer?                   (fix: bigger budget)
 *
 * It stops at the first failure, because everything after it is unknowable rather than fine,
 * and reporting "auth ✗, model ✗, completion ✗" for one expired token invites three fixes for
 * one problem.
 *
 * `content` earns its place from a real session: a reasoning model spent its whole token
 * budget thinking and returned `content: null`, which the app reported as a successful call
 * and then rendered as nothing at all.
 *
 * ## No network in here
 *
 * `reach`, `auth`, `model` and `completion` are performed by functions the caller passes in.
 * That keeps this file testable without a server, and — more usefully — means the check runs
 * the *same* code paths the app uses rather than a parallel implementation that can quietly
 * drift into working when the app does not.
 *
 * ## Nothing secret is ever recorded
 *
 * The report is meant to be pasted into a bug thread. It records that a credential was
 * present and what kind, never its value, and every message from a provider is truncated.
 *
 * Exposes: window.NEXUS_CONNECTION_CHECK
 */
(function (global) {
    'use strict';

    /** How much of a provider's error text is worth showing. Enough to name the cause. */
    const DETAIL_MAX = 240;

    /** The stages, in the order they are attempted. */
    const STAGES = ['config', 'reach', 'auth', 'model', 'completion', 'content'];

    /**
     * Read the text out of whatever a provider handed back.
     *
     * This is the `[object Object]` fix. `callLLM` returns a string for some providers and a
     * structured object for others, and the old code interpolated it straight into a
     * sentence — so the one case that proved the connection worked was the one that could not
     * show what came back.
     */
    function textOf(reply) {
        if (reply === null || reply === undefined) {
            return '';
        }
        if (typeof reply === 'string') {
            return reply;
        }
        if (typeof reply !== 'object') {
            return String(reply);
        }
        const direct = reply.text || reply.content || reply.analysis_text || reply.message;
        if (typeof direct === 'string') {
            return direct;
        }
        if (direct && typeof direct === 'object' && typeof direct.content === 'string') {
            return direct.content;
        }
        const choice = Array.isArray(reply.choices) ? reply.choices[0] : null;
        const fromChoice = choice && choice.message && choice.message.content;
        return typeof fromChoice === 'string' ? fromChoice : '';
    }

    /** One line of provider text, trimmed and capped, safe to show and to paste. */
    function detail(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, DETAIL_MAX);
    }

    /** An error's most useful sentence, whatever shape it arrived in. */
    function reasonOf(error) {
        if (!error) {
            return 'unknown error';
        }
        if (typeof error === 'string') {
            return detail(error);
        }
        const status = error.status || error.statusCode;
        // `error.message || String(error)` turns `new Error('')` into the word "Error", which
        // is not a message — it is the class name. An empty message is no message.
        // `error.message || String(error)` turns `new Error('')` into the word "Error", which
        // is not a message — it is the class name. An empty message is no message.
        let raw = String(error);
        if (typeof error.message === 'string') {
            raw = error.message;
        } else if (error.error !== undefined && error.error !== null) {
            raw = error.error;
        }
        const message = detail(raw);
        if (!status) {
            return message || 'unknown error';
        }
        // Providers vary in whether the status is already in the sentence. Prefixing it
        // regardless produced "HTTP 401: HTTP 401", which reads like a bug in the diagnostic
        // rather than a diagnosis.
        if (!message) {
            return `HTTP ${status}`;
        }
        return new RegExp(`\\b${status}\\b`).test(message) ? message : `HTTP ${status}: ${message}`;
    }

    /**
     * Is this failure about the credential rather than the connection?
     *
     * Worth separating because the fixes have nothing in common: one is "pair again", the
     * other is "check the URL or your network".
     */
    function looksLikeAuth(error) {
        const status = error && (error.status || error.statusCode);
        if (status === 401 || status === 403) {
            return true;
        }
        return /\b(401|403|unauthorized|forbidden|invalid[- ]?(api[- ]?key|token)|not authenticated)\b/i.test(
            reasonOf(error)
        );
    }

    function step(name, ok, message, ms) {
        return { name, ok, message: detail(message), ms: Math.max(0, Math.round(ms || 0)) };
    }

    /**
     * Run the check.
     *
     * Every network operation is injected:
     *   `listModels()` → array of ids, or throws
     *   `complete(prompt)` → the provider's reply, or throws
     *
     * Returns `{ ok, failedAt, summary, steps, report }`. `report` is the paste-ready text.
     */
    async function run(options = {}) {
        const {
            provider = '',
            baseUrl = '',
            model = '',
            credential = null,
            listModels = null,
            complete = null,
            prompt = 'Respond with the single word: OK',
            now = () => (global && global.Date ? global.Date.now() : 0),
        } = options;

        const steps = [];
        const started = now();
        const finish = (failedAt) => {
            const ok = !failedAt;
            const summary = ok
                ? `Connected — ${detail(steps[steps.length - 1].message)}`
                : `Failed at ${failedAt}: ${detail(steps[steps.length - 1].message)}`;
            return {
                ok,
                failedAt: failedAt || null,
                summary,
                steps,
                report: format({ provider, baseUrl, model, credential, steps, ms: now() - started }),
            };
        };

        // ── config ──────────────────────────────────────────────────────────
        const missing = [];
        if (!provider || provider === 'none') {
            missing.push('provider');
        }
        if (!model) {
            missing.push('model');
        }
        if (credential && credential.required && !credential.present) {
            missing.push(credential.kind || 'credential');
        }
        if (missing.length) {
            steps.push(step('config', false, `nothing selected for: ${missing.join(', ')}`, 0));
            return finish('config');
        }
        steps.push(
            step(
                'config',
                true,
                `${provider}${baseUrl ? ` at ${baseUrl}` : ''}, model ${model}${
                    credential && credential.present ? `, ${credential.kind || 'credential'} present` : ''
                }`,
                0
            )
        );

        // ── reach + auth + model ────────────────────────────────────────────
        // One request answers three questions, so it is made once and read three ways. Asking
        // three times would be slower and could disagree with itself between calls.
        if (typeof listModels === 'function') {
            const t = now();
            let ids = null;
            try {
                ids = await listModels();
            } catch (error) {
                const ms = now() - t;
                if (looksLikeAuth(error)) {
                    steps.push(step('reach', true, 'host answered', ms));
                    steps.push(step('auth', false, `credential rejected — ${reasonOf(error)}`, 0));
                    return finish('auth');
                }
                steps.push(step('reach', false, `no answer from the host — ${reasonOf(error)}`, ms));
                return finish('reach');
            }
            const ms = now() - t;
            const list = Array.isArray(ids) ? ids.map((m) => String((m && m.id) || m)) : [];
            steps.push(
                step('reach', true, `host answered with ${list.length} model${list.length === 1 ? '' : 's'}`, ms)
            );
            steps.push(step('auth', true, 'credential accepted', 0));
            if (list.length && !list.includes(model)) {
                steps.push(step('model', false, `“${model}” is not in the catalog this account can see`, 0));
                return finish('model');
            }
            steps.push(
                step('model', true, list.length ? `“${model}” is available` : 'catalog empty, trying anyway', 0)
            );
        }

        // ── completion ──────────────────────────────────────────────────────
        if (typeof complete !== 'function') {
            steps.push(step('completion', false, 'no way to send a prompt from here', 0));
            return finish('completion');
        }
        const t = now();
        let reply;
        try {
            reply = await complete(prompt);
        } catch (error) {
            const ms = now() - t;
            if (looksLikeAuth(error)) {
                steps.push(step('completion', false, `credential rejected — ${reasonOf(error)}`, ms));
                return finish('auth');
            }
            steps.push(step('completion', false, reasonOf(error), ms));
            return finish('completion');
        }
        const ms = now() - t;
        steps.push(step('completion', true, `answered in ${(ms / 1000).toFixed(1)}s`, ms));

        // ── content ─────────────────────────────────────────────────────────
        const text = textOf(reply).trim();
        if (!text) {
            // Seen for real: a reasoning model spent its whole budget thinking and returned
            // empty content. The call succeeded and the answer was nothing, and calling that
            // "connected" is how somebody spends an afternoon on the wrong problem.
            steps.push(step('content', false, 'the model answered with nothing at all', 0));
            return finish('content');
        }
        steps.push(step('content', true, `“${detail(text).slice(0, 80)}”`, 0));
        return finish(null);
    }

    /**
     * The paste-ready report.
     *
     * Written for a bug thread: what was configured, what each stage did, how long it took.
     * No credential value ever appears, only whether one was present and of what kind.
     */
    function format({ provider, baseUrl, model, credential, steps, ms }) {
        const lines = ['NEXUS connection check'];
        lines.push(`  provider   ${provider || '(none)'}`);
        lines.push(`  base url   ${baseUrl || '(default)'}`);
        lines.push(`  model      ${model || '(none)'}`);
        lines.push(
            `  credential ${credential ? `${credential.kind || 'credential'}: ${credential.present ? 'present' : 'missing'}` : '(not required)'}`
        );
        lines.push('');
        for (const s of steps) {
            const mark = s.ok ? 'ok  ' : 'FAIL';
            const timing = s.ms ? ` (${s.ms}ms)` : '';
            lines.push(`  ${mark} ${s.name.padEnd(11)}${s.message}${timing}`);
        }
        lines.push('');
        lines.push(`  total ${Math.max(0, Math.round(ms || 0))}ms`);
        return lines.join('\n');
    }

    const api = { STAGES, DETAIL_MAX, run, format, textOf, detail, reasonOf, looksLikeAuth };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_CONNECTION_CHECK = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
