/**
 * LT1. What a person means when they type into Try-On.
 *
 * Live Try-On has one composer — "Tell me what to change…" — and what is typed there is one
 * of two different things. "Next", "go back to the yellow dress", "compare", "keep this"
 * are **navigation**: the session does them, from looks that already exist, in a second.
 * "Make the top black", "keep the jeans but give her a satin crop top", "something more
 * elegant" are **a request to Forge**, which takes half a minute and makes a new file. Sending
 * "next" to Forge would make a garment called "next"; treating "black dress" as navigation
 * would find nothing. So this module decides which, and says so as data:
 *
 *     {kind: 'command', command, which?}      a TryOnSession call
 *     {kind: 'wear', look}                    a look she already has
 *     {kind: 'create', prompt, baseLookId, mode: 'change' | 'fresh', slot, label}
 *     {kind: 'surprise', category}            pick something for her
 *     {kind: 'ask', question, options}        one short question back, with answers to tap
 *     {kind: 'none', why}                     nothing to do, and a sentence saying why
 *
 * It never touches the avatar and never calls Forge — the view hands the answer to the
 * session or the generator — so every phrase is testable as a string in, an object out.
 *
 * The rule that matters most: **"change X" preserves everything the person did not ask to
 * change.** Two ways, depending on what Forge knows:
 *
 * - The look was made by Forge's library route (`source` generated or forge), so Forge has
 *   it by id. The request is just the new garment, sent with `baseLookId`; Forge builds on
 *   that look and its strip plan replaces only what the new garment covers.
 * - Anything else (the shipped pack, an imported pack, a generic-route avatar). Forge does
 *   not have the look, so it is rebuilt from her original avatar with the look's own recipe
 *   — `black fitted crop top + blue straight jeans` — in which only the named part is
 *   rewritten: `red fitted crop top + blue straight jeans`. The jeans are asked for again,
 *   by the same words that made them.
 *
 * A colour with no part named ("make it red") on a look of two parts is a question, not a
 * guess: "Which part?" with "Make the top red" and "Make the jeans red" to tap.
 *
 * Exposes: window.NEXUS_TRY_ON_INTENT
 */
(function (global) {
    'use strict';

    var UNAVAILABLE = 'Creating new looks unavailable — her saved looks still work.';
    var HINT = 'Try naming a garment, like “black satin cocktail dress”, or say “change the top to red”.';

    var COLORS = [
        'black',
        'white',
        'red',
        'pink',
        'blue',
        'navy',
        'green',
        'emerald',
        'yellow',
        'purple',
        'lilac',
        'lavender',
        'beige',
        'cream',
        'ivory',
        'champagne',
        'grey',
        'gray',
        'brown',
        'tan',
        'gold',
        'silver',
        'burgundy',
        'orange',
        'teal',
        'coral',
        'olive',
        'khaki',
        'neon green',
        'hot pink',
        'light blue',
        'dark blue',
        'baby blue',
    ];
    var MATERIALS = ['satin', 'silk', 'lace', 'leather', 'velvet', 'cotton', 'linen', 'knit', 'sheer', 'mesh', 'latex'];

    /** The parts of an outfit, by the words people and Forge's planner use for them. */
    var SLOTS = Object.freeze({
        top: [
            'crop top',
            'tube top',
            'tank top',
            't-shirt',
            'tshirt',
            'tee',
            'top',
            'shirt',
            'blouse',
            'tank',
            'cami',
            'camisole',
            'sweater',
            'jumper',
            'hoodie',
            'corset',
        ],
        bottom: ['bottoms', 'jeans', 'trousers', 'pants', 'shorts', 'skirt', 'leggings', 'joggers'],
        dress: ['sundress', 'dress', 'gown', 'nightdress', 'jumpsuit', 'romper'],
        outer: ['jacket', 'blazer', 'cardigan', 'coat', 'kimono'],
        legwear: ['stockings', 'tights', 'socks'],
        shoes: ['shoes', 'boots', 'heels', 'sneakers', 'sandals', 'trainers'],
        set: ['lingerie', 'bikini', 'swimsuit', 'bodysuit', 'catsuit', 'underwear'],
    });

    /** "What should the new top be?" — answers to tap, all phrases Forge's planner knows. */
    var SLOT_IDEAS = Object.freeze({
        top: ['black satin crop top', 'white fitted tee', 'white tube top'],
        bottom: ['blue straight jeans', 'black straight trousers', 'blue denim shorts'],
        dress: ['black satin cocktail dress', 'red midi dress', 'yellow maxi sundress'],
        outer: ['black blazer', 'grey long cardigan'],
        legwear: ['sheer black stockings'],
        shoes: [],
        set: [],
    });

    /** "Something more elegant": a mood, turned into a look Forge can make. */
    var STYLES = Object.freeze([
        {
            words: /\b(elegant|classy|formal|evening|sophisticated|glam(orous)?)\b/,
            prompt: 'black satin cocktail dress',
        },
        { words: /\b(casual|relaxed|everyday|laid[- ]back|chill)\b/, prompt: 'white fitted tee + blue straight jeans' },
        { words: /\b(smart|office|work|business|professional)\b/, prompt: 'black blazer + black straight trousers' },
        {
            words: /\b(cosy|cozy|warm|comfy|comfortable|soft)\b/,
            prompt: 'grey long cardigan + black straight trousers',
        },
        { words: /\b(summer|summery|sunny|light|breezy)\b/, prompt: 'yellow maxi sundress' },
        { words: /\b(party|night out|going out|clubbing|bold)\b/, prompt: 'red bodycon mini dress' },
    ]);

    var CATEGORIES = Object.freeze([
        { id: 'for-you', label: 'For you' },
        { id: 'casual', label: 'Casual' },
        { id: 'dressy', label: 'Dressy' },
        { id: 'private', label: 'Private', private: true },
    ]);

    var SUGGESTIONS = Object.freeze({
        'for-you': [
            { label: 'Yellow sundress', prompt: 'yellow maxi sundress' },
            { label: 'Crop top & jeans', prompt: 'black fitted crop top + blue straight jeans' },
            { label: 'Little black dress', prompt: 'black satin cocktail dress' },
        ],
        casual: [
            { label: 'Tee & jeans', prompt: 'white fitted tee + blue straight jeans' },
            { label: 'Denim shorts', prompt: 'white cropped tee + blue denim shorts' },
            { label: 'Cosy cardigan', prompt: 'grey long cardigan + black straight trousers' },
            { label: 'Maxi skirt', prompt: 'white fitted tee + blue maxi skirt' },
        ],
        dressy: [
            { label: 'Cocktail dress', prompt: 'black satin cocktail dress' },
            { label: 'Red midi', prompt: 'red midi dress' },
            { label: 'Bodycon mini', prompt: 'red bodycon mini dress' },
            { label: 'Blazer & trousers', prompt: 'black blazer + black straight trousers' },
        ],
    });

    // Navigation, as whole phrases. Anchored: "keep the jeans, change the top" is not Keep.
    var COMMANDS = [
        { re: /^(undo|undo that|take that back|go back a step|back a step|step back)$/, command: 'undo' },
        {
            re: /^(next|next one|next look|another|another one|show me another|(show me )?the next( one)?|skip)$/,
            command: 'next',
        },
        {
            re: /^(previous|previous one|previous look|prev|go back|back|last one|the one before)$/,
            command: 'previous',
        },
        {
            re: /^(compare( (it|this|this one))? (with|to) (the )?original|(show( me)? )?(the )?original|show( me)? how she was|before)$/,
            command: 'compare',
            which: 'original',
        },
        {
            re: /^compare( (it|this|this one))?( (with|to) (the )?(previous|last|one before)( one| look)?)?$/,
            command: 'compare',
            which: 'previous',
        },
        {
            re: /^(keep (this|it|that|this one|this look|that one|that look)|i'?ll take (it|this|this one)|that'?s the one|this is the one|she should wear this)$/,
            command: 'keep',
        },
        {
            re: /^(save( (this|it|this one|this look))?|favou?rite( (this|it))?|heart( (this|it))?|i love (it|this)|love (it|this)|♡|❤️?)$/,
            command: 'favorite',
        },
        {
            re: /^(play|play (the )?haul|show mode|start (the )?show|fashion show|play (them|all|my favou?rites|the favou?rites))$/,
            command: 'play',
        },
        { re: /^(stop|pause|stop (the )?show|stop playing)$/, command: 'pause' },
        {
            re: /^(turn( around)?|spin|show( me)? (the|her) back|turn her around|let me see the back|back view)$/,
            command: 'turn',
        },
        { re: /^(end|end (the )?haul|done|i'?m done|finish|that'?s all)$/, command: 'end' },
    ];

    var SURPRISE =
        /^(?:(?:try|show me|give her|do|go for|let'?s try) )?(surprise me|surprise|anything|you choose|you pick|dealer'?s choice|something (else|new|different)|(something )?completely different|start (over|fresh)|from scratch)$/;
    var WEAR =
        /^(?:wear|put on|try on|try|show me|show|go back to|back to|switch to|put her (?:back )?in(?:to)?|let'?s see|go to)\s+(?:the |that |her |my |a |an )?(.+?)(?:\s+(?:again|look|one))?$/;

    function normalize(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/[‘’]/g, "'")
            .replace(/[“”"]/g, '')
            .replace(/[.!?]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^(please|can you|could you|let'?s|now|ok|okay|and|hey|so)[, ]+/g, '')
            .replace(/^(please|can you|could you|now|ok|okay)[, ]+/g, '')
            .replace(/[, ]+(please|now)$/g, '')
            .trim();
    }

    function escape(word) {
        return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function has(phrase, word) {
        return new RegExp('(^|[^a-z])' + escape(word) + 's?($|[^a-z])').test(phrase);
    }

    /** The garment a phrase names, as {slot, noun}, longest noun first; null when none. */
    function garmentOf(phrase) {
        var best = null;
        Object.keys(SLOTS).forEach(function (slot) {
            SLOTS[slot].forEach(function (noun) {
                if (has(phrase, noun) && (!best || noun.length > best.noun.length)) best = { slot: slot, noun: noun };
            });
        });
        return best;
    }

    function slotOf(phrase) {
        var found = garmentOf(phrase || '');
        return found ? found.slot : null;
    }

    function colorsIn(phrase) {
        return COLORS.filter(function (color) {
            return has(phrase, color);
        });
    }

    function describes(phrase) {
        return Boolean(
            garmentOf(phrase) ||
                colorsIn(phrase).length ||
                MATERIALS.some(function (m) {
                    return has(phrase, m);
                })
        );
    }

    /** A look's recipe: what Forge was asked for, else its name. */
    function promptOf(look) {
        if (!look) return '';
        return String(look.prompt || (look.provenance && look.provenance.prompt) || look.name || '');
    }

    /** "black fitted crop top + blue straight jeans" → its parts. */
    function segments(prompt) {
        return String(prompt || '')
            .toLowerCase()
            .split(/\s*[+&]\s*/)
            .map(function (part) {
                return part.trim();
            })
            .filter(Boolean);
    }

    /** Rewrite one part with an adjective-only change: "red" on "black fitted crop top". */
    function restyle(segment, change) {
        var out = segment;
        if (colorsIn(change).length) {
            colorsIn(segment)
                .sort(function (a, b) {
                    return b.length - a.length;
                })
                .forEach(function (color) {
                    out = out.replace(new RegExp('(^|\\s)' + escape(color) + '(?=\\s|$)'), ' ');
                });
        }
        return (change + ' ' + out).replace(/\s+/g, ' ').trim();
    }

    /** The whole recipe with the part in `slot` replaced by `part` (added when it has none). */
    function compose(parts, slot, part) {
        var out = parts.slice();
        var at = -1;
        for (var i = 0; i < out.length; i += 1) {
            if (slotOf(out[i]) === slot) {
                at = i;
                break;
            }
        }
        if (slot === 'dress' || slot === 'set') {
            // A dress replaces a top and its bottoms: one garment in their place.
            out = out.filter(function (p) {
                var s = slotOf(p);
                return s !== 'top' && s !== 'bottom' && s !== 'dress' && s !== 'set';
            });
            out.unshift(part);
            return out;
        }
        if (at === -1 && (slot === 'top' || slot === 'bottom')) {
            // A top or bottoms on a dress: the dress goes, the other half is asked for as is.
            for (var j = 0; j < out.length; j += 1) {
                if (slotOf(out[j]) === 'dress') {
                    at = j;
                    break;
                }
            }
        }
        if (at === -1) out.push(part);
        else out[at] = part;
        return out;
    }

    function article(phrase) {
        return phrase.replace(/^(a|an|some|the)\s+/, '');
    }

    /** Best look on her shelf for a name ("the yellow dress" → "Yellow sundress"), or null. */
    function findLook(query, looks) {
        var words = article(query)
            .split(/\s+/)
            .filter(function (w) {
                return (
                    w && ['the', 'a', 'an', 'my', 'her', 'that', 'one', 'look', 'outfit', 'and', '&'].indexOf(w) === -1
                );
            });
        if (!words.length) return null;
        var best = null;
        (looks || []).forEach(function (look) {
            var name = String(look.name || '').toLowerCase();
            var tokens = name.split(/[^a-z0-9-]+/).filter(Boolean);
            var hit = words.filter(function (w) {
                return tokens.some(function (t) {
                    return t === w || t === w + 's' || w === t + 's' || (w.length >= 4 && t.indexOf(w) !== -1);
                });
            }).length;
            var score = hit / words.length;
            if (score >= 0.66 && (!best || score > best.score)) best = { look: look, score: score };
        });
        return best ? best.look : null;
    }

    function label(sentence) {
        var s = String(sentence || '').trim();
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    }

    /**
     * Pull the change out of a sentence: {target, change} where `target` names the part
     * ("the top", "it") and `change` is what it becomes ("black", "a satin crop top").
     */
    function changeOf(t) {
        var m = t.match(
            /\b(?:change|swap|switch|replace)\s+(?:the |her |my |this )?(.+?)\s+(?:to|for|with|into)\s+(?:a |an |some )?(.+)$/
        );
        if (m) return { target: m[1], change: m[2] };
        m = t.match(/\bmake\s+(it|this|that|her outfit|the outfit|everything)\s+(?:in\s+)?(.+)$/);
        if (m) return { target: '', change: m[2] };
        m = t.match(/\bmake\s+(?:the |her )?(.+)$/);
        if (m) {
            var found = garmentOf(m[1]);
            if (found) {
                var at = m[1].search(new RegExp('(^|[^a-z])' + escape(found.noun) + 's?($|[^a-z])'));
                var end = m[1].indexOf(found.noun, Math.max(0, at)) + found.noun.length;
                var rest = m[1].slice(end).replace(/^s\b/, '').trim();
                if (rest) return { target: m[1].slice(0, end), change: rest.replace(/^(in|into)\s+/, '') };
            }
        }
        m = t.match(/\b(?:give her|put her in|add|swap in|instead,? )\s*(?:a |an |some )?(.+)$/);
        if (m && garmentOf(m[1])) return { target: '', change: m[1] };
        m = t.match(/\b(?:change|swap|switch|replace)\s+(?:the |her |my )?(.+)$/);
        if (m) {
            if (/^(colou?rs?|the colou?rs?)$/.test(m[1])) return { target: '', change: '', colorOnly: true };
            return { target: m[1], change: '' };
        }
        m = t.match(/^(?:(?:try |do |show )?(?:it|this|that|her) )?in\s+(.+)$/);
        if (m && colorsIn(m[1]).length) return { target: '', change: m[1] };
        if (/\b(how about|what about|instead|but)\b/.test(t)) {
            var tail = t
                .replace(/^.*\b(how about|what about|instead of|instead|but)\b\s*/, '')
                .replace(/^(a|an|some)\s+/, '');
            if (garmentOf(tail)) return { target: '', change: tail.replace(/^(give her|put her in)\s+(a |an )?/, '') };
        }
        return null;
    }

    /**
     * Read one message.
     *
     * context: {looks, current (the look she has on, or null), canCreate, canBuildOn (Forge's
     *           library route: it has her looks by id), category}
     */
    function parse(text, context) {
        context = context || {};
        var t = normalize(text);
        if (!t) return { kind: 'none', why: '' };

        for (var i = 0; i < COMMANDS.length; i += 1) {
            if (COMMANDS[i].re.test(t)) {
                var command = { kind: 'command', command: COMMANDS[i].command };
                if (COMMANDS[i].which) command.which = COMMANDS[i].which;
                return command;
            }
        }
        if (SURPRISE.test(t)) return { kind: 'surprise', category: context.category || 'for-you' };

        var looks = context.looks || [];
        var named = t.match(WEAR);
        var mutating = /\b(change|swap|switch|replace|make|give her|add|instead|keep the)\b/.test(t);
        if (named && !mutating) {
            var found = findLook(named[1], looks);
            if (found) return { kind: 'wear', look: found };
        }
        if (!mutating) {
            var exact = findLook(t, looks);
            if (exact && String(exact.name || '').toLowerCase() === article(t)) return { kind: 'wear', look: exact };
        }

        if (!context.canCreate) return { kind: 'none', why: UNAVAILABLE };

        for (var s = 0; s < STYLES.length; s += 1) {
            if (/\b(something|more|less|a bit|go|look|feel)\b/.test(t) && STYLES[s].words.test(t) && !garmentOf(t)) {
                return {
                    kind: 'create',
                    mode: 'fresh',
                    prompt: STYLES[s].prompt,
                    baseLookId: null,
                    slot: null,
                    label: label(t),
                };
            }
        }

        var current = context.current && !context.current.original ? context.current : null;
        var change = changeOf(t);
        if (change) return planChange(change, current, context, t);

        var cleaned = article(
            t.replace(
                /^(try|wear|show me|show her in|put her in|i want|i'?d like|let'?s try|let'?s see|dress her in|how about|what about)\s+(her in\s+)?/,
                ''
            )
        );
        if (describes(cleaned)) {
            return {
                kind: 'create',
                mode: 'fresh',
                prompt: cleaned,
                baseLookId: null,
                slot: slotOf(cleaned),
                label: label(cleaned),
            };
        }
        return { kind: 'none', why: HINT };
    }

    function planChange(change, current, context, sentence) {
        var parts = current ? segments(promptOf(current)) : [];
        var wanted = article(change.change || '');
        var named = garmentOf(change.target || '');
        var made = garmentOf(wanted);
        var slot = made ? made.slot : named ? named.slot : null;

        if (change.colorOnly || (!wanted && !named)) {
            return {
                kind: 'ask',
                question: 'What colour should it be?',
                options: ['black', 'white', 'red', 'pink'].map(function (c) {
                    return 'Make it ' + c;
                }),
            };
        }
        if (!wanted) {
            // "Change the top" — to what? One question, with answers Forge knows.
            return {
                kind: 'ask',
                question: 'What should the new ' + named.noun + ' be?',
                options: (SLOT_IDEAS[named.slot] || []).map(function (idea) {
                    return 'Change the ' + named.noun + ' to ' + idea;
                }),
                slot: named.slot,
            };
        }

        var part;
        if (made) {
            part = wanted;
        } else {
            // An adjective change ("black", "black satin") to a part she has on.
            var target = null;
            if (slot) {
                target = parts.find(function (p) {
                    return slotOf(p) === slot;
                });
            } else if (parts.length === 1) {
                target = parts[0];
                slot = slotOf(target);
            } else if (parts.length > 1) {
                return {
                    kind: 'ask',
                    question: 'Which part should be ' + wanted + '?',
                    options: parts
                        .map(function (p) {
                            var g = garmentOf(p);
                            return g ? 'Make the ' + g.noun + ' ' + wanted : null;
                        })
                        .filter(Boolean),
                };
            }
            if (!target && !named) {
                return { kind: 'none', why: 'Tell me what should be ' + wanted + ' — like “a ' + wanted + ' dress”.' };
            }
            part = target ? restyle(target, wanted) : wanted + ' ' + named.noun;
        }

        var base = current && context.canBuildOn && buildable(current) ? String(current.id) : null;
        var prompt = base || !parts.length ? part : compose(parts, slot, part).join(' + ');
        // "Make the top black" on a black top would spend half a minute making the same look.
        if (parts.indexOf(part) !== -1) return { kind: 'none', why: 'She’s already wearing that.' };
        return {
            kind: 'create',
            mode: 'change',
            prompt: prompt,
            baseLookId: base,
            slot: slot,
            label: label(sentence),
        };
    }

    /** Forge has this look by id: it made it on her library route. */
    function buildable(look) {
        return Boolean(look && look.id && (look.source === 'generated' || look.source === 'forge'));
    }

    /** The quick picks for a category; Private's come from TryOnPrivate and only when it is open. */
    function suggestions(category, context) {
        context = context || {};
        if (category === 'private') {
            return (context.privatePicks || []).map(function (pick) {
                return { label: pick.label, prompt: pick.prompt };
            });
        }
        return (SUGGESTIONS[category] || SUGGESTIONS['for-you']).slice();
    }

    /** "Surprise me": one suggestion from the category that is not what she has on. */
    function surprise(category, context) {
        context = context || {};
        var pool = suggestions(category, context);
        // "For you" draws on every general suggestion; a chosen category stays inside itself.
        if (category === 'for-you' || !category) pool = pool.concat(SUGGESTIONS.casual, SUGGESTIONS.dressy);
        var now = promptOf(context.current).toLowerCase();
        pool = pool.filter(function (pick) {
            return pick.prompt.toLowerCase() !== now;
        });
        if (!pool.length) return null;
        var random = typeof context.random === 'function' ? context.random : Math.random;
        return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
    }

    var api = {
        CATEGORIES: CATEGORIES,
        SUGGESTIONS: SUGGESTIONS,
        SLOTS: SLOTS,
        UNAVAILABLE: UNAVAILABLE,
        parse: parse,
        normalize: normalize,
        segments: segments,
        compose: compose,
        restyle: restyle,
        slotOf: slotOf,
        promptOf: promptOf,
        findLook: findLook,
        buildable: buildable,
        suggestions: suggestions,
        surprise: surprise,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRY_ON_INTENT = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
