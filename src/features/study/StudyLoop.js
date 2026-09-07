/**
 * Running the session (batch S3).
 *
 * The three modules beside this one each hold one thing — the state, the prompt, the memory —
 * and this is the only place that knows the order they happen in. It is deliberately the
 * thinnest of the four: everything it does is call something else and put a sentence in the
 * chat.
 *
 * ## What it says, and what it leaves to her
 *
 * The app writes exactly three kinds of line: the opening question, the note about what was
 * read, and the closing summary. Everything between those is hers, because everything between
 * those is teaching and the app has no business scripting it.
 *
 * The three it does write are the three that must be true regardless of the model: what she
 * read (so a citation is the app's claim, not the model's), and what actually happened in the
 * session (so the summary is built from recorded verdicts rather than her recollection).
 *
 * Exposes: window.NEXUS_STUDY_LOOP
 */
(function (global) {
    'use strict';

    function pick(name) {
        return global && global[name] ? global[name] : null;
    }

    /** The app's own way of putting a line in the chat, whichever shape this page uses. */
    function say(text, who = 'bot') {
        const ask = pick('NEXUS_YT_ASK');
        if (!ask || typeof ask.say !== 'function') {
            return null;
        }
        try {
            return ask.say(text, who, global && global.document) || null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Open a session.
     *
     * The opening line uses what she remembers, if there is anything — that is the difference
     * between a study feature and a chat window, and it costs one lookup.
     */
    function open() {
        const session = pick('NEXUS_STUDY_SESSION');
        const memory = pick('NEXUS_STUDY_MEMORY');
        if (!session || typeof session.begin !== 'function') {
            return null;
        }
        session.begin();
        const prior = memory && typeof memory.opener === 'function' ? memory.opener() : null;
        if (prior && prior.revisit) {
            say(
                `What shall we understand today? Last time it was ${prior.topic}, and ${prior.revisit} was the part that stayed shaky — we could pick that up, or start something new.`
            );
        } else if (prior) {
            say(`What shall we understand today? Last time it was ${prior.topic}.`);
        } else {
            say('What shall we understand today? Name a topic and I will read up on it first.');
        }
        return session.get();
    }

    /**
     * They named a topic. Read up on it, then hand over to her.
     *
     * The line about what was read is written by the app rather than the model on purpose: a
     * citation is a claim about where the material came from, and the one component that
     * actually knows is the one that fetched it.
     */
    async function study(topic) {
        const session = pick('NEXUS_STUDY_SESSION');
        const research = pick('NEXUS_RESEARCH');
        if (!session || !research) {
            return { ok: false, why: 'not-loaded' };
        }
        session.setTopic(topic);
        const found = await research.read(session.get().topic);
        session.setSources(found);

        if (!found.ok || !found.sources.length) {
            say(explainMiss(found));
            return { ok: false, why: found.reason || 'nothing-found' };
        }

        const first = found.sources[0];
        const where =
            found.used === 'wikipedia' ? 'Wikipedia' : found.used === 'web' ? 'the web' : 'Wikipedia and the web';
        say(`I've read up on ${first.title || session.get().topic} — from ${where}. ${first.url || ''}`.trim());
        return { ok: true, sources: found.sources, used: found.used };
    }

    /**
     * The topic arrived from the Focus wizard rather than from the chat (batch S5).
     *
     * `open()` + the interceptor in `YouTubeAsk` is the typed route: she asks in the chat,
     * the next message is caught before the media parser sees it, and `study()` runs. That
     * route stays. This is the same three steps for a topic that was typed into the panel
     * instead, and the order of those steps is the whole point:
     *
     *   1. the topic goes into the transcript as the user's line, because it is one —
     *      typed by them, and the thing the next turn is an answer to. A model that cannot
     *      see it is being asked to teach a topic nobody mentioned;
     *   2. the reading happens, and the app says where the material came from;
     *   3. only then does she speak, and she speaks through the app's ordinary reply path,
     *      so the first thing said in a study session is spoken aloud, lipsynced, persisted
     *      and stripped of tags exactly like every other reply.
     *
     * Step 3 deliberately does not call `handleUserMessage`: that function's first act is to
     * record the user turn, and step 1 has already done it. `_handleNonStreamingResponse` is
     * the reply half on its own — the fallback path, so it works for every provider including
     * the ones that cannot stream.
     */
    async function startWithTopic(topic) {
        const session = pick('NEXUS_STUDY_SESSION');
        const clean = String(topic || '').trim();
        if (!clean) {
            return { ok: false, why: 'no-topic' };
        }
        if (!session || typeof session.begin !== 'function') {
            return { ok: false, why: 'not-loaded' };
        }
        session.begin();
        say(clean, 'user');
        const found = await study(clean);
        if (!found || !found.ok) {
            // The sentence saying why is already on screen. Handing a failed lookup to her
            // would get an answer invented from nothing, which is the one thing a study
            // session must not do.
            return found || { ok: false, why: 'not-loaded' };
        }
        await handOver(clean);
        return found;
    }

    /**
     * Ask her for the first turn, out loud.
     *
     * Never throws: a hand-off that fails leaves a session with a topic, sources and a
     * citation on screen, which the user can carry on with by typing. Losing the whole start
     * over a missing global would be worse.
     */
    async function handOver(text) {
        const reply = global && global._handleNonStreamingResponse;
        if (typeof reply !== 'function') {
            return false;
        }
        try {
            await reply(text);
            return true;
        } catch (_) {
            return false;
        }
    }

    /** Why nothing came back, in a sentence that says what to do about it. */
    function explainMiss(found) {
        const reason = (found && found.reason) || 'nothing-found';
        if (reason === 'rate-limited') {
            return "Wikipedia asked me to slow down for a moment. Try that again shortly — or if this deployment has a web search key, I'll use that instead.";
        }
        if (reason === 'unreachable') {
            return "I couldn't reach Wikipedia just now, so I've nothing to teach from. Worth trying again in a moment.";
        }
        if (reason === 'web-unavailable') {
            return "I could only find a stub on that, and there's no web search configured here to fill it out. Try a broader topic, or a related one.";
        }
        return "I couldn't find anything solid on that. Try naming it a different way, or something a little broader — I'd rather say so than make it up.";
    }

    /**
     * Finish, and say what actually happened.
     *
     * Built from the recorded verdicts, not from asking her to recall the session — she has
     * every incentive to remember it as having gone well, and the app has the facts.
     */
    function finish() {
        const session = pick('NEXUS_STUDY_SESSION');
        const memory = pick('NEXUS_STUDY_MEMORY');
        if (!session || typeof session.outcome !== 'function') {
            return null;
        }
        session.finish();
        const out = session.outcome();
        if (memory && typeof memory.record === 'function') {
            try {
                memory.record(out);
            } catch (_) {
                // A session that cannot be remembered still happened.
            }
        }
        say(summarise(out));
        session.end();
        return out;
    }

    /** The closing line. Facts first, one thing to return to, no score. */
    function summarise(out) {
        if (!out || !out.topic) {
            return 'We can pick this up whenever you like.';
        }
        const parts = [`That's ${out.minutes || 0} minute${out.minutes === 1 ? '' : 's'} on ${out.topic}.`];
        if (out.solid.length) {
            parts.push(`Solid: ${out.solid.join(', ')}.`);
        }
        if (out.shaky.length) {
            parts.push(`Still shaky: ${out.shaky.join(', ')}.`);
        }
        if (!out.solid.length && !out.shaky.length) {
            parts.push("We didn't get far enough for me to say what stuck — worth another go.");
        }
        if (out.revisit) {
            parts.push(`Next time I'd start with ${out.revisit}.`);
        }
        return parts.join(' ');
    }

    const api = { open, study, startWithTopic, handOver, finish, summarise, explainMiss };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.NEXUS_STUDY_LOOP = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
