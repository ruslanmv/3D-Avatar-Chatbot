/**
 * W16. Her wardrobe, as a tool she can use in conversation.
 *
 * The transcript this exists to change:
 *
 *     YOU    can you put on something elegant?
 *     NEXUS  I'd love to! Imagine me in a flowing black gown…
 *
 * She was right to answer that way: nothing in her prompt said this app can dress her, so
 * describing a dress was all she could do. Try-On can make and wear looks; this file lets
 * her reach it from the chat — and tells her what exists, so "what can you wear?" is
 * answered from the outfit dictionary (W15) rather than from imagination.
 *
 * ## One tool, two transports
 *
 * `TOOLS` is the tool described the way an MCP server describes one — `name`,
 * `description`, `inputSchema` — and `call(name, args)` is the only thing that executes it.
 * The chat reaches `call` through a tag, because that is this app's rule for model-driven
 * actions (CLAUDE.md, "LLM capability pattern"): only some of the five providers expose
 * tool calling through this client, so a tag is the one transport every provider has. A
 * future MCP endpoint would publish `TOOLS` and route to the same `call`; nothing about
 * what the tool does, or what it refuses, would change.
 *
 *     <wardrobe action="wear" outfit="little-black-dress"/>   → call('wardrobe_wear', {outfit})
 *
 * ## The rules every capability here keeps
 *
 * - **Empty unless it can run.** `systemPromptSuffix()` is `''` when the switch is off,
 *   when the wardrobe is not loaded, or when Try-On cannot open — so a profile without the
 *   feature sends exactly the prompt it always did.
 * - **It advertises what exists.** The list in the prompt is the dictionary's, filtered by
 *   who may see what: private sets and tattoos appear only while TryOnPrivate is `open` for
 *   her (private mode on, and her avatar declared adult by Forge's operator). Closed, the
 *   prompt does not mention them at all — not even to say they are unavailable.
 * - **Strip once, at `displayText`.** `consume` runs where every other directive does in
 *   `main.js`, so the bubble, the transcript, the VR forward and the voice never see markup.
 * - **At most one per reply**, enforced here and not only asked for.
 * - **Assistant replies only.** A person who types the tag gets text.
 * - **Re-checked at execution.** The switch, Try-On's availability and — for anything
 *   private — the private gate are read when the tag runs, not when the prompt was built.
 *   Forge then checks the adult declaration again on its side, whatever arrives.
 *
 * Exposes: window.NEXUS_WARDROBE_TOOL
 */
(function (global) {
    'use strict';

    var KEY = 'nexus_wardrobe_ai_enabled';
    var OPEN = '<wardrobe';

    /** The tool, as an MCP server would list it. `call` is the one executor. */
    var TOOLS = Object.freeze([
        {
            name: 'wardrobe_wear',
            description:
                'Put on an outfit: a set from the outfit dictionary by id (made for her if she does not have it yet), ' +
                'or one of her saved looks by name.',
            inputSchema: {
                type: 'object',
                properties: {
                    outfit: { type: 'string', description: 'An outfit dictionary id, e.g. little-black-dress' },
                    look: { type: 'string', description: 'The name of one of her saved looks' },
                },
            },
        },
        {
            name: 'wardrobe_change',
            description:
                'Change one part of what she has on and keep the rest, e.g. "red satin crop top" replaces the top only.',
            inputSchema: {
                type: 'object',
                properties: { prompt: { type: 'string', maxLength: 120 } },
                required: ['prompt'],
            },
        },
        {
            name: 'wardrobe_create',
            description: 'Make a new look that is not in the dictionary, described in plain garment words.',
            inputSchema: {
                type: 'object',
                properties: { prompt: { type: 'string', maxLength: 120 } },
                required: ['prompt'],
            },
        },
        {
            name: 'wardrobe_tattoo',
            description:
                'Add a tattoo from the catalogue at a placement. Private only; appears only on skin her outfit leaves bare.',
            inputSchema: {
                type: 'object',
                properties: { design: { type: 'string' }, placement: { type: 'string' } },
                required: ['design', 'placement'],
            },
            private: true,
        },
        {
            name: 'wardrobe_keep',
            description: 'Keep the look she has on and end the haul.',
            inputSchema: { type: 'object' },
        },
        { name: 'wardrobe_undo', description: 'Go back to the previous look.', inputSchema: { type: 'object' } },
    ]);

    var ACTIONS = { wear: 1, change: 1, create: 1, tattoo: 1, keep: 1, undo: 1 };
    var ALLOWED = {
        wear: ['outfit', 'look'],
        change: ['prompt'],
        create: ['prompt'],
        tattoo: ['design', 'placement'],
        keep: [],
        undo: [],
    };
    var ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
    var PROMPT = /^[a-z0-9][a-z0-9 ,'+&-]{1,119}$/;
    var LOOK = /^[\p{L}\p{N}][\p{L}\p{N} &',.+()-]{0,59}$/u;

    // Tolerant about shape, strict about content — the same reading as `<ambience>` (A10):
    // anything that looks like the tag is stripped from view; only a valid one runs.
    var TAG = /<wardrobe((?:\s+[a-zA-Z_-]+\s*=\s*["'][^"'<>]{0,140}["']){0,4})\s*\/?>(?:\s*<\/wardrobe\s*>)?/i;
    var TAG_WITH_BODY =
        /<wardrobe((?:\s+[a-zA-Z_-]+\s*=\s*["'][^"'<>]{0,140}["']){0,4})\s*>[\s\S]{0,400}?<\/wardrobe\s*>/i;
    var STRAY_CLOSE = /<\/wardrobe\s*>/gi;
    var ORPHAN = /<wardrobe(?:\s[^>]{0,300})?$/i;
    var BARE = /(?:^|\n)[ \t]*wardrobe\s+action\s*=\s*["'][^"'\n]{0,24}["'][^\n]{0,200}/gi;
    var ATTRIBUTE = /([a-zA-Z_-]+)\s*=\s*["']([^"']*)["']/g;
    // The last resort: anything starting `<wardrobe` on one line, whatever is inside it —
    // markup in a value (`prompt="<script>"`) keeps TAG from matching, and a tag that is
    // neither run nor removed would be shown in the chat and read aloud.
    var LOOSE = /<wardrobe\b[^\n]{0,300}?\/?>/gi;

    // ------------------------------------------------------------------ switch
    var listeners = [];
    var memory = null;

    function storage() {
        try {
            return global && global.localStorage ? global.localStorage : null;
        } catch (_) {
            return null;
        }
    }

    /**
     * On unless somebody turned it off. Unlike ambience (A7), asking her to put something on
     * *is* the request — "wear the red dress" implies "and you may change your outfit" — and
     * the switch only governs whether she may act on that, from the chat. Settings ▸ Wardrobe
     * Forge carries the toggle.
     */
    function isEnabled() {
        var raw = memory;
        var store = storage();
        try {
            if (store) raw = store.getItem(KEY);
        } catch (_) {
            raw = memory;
        }
        return raw !== 'off';
    }

    function setEnabled(on) {
        memory = on ? 'on' : 'off';
        var store = storage();
        try {
            if (store) store.setItem(KEY, memory);
        } catch (_) {
            /* the in-memory value still applies */
        }
        listeners.slice().forEach(function (fn) {
            try {
                fn(Boolean(on));
            } catch (_) {
                /* one bad listener must not stop the others */
            }
        });
    }

    function onChange(fn) {
        listeners.push(fn);
        return function () {
            listeners = listeners.filter(function (x) {
                return x !== fn;
            });
        };
    }

    // ------------------------------------------------------------------ what exists
    function dictionary(deps) {
        if (deps && deps.dictionary) return deps.dictionary;
        var mod = global && global.NEXUS_OUTFIT_DICTIONARY;
        return mod && typeof mod.forPage === 'function' ? mod.forPage() : null;
    }

    function activity(deps) {
        if (deps && deps.activity) return deps.activity;
        var tryOn = global && global.NEXUS_TRY_ON;
        return (tryOn && tryOn.activity) || null;
    }

    function wardrobe(deps) {
        return (deps && deps.wardrobe) || (global && global.NEXUS_WARDROBE) || null;
    }

    /** Whether Forge can make looks right now (a Forge is configured). */
    function canCreate(deps) {
        var w = wardrobe(deps);
        return Boolean(w && w.service && w.service.remoteEnabled);
    }

    /** TryOnPrivate's last answer for her, as the activity keeps it. False unless known open. */
    function privateOpen(deps) {
        if (deps && typeof deps.privateOpen === 'boolean') return deps.privateOpen;
        var a = activity(deps);
        try {
            return Boolean(a && typeof a.privateOpen === 'function' && a.privateOpen());
        } catch (_) {
            return false;
        }
    }

    /** Her shelf and what she has on, as the activity knows them (names only). */
    function shelf(deps) {
        var a = activity(deps);
        try {
            return a && typeof a.shelf === 'function' ? a.shelf() : { looks: [], current: null };
        } catch (_) {
            return { looks: [], current: null };
        }
    }

    // ------------------------------------------------------------------ the prompt
    function instruction(context) {
        var lines = [
            '',
            'YOUR WARDROBE',
            'You can change what you are wearing: this app has your wardrobe and a tailor that makes new',
            'outfits for you. When the person asks you to wear, try on, change or make an outfit, do it.',
            'Write one short sentence, then one tag on its own line:',
            '',
        ];
        if (context.looks.length) {
            lines.push('  ' + OPEN + ' action="wear" look="' + context.looks[0] + '"/>   one of your saved looks');
        }
        if (context.canCreate) {
            lines.push(
                '  ' + OPEN + ' action="wear" outfit="little-black-dress"/>   a set from the list below',
                '  ' + OPEN + ' action="change" prompt="red satin crop top"/>   change one part, keep the rest',
                '  ' + OPEN + ' action="create" prompt="navy pleated mini skirt + white blouse"/>   anything not listed'
            );
            if (context.tattoos) {
                lines.push('  ' + OPEN + ' action="tattoo" design="lotus-ornament-01" placement="lower-back"/>');
            }
        }
        lines.push('  ' + OPEN + ' action="undo"/>   back to the previous look', '  ' + OPEN + ' action="keep"/>');
        if (context.running) {
            // W17. While a haul is open, the chat is its commentary track.
            lines.push(
                '',
                'A TRY-ON HAUL IS ON. You are hosting it like a YouTube try-on haul: upbeat and specific',
                'about each piece (fabric, cut, colour, how it would be worn), sometimes rating a look out',
                'of 10, asking the person "keep or return?", and suggesting what to try next. Short replies.'
            );
        }
        if (context.looks.length) lines.push('', 'Your saved looks: ' + context.looks.join('; '));
        lines.push('You are wearing: ' + (context.current || 'your own outfit'));
        if (context.canCreate && context.groups.length) {
            lines.push('', 'What the tailor can make (id = name):');
            context.groups.forEach(function (group) {
                lines.push(
                    '  ' +
                        group.title +
                        ': ' +
                        group.entries
                            .map(function (e) {
                                return e.id + ' = ' + e.title;
                            })
                            .join('; ')
                );
            });
        }
        if (context.tattoos) {
            lines.push(
                '',
                'Tattoos (they show only on skin your outfit leaves bare): ' +
                    context.tattoos.designs
                        .map(function (d) {
                            return d.id + ' (' + d.placements.join('/') + ')';
                        })
                        .join('; ')
            );
        }
        var example = context.canCreate ? 'the little black dress' : 'my ' + (context.looks[0] || 'other look');
        lines.push(
            '',
            'Asked what you can wear, answer in words — a few ideas from the list, not all of it — and',
            'offer to try one on. A question gets no tag.',
            'Say it as something you are about to do ("let me try ' + example + '"), not done: it',
            'takes a moment, and it may not work.'
        );
        if (context.canCreate) {
            lines.push(
                'Never invent an id or a look name. For anything not listed, use action="create" with a',
                'short description in plain garment words (colour, fabric, garment).'
            );
        } else {
            lines.push('Never invent a look name: only your saved looks can be worn right now.');
        }
        lines.push('Talking about clothes is not asking you to change. Write at most one tag per reply.');
        return lines.join('\n');
    }

    function context(deps) {
        var open = privateOpen(deps);
        var dict = dictionary(deps);
        var groups = [];
        if (dict && typeof dict.groups === 'function') {
            dict.groups({ privateOpen: open }).forEach(function (group) {
                var entries = dict.entries({ privateOpen: open }).filter(function (e) {
                    return e.group === group.id;
                });
                if (entries.length) groups.push({ title: group.title, entries: entries });
            });
        }
        var mine = shelf(deps);
        return {
            canCreate: canCreate(deps),
            groups: groups,
            tattoos: open && dict && typeof dict.tattoos === 'function' ? dict.tattoos({ privateOpen: true }) : null,
            looks: (mine.looks || []).slice(0, 12),
            current: mine.current || null,
            running: Boolean(mine.running),
        };
    }

    /** The paragraph to append, or `''` when she could not act on it. */
    function systemPromptSuffix(deps) {
        if (!isEnabled()) return '';
        var a = activity(deps);
        if (!a || typeof a.request !== 'function') return '';
        try {
            if (typeof a.availability === 'function' && !a.availability().ok) return '';
        } catch (_) {
            return '';
        }
        var c = context(deps);
        // With no Forge and nothing saved there is nothing she could do.
        if (!c.canCreate && !c.looks.length) return '';
        if (c.canCreate && !c.groups.length && !c.looks.length) return '';
        return '\n' + instruction(c) + '\n';
    }

    // ------------------------------------------------------------------ the tag
    function readAttributes(raw) {
        var attributes = Object.create(null);
        ATTRIBUTE.lastIndex = 0;
        var match = ATTRIBUTE.exec(raw || '');
        while (match) {
            var name = match[1].toLowerCase();
            if (Object.prototype.hasOwnProperty.call(attributes, name)) return { reason: '"' + name + '" given twice' };
            attributes[name] = match[2].trim();
            match = ATTRIBUTE.exec(raw || '');
        }
        var action = String(attributes.action || '').toLowerCase();
        if (!ACTIONS[action]) return { reason: 'unknown action "' + attributes.action + '"' };
        delete attributes.action;
        var allowed = ALLOWED[action];
        for (var key in attributes) {
            if (allowed.indexOf(key) === -1) return { reason: 'unknown attribute "' + key + '" for ' + action };
        }
        var args = {};
        if (action === 'wear') {
            if (attributes.outfit) {
                if (!ID.test(attributes.outfit.toLowerCase())) return { reason: 'outfit is not an id' };
                args.outfit = attributes.outfit.toLowerCase();
            } else if (attributes.look) {
                if (!LOOK.test(attributes.look)) return { reason: 'look is not a name' };
                args.look = attributes.look;
            } else {
                return { reason: 'wear needs an outfit or a look' };
            }
        }
        if (action === 'change' || action === 'create') {
            var prompt = String(attributes.prompt || '')
                .toLowerCase()
                .replace(/\s+/g, ' ');
            if (!PROMPT.test(prompt)) return { reason: 'prompt is not plain garment words' };
            args.prompt = prompt;
        }
        if (action === 'tattoo') {
            var design = String(attributes.design || '').toLowerCase();
            var placement = String(attributes.placement || '').toLowerCase();
            if (!ID.test(design) || !ID.test(placement)) return { reason: 'tattoo needs a design and a placement id' };
            args.design = design;
            args.placement = placement;
        }
        return { name: 'wardrobe_' + action, args: args };
    }

    function scrub(text) {
        var clean = String(text == null ? '' : text);
        while (TAG_WITH_BODY.test(clean)) clean = clean.replace(TAG_WITH_BODY, ' ');
        while (TAG.test(clean)) clean = clean.replace(TAG, ' ');
        return clean
            .replace(STRAY_CLOSE, ' ')
            .replace(LOOSE, ' ')
            .replace(ORPHAN, '')
            .replace(BARE, ' ')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .trim();
    }

    /** {clean, call: {name, args} | null, extra, rejected}. The first tag wins; the rest are dropped. */
    function extract(text) {
        var source = String(text == null ? '' : text);
        var bodied = source.match(TAG_WITH_BODY);
        var plain = source.match(TAG);
        var match = plain;
        if (bodied && (!plain || source.indexOf(bodied[0]) <= source.indexOf(plain[0]))) match = bodied;
        var clean = scrub(source);
        if (!match) return { clean: clean, call: null, extra: 0, rejected: null };
        var extra = 0;
        var rest = source.replace(match[0], ' ');
        while (TAG_WITH_BODY.test(rest) || TAG.test(rest)) {
            rest = TAG_WITH_BODY.test(rest) ? rest.replace(TAG_WITH_BODY, ' ') : rest.replace(TAG, ' ');
            extra += 1;
        }
        var read = readAttributes(match[1]);
        if (read.reason) return { clean: clean, call: null, extra: extra, rejected: read.reason };
        return { clean: clean, call: { name: read.name, args: read.args }, extra: extra, rejected: null };
    }

    function has(text) {
        var source = String(text == null ? '' : text);
        return TAG.test(source) || TAG_WITH_BODY.test(source);
    }

    // ------------------------------------------------------------------ the executor
    /**
     * Run a tool call. Resolves to {ok, why}; never rejects. The one executor for the tag and
     * for any other transport. Everything is re-checked here, at the moment it would run.
     */
    async function call(name, args, deps) {
        args = args || {};
        var tool = TOOLS.find(function (t) {
            return t.name === name;
        });
        if (!tool) return { ok: false, why: 'no such tool' };
        if (!isEnabled()) return { ok: false, why: 'Changing her outfit from the chat is turned off in Settings.' };
        var a = activity(deps);
        if (!a || typeof a.request !== 'function') return { ok: false, why: 'Try-On is not available.' };
        try {
            return (await a.request(name.replace(/^wardrobe_/, ''), args)) || { ok: true, why: '' };
        } catch (error) {
            console.warn('[Wardrobe] a wardrobe tool call failed', error);
            return { ok: false, why: (error && error.message) || 'That could not be done.' };
        }
    }

    /**
     * Extract, then run it. Returns the text to display. Not awaited: her sentence appears
     * now; Try-On opens and shows the progress itself.
     */
    function consume(text, deps) {
        var extracted = extract(text);
        if (extracted.rejected) {
            console.warn('[Wardrobe] wardrobe tag refused: ' + extracted.rejected);
            return extracted.clean;
        }
        if (!extracted.call) return extracted.clean;
        if (!isEnabled()) {
            console.warn('[Wardrobe] a wardrobe tag arrived while the switch is off — refused');
            return extracted.clean;
        }
        try {
            Promise.resolve(call(extracted.call.name, extracted.call.args, deps)).catch(function () {
                return null;
            });
        } catch (_) {
            // A tool that cannot run must not take her reply down with it.
        }
        return extracted.clean;
    }

    var api = {
        KEY: KEY,
        OPEN: OPEN,
        TOOLS: TOOLS,
        TAG: TAG,
        isEnabled: isEnabled,
        setEnabled: setEnabled,
        onChange: onChange,
        instruction: instruction,
        context: context,
        systemPromptSuffix: systemPromptSuffix,
        extract: extract,
        scrub: scrub,
        has: has,
        call: call,
        consume: consume,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_WARDROBE_TOOL = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
