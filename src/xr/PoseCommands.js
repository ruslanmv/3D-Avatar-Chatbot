/**
 * NL1. What position, or which animation, did the person ask for? Answered from what this
 * build actually has, and "nothing here matches" is an answer too.
 *
 * The report that started this: "Please change your position to On all fours." The reply said
 * she was doing it; she stood still. Nothing downstream was broken. Private's parser matched a
 * position's words only at the very start of the message, so "change your position to …" in
 * front of them was not a request at all: no action was made, nothing told the model that
 * nothing had moved, and the model answered the way the sentence invited. The same was true of
 * every position, with every lead-in a person naturally uses.
 *
 * Two things come out of that, and this module is the first of them:
 *
 * 1. **One resolver, fed by the live catalogue.** Pose Studio's own list
 *    (`NEXUS_POSE_STUDIO_PANEL.catalogue()`: name, label, category, as filtered by what this
 *    session may show) is the vocabulary. A preset is reachable by its label, by its label with
 *    its category ("sitting crossed"), by its name in words, and by the everyday phrases in
 *    `LANG[..].phrases`, which are words for a preset and never a second definition of one: a
 *    phrase whose preset this build does not offer resolves to nothing. Lead-ins ("please",
 *    "can you", "change your position to") are taken off first and small typos are forgiven.
 *    English and Italian each have their own table and are never read with the other's (NL2).
 * 2. **A position that was asked for and cannot be found is `unknown-position`**, not silence,
 *    so the caller can say "I couldn't take that position" instead of leaving the model to
 *    invent one (the callers: `PrivateActionIntent` and `BodyPoseService`).
 *
 * What this deliberately does not do. Presets Pose Studio marks `adult` get no phrases here
 * and are not matched by label: they keep the triggers and the gate they already had
 * (`PrivateActionIntent`, `PrivateActionPolicy`). Bare "sit down" / "lie down" / "stand up"
 * are left to the motion fast path, which has always answered them with its own clips; this
 * answers "stand up" only while a held position is there to let go of.
 *
 * Animations work the same way: `resolveClip` matches a name against the clip loader's live
 * registry (`NEXUS_CLIP_LOADER.getAllAnimations()`), never a list kept here, and an animation
 * that is not installed is `unknown-clip`.
 *
 * Pure: reads its arguments, changes nothing.
 *
 * Exposes: window.NEXUS_POSE_COMMANDS
 */
(function (global) {
    'use strict';

    /** Lower case, punctuation out, accents kept (Italian needs them). */
    function clean(text) {
        return String(text == null ? '' : text)
            .toLowerCase()
            .replace(/[’`]/g, "'")
            .replace(/[.,!?;:…"()[\]{}]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * NL2. One table per language, never one mixed list. An English session is read with the
     * English table and an Italian session with the Italian one: a word that is a request in
     * one language can be small talk in the other ("come prima" / "come"), and a person who set
     * the app to a language is speaking it. `langOf` reads the app's language; a language with
     * no table here falls back to English, and says so by its key.
     *
     * Words only. Which presets exist, what they are called and whether this session may use
     * them is the catalogue's to say; a phrase whose preset this build does not offer resolves
     * to nothing. No preset marked `adult` has phrases here (see the header).
     */
    const LANG = {
        en: {
            leads: [
                'please',
                'pls',
                'hey',
                'ok',
                'okay',
                'now',
                'then',
                'and',
                'so',
                'can you',
                'could you',
                'would you',
                'will you',
                'i want you to',
                "i'd like you to",
                'i would like you to',
                'i need you to',
                'go ahead and',
                'just',
            ],
            trails: ['please', 'for me', 'now', 'right now', 'again', 'on the floor', 'on the bed', 'on the ground'],
            frames: [
                /^(?:change|switch|move|shift) (?:your |the )?(?:position|pose|posture)(?: (?:to|into))?(?: (?:a|an|the))?\b/,
                /^(?:change|switch) (?:to|into)(?: (?:a|an|the))?\b/,
                /^(?:get|go|move) (?:in|into)(?: (?:a|an|the))?(?= .+ (?:position|pose)$)/,
                /^(?:take|assume|do|strike|hold|try)(?: (?:a|an|the))?(?= .+ (?:position|pose)$)/,
            ],
            frameTail: / (?:position|pose|posture)$/,
            phrases: {
                standingBendForward: ['bend forward', 'bend over', 'lean forward'],
                standingBentBackward: ['bend backward', 'bend backwards', 'lean back', 'arch your back'],
                standingRelaxed: ['stand relaxed', 'relax your stance'],
                standingHandsClasped: ['clasp your hands', 'hands clasped'],
                sittingCrossed: [
                    'sit with your legs crossed',
                    'sit with legs crossed',
                    'sit cross legged',
                    'sit cross-legged',
                    'sit crossed legged',
                    'cross your legs',
                ],
                sittingDesk: ['sit at the desk', 'sit at your desk'],
                sittingLegsUp: [
                    'sit comfortably',
                    'get comfortable',
                    'make yourself comfortable',
                    'put your feet up',
                    'lounge',
                ],
                kneeling: [
                    'kneel down',
                    'kneel',
                    'get on your knees',
                    'get down on your knees',
                    'go on your knees',
                    'on your knees',
                ],
                kneelingUp: ['kneel up', 'kneel upright', 'kneel tall'],
                lyingBack: [
                    'lie on your back',
                    'lay on your back',
                    'lie down on your back',
                    'lay down on your back',
                    'on your back',
                ],
                lyingBackRelaxed: ['lie back and relax', 'lie down and relax'],
                lyingFront: [
                    'lie on your stomach',
                    'lie on your front',
                    'lie on your belly',
                    'lay on your stomach',
                    'on your stomach',
                ],
                lyingSide: ['lie on your side', 'lay on your side', 'lie down on your side', 'on your side'],
            },
            stand: ['stand up', 'stand back up', 'get up', 'stand', 'on your feet'],
            standExplicit: [
                'return to your normal standing position',
                'return to your standing position',
                'return to standing',
                'go back to standing',
                'go back to your normal standing position',
                'back to standing',
                'stand normally',
                'normal standing position',
                'standing position',
                'reset your pose',
                'reset the pose',
                'reset pose',
            ],
            previous: [
                'go back to the previous position',
                'go back to your previous position',
                'go back to the previous pose',
                'go back to the last position',
                'back to the previous position',
                'return to the previous position',
                'previous position',
                'previous pose',
                'the position you had before',
                'as you were',
                'as before',
                'like before',
            ],
            // A request for a posture nobody listed: a posture verb with where or how to take it.
            // "Lie to me" and "sit tight" are conversation, so the verb alone is not enough.
            posture:
                /^(?:lean (?:against|back against|on the|over the)|crouch(?: (?:down|on|by|behind))?$|crouch (?:down|on|by|behind) |squat(?: down)?$|squat (?:down )?on |bend (?:over|down|your) |kneel (?:on|by|beside|at|in front) |lie (?:on|down on|across|flat)|lay (?:on|down on|across|flat)|sit (?:on|at|in|against|by|with your) |curl up|stretch out|get (?:down )?on (?:your|all|the) |go (?:down )?on (?:your|all|the) )/,
            fastPathOwns: /^(?:sit(?: down)?|lie(?: down)?|lay(?: down)?)(?: (?:here|there))?$/,
            negated: /(?:^|\s)(?:don't|do not|dont|never|stop|not)(?:\s|$)/,
            clipFrames: [
                [
                    /^(?:play|start|show me|show|perform|run|put on)(?: (?:the|your|a|an|that))?\s+(.+?)\s+(?:animation|clip|dance|move|routine)$/,
                    true,
                ],
                [/^(?:dance|do)(?: (?:the|a|an))?\s+(.+)$/, false],
            ],
            clipArticle: /^(?:the|your|a|an)\s+/,
            clipRepeat: [
                'repeat that animation',
                'repeat that',
                'repeat the animation',
                'do that again',
                'play that again',
                'again',
            ],
            clipNext: ['play the next animation', 'next animation', 'play the next one', 'next one', 'next dance'],
            clipIdle: [
                'go back to idle',
                'back to idle',
                'return to idle',
                'stop the animation',
                'stop that animation',
            ],
            clipNoise: ['a', 'an', 'the', 'your', 'some', 'something', 'it', 'that', 'this'],
            // Words for a gesture the clip map offers under that name (`availableNames()`), for
            // the ones the fast path has no rule for. A name this build cannot perform is skipped.
            // The status line under the header. `{x}` is the position's or the animation's name.
            status: {
                changing: 'Changing pose…',
                'standing-up': 'Standing up…',
                applied: 'Pose applied.',
                stood: 'Standing.',
                failed: "I couldn't apply that pose.",
                unsupported: "I can't take that position.",
                ambiguous: 'Which one?',
                'clip-starting': 'Starting animation…',
                'clip-playing': 'Animation playing.',
                'clip-failed': "That animation didn't play.",
                'clip-unavailable': "That animation isn't available for this character.",
                'clip-disabled': 'That animation is switched off for this character.',
            },
            gestures: {
                clap: ['clap your hands', 'clap for me', 'clap', 'applaud', 'give me a round of applause'],
                shrug: ['shrug your shoulders', 'shrug'],
                sing: ['sing for me', 'sing a song', 'sing'],
                jumping_jacks: ['do jumping jacks', 'do some jumping jacks', 'jumping jacks'],
                // MO14. The fast path's model_pose words (IntentFastPath). "Pose" is also how a
                // position is framed ("the lecturer pose"), so without this "strike a pose" was read
                // as a position called "strike", found in no catalogue, and refused with "I can't
                // take that position" while the gesture it names was never tried.
                model_pose: ['strike a pose', 'pose for me', 'model pose', 'do a pose'],
            },
        },
        it: {
            leads: [
                'per favore',
                'per piacere',
                'dai',
                'ehi',
                'ok',
                'ora',
                'adesso',
                'poi',
                'e',
                'puoi',
                'potresti',
                'riesci a',
                'ti va di',
                'vorrei che tu',
                'voglio che tu',
                'voglio che',
            ],
            trails: [
                'per favore',
                'per piacere',
                'per me',
                'adesso',
                'ora',
                'subito',
                'di nuovo',
                'sul pavimento',
                'sul letto',
                'a terra',
                'per terra',
            ],
            frames: [
                /^(?:cambia|cambi|cambiamo) (?:la )?(?:posizione|posa)(?: (?:e|in|a))?\b/,
                /^mettiti in (?:posizione|posa)(?: (?:di|da|a))?\b/,
                /^(?:assumi|prendi|fai) la (?:posizione|posa)(?: (?:di|da|del|della))?\b/,
            ],
            frameTail: / (?:posizione|posa)$/,
            phrases: {
                standingBendForward: ['piegati in avanti', 'piegati', 'chinati in avanti', 'chinati'],
                standingBentBackward: ["piegati all'indietro", 'inarca la schiena'],
                standingRelaxed: ['stai rilassata', 'stai rilassato', 'mettiti rilassata in piedi'],
                standingHandsClasped: ['unisci le mani', 'mani giunte'],
                sittingCrossed: [
                    'siediti a gambe incrociate',
                    'siediti con le gambe incrociate',
                    'incrocia le gambe',
                    'accavalla le gambe',
                ],
                sittingDesk: ['siediti alla scrivania'],
                sittingLegsUp: ['siediti comoda', 'siediti comodo', 'mettiti comoda', 'mettiti comodo'],
                kneeling: ['inginocchiati', 'mettiti in ginocchio', 'in ginocchio'],
                kneelingUp: ['in ginocchio dritta', 'inginocchiati dritta'],
                lyingBack: [
                    'sdraiati sulla schiena',
                    'stenditi sulla schiena',
                    'mettiti sulla schiena',
                    'sulla schiena',
                    'a pancia in su',
                ],
                lyingBackRelaxed: ['sdraiati e rilassati', 'rilassati sdraiata'],
                lyingFront: ['sdraiati sulla pancia', 'sdraiati a pancia in giù', 'a pancia in giù'],
                lyingSide: ['sdraiati sul fianco', 'stenditi sul fianco', 'mettiti sul fianco', 'sul fianco'],
            },
            stand: ['alzati', 'rialzati', 'in piedi', 'tirati su'],
            standExplicit: [
                'torna in piedi',
                'rimettiti in piedi',
                'torna alla posizione normale',
                'torna alla posizione in piedi',
                'posizione normale',
                'posizione in piedi',
            ],
            previous: [
                'torna alla posizione precedente',
                'torna alla posizione di prima',
                'torna alla posa precedente',
                'posizione precedente',
                'torna come prima',
                'come prima',
                'come eri prima',
            ],
            posture:
                /^(?:appoggiati (?:al|alla|allo|contro) |accovacciati(?:\s|$)|accucciati(?:\s|$)|piegati (?:su|sul|sulla|verso) |(?:sdraiati|stenditi|siediti|inginocchiati) (?:su|sul|sulla|sullo|a|per|contro|davanti) |mettiti (?:a (?:terra|carponi|gattoni|pancia)|per terra|in (?:ginocchio|equilibrio)|su(?:l|lla|llo|i)? |contro ))/,
            fastPathOwns: /^(?:siediti|sdraiati|stenditi)(?: (?:qui|lì|là))?$/,
            negated: /(?:^|\s)(?:non|mai|smetti|niente|basta)(?:\s|$)/,
            clipFrames: [
                [
                    /^(?:fai partire|riproduci|avvia|mostrami|fammi vedere|esegui|fai)\s+(?:l'|la |il |lo |una |un )?(?:animazione|clip|ballo|danza|mossa)(?: (?:di|del|della))?\s+(.+)$/,
                    true,
                ],
                [/^balla(?: (?:la|il|lo|una|un))?\s+(.+)$/, false],
            ],
            clipArticle: /^(?:la|il|lo|una|un|l')\s*/,
            clipRepeat: ["ripeti l'animazione", 'ripeti', 'rifallo', 'ancora una volta', 'di nuovo'],
            clipNext: ['prossima animazione', 'la prossima animazione', 'la prossima', "un'altra animazione"],
            clipIdle: ['torna in idle', 'torna a riposo', "ferma l'animazione", "basta con l'animazione"],
            clipNoise: ['un', 'una', 'la', 'il', 'lo', 'qualcosa', 'questo', 'quello'],
            status: {
                changing: 'Cambio posizione…',
                'standing-up': 'Mi alzo…',
                applied: 'Posizione applicata.',
                stood: 'In piedi.',
                failed: 'Non sono riuscita ad applicare quella posizione.',
                unsupported: 'Non posso assumere quella posizione.',
                ambiguous: 'Quale?',
                'clip-starting': 'Avvio animazione…',
                'clip-playing': 'Animazione in corso.',
                'clip-failed': "L'animazione non è partita.",
                'clip-unavailable': "Quell'animazione non è disponibile per questo personaggio.",
                'clip-disabled': "Quell'animazione è disattivata per questo personaggio.",
            },
            gestures: {
                clap: ['batti le mani', 'applaudi', 'fai un applauso'],
                shrug: ['alza le spalle', 'fai spallucce'],
                sing: ['canta per me', 'canta una canzone', 'canta'],
                model_pose: ['fai una posa', 'posa da modella'],
            },
        },
    };

    /** `it-IT` → `it`; anything without a table → `en`. */
    function langKey(lang) {
        const key = String(lang || '')
            .toLowerCase()
            .split(/[-_]/)[0];
        return LANG[key] ? key : 'en';
    }

    /** The app's language, as the page stores it (`app_lang`), else the document's. */
    function langOf(win) {
        const w = win || global;
        try {
            const code = w && w.AppLanguage && w.AppLanguage.code;
            if (code) return langKey(code);
        } catch (_) {
            /* the stored language below still says */
        }
        try {
            const stored = w && w.localStorage && w.localStorage.getItem('app_lang');
            if (stored) return langKey(stored);
        } catch (_) {
            /* storage can be blocked; the document still says */
        }
        try {
            return langKey(w && w.document && w.document.documentElement && w.document.documentElement.lang);
        } catch (_) {
            return 'en';
        }
    }

    function stripLeads(body, L) {
        let out = body;
        for (let i = 0; i < 5; i += 1) {
            const lead = L.leads.find((l) => out === l || out.startsWith(l + ' '));
            if (!lead) break;
            out = out.slice(lead.length).trim();
        }
        return out;
    }

    function stripTrails(body, L) {
        let out = body;
        for (let i = 0; i < 4; i += 1) {
            const trail = L.trails.find((t) => out.endsWith(' ' + t));
            if (!trail) break;
            out = out.slice(0, -trail.length).trim();
        }
        return out;
    }

    /**
     * The words of a request with its lead-in and its "change your position to" frame taken
     * off: `{body, framed}`. `framed` says the person named a position or pose explicitly, so
     * finding nothing for `body` is a request that could not be met, not small talk.
     */
    function stripFrame(text, lang) {
        const L = LANG[langKey(lang)];
        let body = stripLeads(clean(text), L);
        let framed = false;
        for (let pass = 0; pass < 2; pass += 1) {
            const frame = L.frames.find((re) => re.test(body));
            if (!frame) break;
            framed = true;
            body = stripLeads(body.replace(frame, '').trim(), L);
        }
        if (L.frameTail.test(body)) {
            framed = true;
            body = body.replace(L.frameTail, '').trim();
        }
        return { body: stripTrails(body, L), framed };
    }

    /** Edit distance with adjacent swaps, capped: enough for a slipped or doubled key. */
    function distance(a, b, cap) {
        if (Math.abs(a.length - b.length) > cap) return cap + 1;
        const rows = a.length + 1;
        const cols = b.length + 1;
        const d = [];
        for (let i = 0; i < rows; i += 1) d.push([i]);
        for (let j = 1; j < cols; j += 1) d[0][j] = j;
        for (let i = 1; i < rows; i += 1) {
            let best = cap + 1;
            for (let j = 1; j < cols; j += 1) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
                if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
                    v = Math.min(v, d[i - 2][j - 2] + 1);
                d[i][j] = v;
                if (v < best) best = v;
            }
            if (best > cap) return cap + 1;
        }
        return d[rows - 1][cols - 1];
    }
    const tolerance = (phrase) => (phrase.length >= 12 ? 2 : phrase.length >= 5 ? 1 : 0);
    const near = (said, phrase) => {
        const cap = tolerance(phrase);
        return cap > 0 && distance(said, phrase, cap) <= cap;
    };
    const starts = (said, phrase) => said === phrase || said.startsWith(phrase + ' ');
    const count = (words) => (words ? words.split(' ').length : 0);
    /**
     * A phrase at the start of a short request. "Kneel down in front of me" is a request;
     * "Kneel before Zod is my favourite line in that film" starts with the same word and is
     * conversation: past a few words after the phrase it is left to the model.
     */
    const opens = (said, phrase) => starts(said, phrase) && count(said) <= count(phrase) + 4;
    /** The whole request, give or take a slipped key: never just its first words. */
    const among = (said, list) => list.some((p) => said === p) || list.some((p) => near(said, p));

    /** "sittingLegsUp" → "sitting legs up". */
    const spoken = (name) =>
        String(name || '')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .toLowerCase();

    const labelOf = (entry) => clean(String(entry.label || '').replace(/\(.*?\)/g, ' '));

    /**
     * What a preset is called when it is talked about. The navigator shows the category beside
     * a one-word label ("Lying" · "Back"); on its own "Back" names nothing, so the two are said
     * together: "Lying Back", "Sitting Crossed". A label that already says it stays as it is.
     */
    function shownName(entry) {
        const label = String((entry && (entry.label || entry.name)) || '');
        const category = String((entry && entry.category) || '');
        if (!category || label.includes(' ') || clean(label).indexOf(clean(category)) === 0) return label;
        return `${category} ${label}`;
    }

    /** The ways a catalogue entry can be named from its own fields. */
    function namesOf(entry) {
        const label = labelOf(entry);
        const category = clean(entry.category || '');
        const out = new Set([spoken(entry.name)]);
        if (label) {
            // A one-word label ("Back", "Relaxed", "Wide") names a pose only with its category.
            if (label.includes(' ') || !category) out.add(label);
            if (category) {
                out.add(`${category} ${label}`);
                out.add(`${label} ${category}`);
            } else out.add(label);
            if (label === category) out.add(label);
        }
        return [...out].filter(Boolean);
    }

    /**
     * The live catalogue: Pose Studio's list for this session, kept to what the pose system
     * can apply right now. Entries: `{name, label, category, adult}`.
     */
    function catalogueFrom(win) {
        const w = win || global;
        let listed = [];
        try {
            const panel = w && w.NEXUS_POSE_STUDIO_PANEL;
            if (panel && typeof panel.catalogue === 'function') listed = panel.catalogue() || [];
        } catch (_) {
            listed = [];
        }
        let runnable = null;
        try {
            const vps = w && w.vrPoseSystem;
            if (vps && typeof vps.getPresetList === 'function')
                runnable = new Set(vps.getPresetList().map((p) => p && p.name));
        } catch (_) {
            runnable = null;
        }
        return listed.filter((entry) => entry && entry.name && (!runnable || runnable.has(entry.name)));
    }

    /**
     * @param {string} text  what the person said
     * @param {object} [options]
     * @param {Array}  [options.catalogue]  `catalogueFrom(window)`
     * @param {boolean} [options.held]  a position is being held right now
     * @param {string} [options.lang]  `en` | `it` (default: English)
     * @returns {null | {kind:'pose', preset, label, category, via} | {kind:'stand', explicit}
     *          | {kind:'previous'} | {kind:'unknown-position', said}}
     */
    function resolve(text, options) {
        const o = options || {};
        const lang = langKey(o.lang);
        const L = LANG[lang];
        const said = clean(text);
        if (!said || said.length > 200 || L.negated.test(said)) return null;
        const { body, framed } = stripFrame(said, lang);
        // "Go back to the previous position" ends in the word a frame ends in: read it whole first.
        const whole = stripTrails(stripLeads(said, L), L);
        if (among(whole, L.previous) || among(body, L.previous)) return { kind: 'previous' };
        if (among(whole, L.standExplicit) || among(body, L.standExplicit)) return { kind: 'stand', explicit: true };
        // MO14. Exactly a gesture's words is a gesture request, not a position: the fast path's.
        if (Object.keys(L.gestures || {}).some((name) => L.gestures[name].includes(whole))) return null;
        if (!body) return framed ? { kind: 'unknown-position', said: '' } : null;
        if ((o.held || framed) && among(body, L.stand)) return { kind: 'stand', explicit: Boolean(framed) };

        const catalogue = (o.catalogue || []).filter((entry) => entry && entry.name && !entry.adult);
        const found = (entry, via) => ({
            kind: 'pose',
            preset: entry.name,
            label: shownName(entry),
            category: entry.category || '',
            via,
        });
        // 1. Everyday phrases in this language, longest first so "kneel up" is not "kneel".
        const phrased = [];
        for (const entry of catalogue)
            for (const phrase of L.phrases[entry.name] || []) phrased.push({ entry, phrase: clean(phrase) });
        phrased.sort((a, b) => b.phrase.length - a.phrase.length);
        const exact = phrased.find((p) => (framed ? starts(body, p.phrase) : opens(body, p.phrase)));
        if (exact) return found(exact.entry, 'phrase');
        // 2. The catalogue's own names (Pose Studio's labels are the product's, in either
        //    language): the whole request, or the start of it once framed.
        const named = [];
        for (const entry of catalogue) for (const name of namesOf(entry)) named.push({ entry, phrase: name });
        named.sort((a, b) => b.phrase.length - a.phrase.length);
        const byName = named.find((p) => body === p.phrase) || (framed && named.find((p) => starts(body, p.phrase)));
        if (byName) return found(byName.entry, 'label');
        // "the lecturer pose": a one-word label is a name once the person has said "pose". Several
        // presets share some of them ("Relaxed" is a standing pose and a lying one): then it is
        // a question back, never a guess.
        if (framed) {
            const same = catalogue.filter((entry) => labelOf(entry) === body);
            if (same.length === 1) return found(same[0], 'label');
            if (same.length > 1)
                return {
                    kind: 'ambiguous',
                    said: body,
                    options: same.map((entry) => ({
                        preset: entry.name,
                        label: `${entry.category || ''} ${entry.label || entry.name}`.trim(),
                    })),
                };
        }
        // 3. A slipped key, on a short request or an explicit one. Never over words that are
        //    exactly a gesture's: "clap your hands" is one letter from "clasp your hands" and
        //    is not a typo of it.
        const gesture = Object.keys(L.gestures || {}).some((name) => L.gestures[name].includes(body));
        if (!gesture && (framed || body.split(' ').length <= 6)) {
            const close = phrased.find((p) => near(body, p.phrase)) || named.find((p) => near(body, p.phrase));
            if (close) return found(close.entry, 'typo');
        }
        if (framed) return { kind: 'unknown-position', said: body };
        if (count(body) <= 8 && L.posture.test(body + ' ') && !L.fastPathOwns.test(body))
            return { kind: 'unknown-position', said: body, loose: true };
        return null;
    }

    // -------------------------------------------------------------------------------- animations
    /** A registry entry's spoken names: "dance_rumba" → "rumba", "dance rumba". */
    function clipNames(clip) {
        const stem = String(clip.name || clip.path || '')
            .split('/')
            .pop()
            .replace(/\.(bvh|vrma|fbx|glb)$/i, '');
        const full = clean(stem.replace(/[_-]+/g, ' '));
        const short = clean(
            stem.replace(/^(action|dance|exercise|emotion|sit|kneel|laying)_/i, '').replace(/[_-]+/g, ' ')
        );
        const label = clean(clip.label || '');
        // `also`: what else the registry says it answers to (the manifest's mood names).
        const also = (clip.also || []).map(clean);
        return [...new Set([short, full, label, ...also])].filter(Boolean);
    }

    /**
     * @param {string} text
     * @param {object} [options]
     * @param {Array} [options.registry]  `NEXUS_MOTION_CLIPS.registry()`: `{path, category, also, allowed, why}`
     * @param {Array} [options.gestures]  `NEXUS_MOTION_CLIPS.availableNames()`
     * @param {string} [options.lang]  `en` | `it`
     * @returns {null | {kind:'clip', path, name, category, allowed, why, explicit} | {kind:'gesture', name}
     *          | {kind:'clip-repeat'} | {kind:'clip-next'} | {kind:'idle'} | {kind:'unknown-clip', said}}
     */
    function resolveClip(text, options) {
        const o = options || {};
        const L = LANG[langKey(o.lang)];
        const said = clean(text);
        if (!said || said.length > 200) return null;
        const body = stripTrails(stripLeads(said, L), L);
        if (L.clipIdle.some((p) => starts(body, p))) return { kind: 'idle' };
        if (L.negated.test(body)) return null;
        if (L.clipRepeat.some((p) => body === p)) return { kind: 'clip-repeat' };
        if (L.clipNext.some((p) => body === p)) return { kind: 'clip-next' };
        // A gesture by its everyday words, when the clip map offers that gesture right now.
        const offered = o.gestures || [];
        const said2 = [];
        for (const name of Object.keys(L.gestures || {}))
            if (offered.includes(name)) for (const phrase of L.gestures[name]) said2.push({ name, phrase });
        said2.sort((a, b) => b.phrase.length - a.phrase.length);
        const gesture = said2.find((g) => body === g.phrase) || said2.find((g) => near(body, g.phrase));
        if (gesture) return { kind: 'gesture', name: gesture.name };
        let wanted = null;
        let explicit = false;
        for (const [frame, names] of L.clipFrames) {
            const hit = frame.exec(body);
            if (!hit) continue;
            wanted = clean(hit[1].replace(L.clipArticle, ''));
            // "do the …" / "balla la …" name a clip only if one answers to it.
            explicit = names;
            break;
        }
        if (!wanted || L.clipNoise.includes(wanted)) return null;
        const registry = (o.registry || []).filter((clip) => clip && clip.path);
        const named = [];
        for (const clip of registry) for (const name of clipNames(clip)) named.push({ clip, name });
        // One that may play before one that is switched off, when both answer to the name.
        const usable = (n) => (n.clip.allowed === false ? 0 : 1);
        named.sort((a, b) => usable(b) - usable(a) || b.name.length - a.name.length);
        // "the relaxing animation" is Relax.vrma: endings come off both sides before comparing.
        const stem = (word) => word.replace(/(?:ing|ed|es|s|ante|ato|ata)$/u, '');
        const hit =
            named.find((n) => n.name === wanted) ||
            named.find((n) => starts(n.name, wanted) || starts(wanted, n.name)) ||
            named.find((n) => !n.name.includes(' ') && stem(n.name).length >= 4 && stem(n.name) === stem(wanted)) ||
            named.find((n) => near(wanted, n.name));
        if (hit)
            return {
                kind: 'clip',
                path: hit.clip.path,
                name: hit.name,
                category: hit.clip.category || '',
                allowed: hit.clip.allowed !== false,
                why: hit.clip.why || null,
                explicit: Boolean(explicit),
            };
        return explicit ? { kind: 'unknown-clip', said: wanted } : null;
    }

    /** The status line for a step, in one language: "Changing pose…", "Pose applied.". */
    function say(lang, key) {
        const L = LANG[langKey(lang)];
        return (L.status && L.status[key]) || LANG.en.status[key] || '';
    }

    const api = { resolve, resolveClip, stripFrame, catalogueFrom, langOf, langKey, clean, say, shownName, LANG };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_POSE_COMMANDS = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
