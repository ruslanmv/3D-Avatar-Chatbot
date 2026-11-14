/**
 * LT7. The try-on haul, in every language AppLanguage already speaks.
 *
 * The haul used to be English on a page whose language setting otherwise
 * changed the companion, the voice and the model's replies. These packs are
 * the words a person reads and the lines she says. Forge prompts stay English:
 * the planner only matches an English garment name, so a translated chip still
 * sends the outfit's original `prompt`.
 *
 * en-GB shares the English pack. The haul was already written in the same
 * international English AppLanguage uses for both English locales.
 *
 * A missing key falls back to English rather than a blank button. `tx` also
 * accepts the English sentence, so a test that never loads this file still
 * sees the copy it was written against.
 *
 * Exposes: window.NEXUS_TRY_ON_LOCALE
 */
(function (global) {
    'use strict';

    var CODES = ['en-US', 'en-GB', 'es-ES', 'it-IT', 'fr-FR', 'de-DE', 'pt-BR', 'ja-JP', 'ko-KR', 'zh-CN'];

    var EN = {
        'stage.badge': 'AI · LIVE TRY-ON',
        'stage.looks': 'Looks ({n})',
        'stage.hideLooks': 'Hide the looks ({n})',
        'stage.showLooks': 'Show the looks ({n})',
        'stage.close': 'Close ×',
        'stage.more': '＋ More',
        'stage.chooseClothing': 'Choose the avatar clothing',
        'stage.try': 'Try {name}',
        'stage.lookN': 'Look {n}',
        'stage.noOutfits': 'No outfits yet',
        'stage.rail': 'Available outfits',
        'stage.info': 'Current look and try-on controls',
        'stage.current': 'CURRENT LOOK · LOOK {n} / {total}',
        'stage.studio': 'YOUR STYLE STUDIO',
        'stage.currentLook': 'Current look',
        'stage.chooseFirst': 'Choose your first look',
        'stage.explore': 'Explore your wardrobe and try a new outfit.',
        'stage.thisLook': 'this look',
        'stage.wearing': 'Now wearing {name}{detail}',
        'stage.underLabel': 'Underneath · {color}',
        'stage.underChange': 'Change',
        'stage.underAria': 'Underneath: {color}. Change the colour',
        'stage.front': 'Front',
        'stage.showBack': 'Show back',
        'stage.turn': 'Turn',
        'stage.fullBody': 'Full body',
        'stage.zoom': 'Zoom',
        'stage.full': 'Full',
        'stage.saved': 'Saved',
        'stage.saveLook': 'Save look',
        'stage.save': 'Save',
        'stage.nextLook': 'Next look',
        'stage.next': 'Next',
        'catalog.aria': 'Customize this look',
        'catalog.loadError': 'Could not load garments from Forge.',
        'catalog.title': 'Customize This Look',
        'catalog.subtitle': 'Real Forge garments · choose before applying',
        'catalog.close': 'Close ×',
        'catalog.category': 'Garment category',
        'catalog.select': 'Select {name}',
        'catalog.previewAlt': '{name} preview on reference avatar',
        'catalog.previewMissing': 'Preview not ready',
        'catalog.forgeDown': 'Wardrobe Forge is unavailable.',
        'catalog.loading': 'Loading garments…',
        'catalog.empty': 'No public garments available.',
        'catalog.pick': 'Select one real garment to propose a change.',
        'catalog.generating': 'Generating…',
        'catalog.apply': 'Apply garment',
        'catalog.advanced': 'Advanced',
        'catalog.under': 'Underneath:',
        'catalog.underHint': 'Used from the next look you make.',
        'catalog.unavailable': 'Garment creation is not available for this avatar.',
        'catalog.kept': 'This garment could not be applied. Your look was kept.',
        'catalog.failed': 'Unable to apply that garment.',
        'color.beige': 'Beige',
        'color.nude': 'Nude',
        'color.white': 'White',
        'color.black': 'Black',
        'color.red': 'Red',
        'color.pink': 'Pink',
        'color.blue': 'Blue',
        'under.wearing': 'Wearing now',
        'under.pick': 'Stylist’s pick',
        'under.ready': 'Ready',
        'under.kicker': 'WHAT’S UNDERNEATH',
        'under.herLook': 'Her look',
        'under.close': 'Close',
        'under.aria': '{label} underneath',
        'under.more': 'More colours:',
        'under.back': 'Back to {color}',
        'under.compare': 'Compare with {color}',
        'under.save': 'Save look',
        'under.saved': 'Saved to her looks.',
        'under.making': 'Making it {color}…',
        'under.choose': 'Choose a colour',
        'under.on': '{color} is on',
        'under.try': 'Try it in {color}',
        'live.heading': 'CONVERSATION WITH NEXUS',
        'live.subtitle': 'Your AI stylist · Live fashion and ideas',
        'live.view': 'Try-On conversation view',
        'live.live': '● Live',
        'live.conversation': 'Conversation',
        'live.liveMode': '● Live mode',
        'live.conversationMode': 'Conversation mode',
        'live.history': 'Full history ↗',
        'live.recent': '‹ Recent',
        'live.historyAria': 'Open full conversation history',
        'live.commentary': 'Latest NEXUS commentary',
        'live.kicker': '● NEXUS',
        'live.kickerMore': ' · LIVE COMMENTARY',
        'live.prompt': 'Choose a look or ask me what to try next.',
        'live.chip.style': 'How would you style it?',
        'live.chip.back': 'Show me the back',
        'live.chip.next': 'What should we try next?',
        'live.placeholder': 'Ask NEXUS…',
        'live.you': 'YOU · {text}',
        'live.ask.style':
            'For my current outfit ({name}), how would you style it? Give two specific, concise fashion suggestions.',
        'live.ask.next':
            'We are trying on {name}. Suggest one different style direction for our next outfit and explain briefly.',
        'view.title': 'Try-On',
        'view.keep': '♥ KEEP THIS LOOK',
        'view.keepPlain': 'KEEP THIS LOOK',
        'view.end': 'End haul',
        'view.back': 'Back',
        'view.head': 'TOGETHER · TRY-ON',
        'view.more': 'More ▴',
        'view.hide': 'Hide ▾',
        'view.previous': 'Previous look',
        'view.save': 'Save',
        'view.compareBack': 'Back to the current look',
        'view.compare': 'Compare',
        'view.turn': 'Turn',
        'view.next': 'Next look',
        'view.showingOriginal': 'Showing the original',
        'view.showingPrevious': 'Showing the previous look',
        'view.opening': 'Opening her wardrobe…',
        'view.noLooks': 'No looks for her yet.',
        'view.surprise': 'Surprise me',
        'view.privateOutfits': 'Private outfits',
        'view.change': 'Change {part}',
        'view.changeColour': 'Change colour',
        'view.whatTry': 'What should she try?',
        'view.puttingOn': 'Putting it on…',
        'view.compareOriginal': 'Original ↔ current',
        'view.comparePrevious': 'Previous ↔ current',
        'view.showMode': 'Show mode',
        'view.lookCount': 'Look {n} of {total}',
        'view.howStarted': 'How she started',
        'view.fitNeeds': 'Fit needs work',
        'haul.title': 'Try-On',
        'haul.look': 'Look',
        'haul.lookOf': 'Look {n} of {total} · {name}',
        'haul.original': 'Original',
        'haul.browsing': 'Browsing looks',
        'slot.top': 'top',
        'slot.bottom': 'bottoms',
        'slot.dress': 'dress',
        'slot.outer': 'layer',
        'slot.legwear': 'stockings',
        'slot.set': 'set',
        'group.for-you': 'For you',
        'group.private': 'Private',
        'group.casual': 'Casual',
        'group.dressy': 'Dressy',
        'group.discoteca': 'Night out · All black',
        'group.smart': 'Smart',
        'group.cozy': 'Cozy & home',
        'group.summer': 'Summer',
        'group.swim': 'Swimwear',
        'group.lingerie': 'Lingerie',
        'group.legwear': 'Stockings & legwear',
        'group.sheer': 'Sheer',
        'suggest.Yellow sundress': 'Yellow sundress',
        'suggest.Crop top & jeans': 'Crop top & jeans',
        'suggest.Little black dress': 'Little black dress',
        'suggest.Tee & jeans': 'Tee & jeans',
        'suggest.Denim shorts': 'Denim shorts',
        'suggest.Cosy cardigan': 'Cosy cardigan',
        'suggest.Maxi skirt': 'Maxi skirt',
        'suggest.Cocktail dress': 'Cocktail dress',
        'suggest.Red midi': 'Red midi',
        'suggest.Bodycon mini': 'Bodycon mini',
        'suggest.Blazer & trousers': 'Blazer & trousers',
        'suggest.Lace lingerie': 'Lace lingerie',
        'suggest.Bikini': 'Bikini',
        'suggest.Stockings': 'Stockings',
        'suggest.Satin nightdress': 'Satin nightdress',
        'suggest.Sheer blouse': 'Sheer blouse',
        'private.locked.forge': 'Private outfits are made by Wardrobe Forge, which is not connected.',
        'private.locked.library':
            'Private outfits are available for built-in avatars that Wardrobe Forge’s operator has declared adult. {name} is not one of them.',
        'private.locked.offline': 'Wardrobe Forge can’t be reached, so private outfits aren’t available right now.',
        'private.locked.adult':
            'Private outfits are off for {name}: Wardrobe Forge’s operator has not declared this avatar adult.',
        'reason.ready': 'Ready',
        'reason.step.queued': 'Waiting for a free fitting room',
        'reason.step.validating': 'Checking the avatar',
        'reason.step.analyzing-avatar': 'Measuring her',
        'reason.step.planning-outfit': 'Planning the outfit',
        'reason.step.generating-garment': 'Making the garment',
        'reason.step.fitting': 'Fitting it to her',
        'reason.step.skinning': 'Letting it move with her',
        'reason.step.resolving-clipping': 'Checking nothing shows through',
        'reason.step.exporting': 'Finishing the look',
        'reason.step.validating-output': 'Checking the finished look',
        'reason.step.rendering-preview': 'Taking a picture',
        'reason.stage.designing.label': 'DESIGNING',
        'reason.stage.designing.line': 'Designing your change…',
        'reason.stage.fitting.label': 'FITTING',
        'reason.stage.fitting.line': 'Fitting it…',
        'reason.stage.ready.label': 'READY',
        'reason.stage.ready.line': 'Almost ready…',
        'reason.transport.offline': "Wardrobe Forge can't be reached right now. Your saved looks still work.",
        'reason.transport.busy': 'Forge is busy. Wait a moment and try again.',
        'reason.transport.auth': 'This Forge needs a key before it will make looks.',
        'reason.transport.timeout': 'That took too long, so it was stopped. Your avatar is unchanged.',
        'reason.transport.generic': "That look couldn't be made. Your avatar is unchanged.",
        'reason.why.source_model_modification_not_permitted':
            "This avatar's licence doesn't allow changing her outfit, so Forge won't dress her.",
        'reason.why.requires_user_license_attestation':
            "Forge needs to know you're allowed to modify this avatar before it can dress her.",
        'reason.why.source_is_not_a_vrm': "This avatar isn't a VRM file, so Forge can't dress her.",
        'reason.why.source_is_not_humanoid': "This avatar has no humanoid skeleton, so clothes can't be fitted to her.",
        'reason.why.source_exceeds_size_limit': 'This avatar file is too large for Forge.',
        'reason.why.source_could_not_be_fetched': "Forge couldn't download this avatar.",
        'reason.why.source_hash_mismatch': "The avatar file changed on the way to Forge, so it wasn't used.",
        'reason.why.source_uses_unsupported_features': 'This avatar uses features Forge cannot work with yet.',
        'reason.why.no_garment_template_matched':
            "Forge doesn't know how to make that yet. Try naming a garment, like 'red midi dress'.",
        'reason.why.fitting_failed': "The garment couldn't be fitted to her. Try a different shape or length.",
        'reason.why.output_validation_failed': "The finished look didn't pass Forge's checks, so it wasn't kept.",
        'reason.why.garment_provider_error': 'Something went wrong making the garment. Please try again.',
        'reason.why.intimate_garments_not_permitted_by_model':
            "This avatar's licence doesn't allow that kind of outfit.",
        'reason.why.requires_adult_declaration': "That kind of outfit isn't available for this avatar.",
        'reason.why.source_body_incomplete_under_clothing':
            "This avatar has no body under her clothes there, so they can't be replaced.",
        'reason.why.foundation_would_sit_over_worn_clothing':
            "That would go on over what she's wearing. Take her outfit off first, then try it.",
        'reason.why.source_skin_has_painted_clothing':
            "Her clothes are painted onto this avatar's skin, so underwear can't go on bare skin here. Try another avatar, or keep her clothes on.",
        'reason.why.internal_error': 'Forge ran into a problem. Please try again.',
        'react.action.turn': 'Show me the back',
        'react.action.color': 'Try another colour',
        'react.action.keep': 'Keep this',
        'react.action.save': '♡ Save',
        'react.action.compare': 'Compare',
        'react.private.made.0': 'Okay… this one’s just for you.',
        'react.private.made.1': 'A little daring. Do you like it?',
        'react.private.made.2': 'Well? Say something.',
        'react.private.shelf.0': 'This one again? I knew it.',
        'react.private.shelf.1': 'Just between us, right?',
        'react.private.shelf.2': 'You have good taste.',
        'react.private.tattoo.0': 'Do you like where I put it?',
        'react.private.tattoo.1': 'Ink suits me, right?',
        'react.private.tattoo.2': 'Our little secret.',
        'react.change.0': 'The new {word} changes the whole look.',
        'react.change.1': 'Same everything else, new {word}. Better?',
        'react.change.2': 'Oh, I like this {word}.',
        'react.fresh.0': 'Made just for me — what do you think?',
        'react.fresh.1': 'Fresh off the rail!',
        'react.fresh.2': 'Ooh, new.',
        'react.casual.0': 'This one feels much more casual.',
        'react.casual.1': 'Much more relaxed.',
        'react.dressy.0': 'Now this is dressed up.',
        'react.dressy.1': 'Ooh, going somewhere?',
        'react.shelf.0': 'Want to see the back?',
        'react.shelf.1': 'I like this one.',
        'react.shelf.2': 'This suits me, right?',
        'outfit.crop-top-jeans': 'Crop top & jeans',
        'outfit.tee-jeans': 'Tee & jeans',
        'outfit.denim-shorts': 'Denim shorts',
        'outfit.tube-top-baggy-jeans': 'Tube top & baggy jeans',
        'outfit.cami-wide-leg': 'Cami & wide-leg trousers',
        'outfit.halter-skater': 'Halter top & skater skirt',
        'outfit.leggings-cardigan': 'Leggings & cropped cardigan',
        'outfit.little-black-dress': 'Little black dress',
        'outfit.red-bodycon': 'Red bodycon mini',
        'outfit.evening-gown': 'Evening gown',
        'outfit.wrap-dress': 'Wrap dress',
        'outfit.slip-dress': 'Satin slip dress',
        'outfit.skater-dress': 'Skater dress',
        'outfit.corset-mini': 'Corset top & mini',
        'outfit.discoteca-stiletto-ankle': 'Black dress & stiletto ankle boots',
        'outfit.discoteca-platform': 'Black dress & platform boots',
        'outfit.discoteca-combat': 'Black dress & combat boots',
        'outfit.discoteca-over-knee': 'Black dress & over-the-knee boots',
        'outfit.blazer-trousers': 'Blazer & trousers',
        'outfit.blouse-pencil': 'Blouse & pencil skirt',
        'outfit.shirt-dress': 'Shirt dress',
        'outfit.trench-jeans': 'Trench & slim jeans',
        'outfit.cardigan-trousers': 'Cardigan & trousers',
        'outfit.pajamas': 'Pajamas',
        'outfit.nightgown': 'Satin nightgown',
        'outfit.yellow-sundress': 'Yellow sundress',
        'outfit.maxi-skirt': 'Tee & tiered maxi skirt',
        'outfit.a-line-dress': 'A-line dress',
        'outfit.linen-shorts': 'Blouse & linen shorts',
        'outfit.triangle-bikini': 'Triangle bikini',
        'outfit.bandeau-bikini': 'Bandeau bikini',
        'outfit.one-piece': 'One-piece swimsuit',
        'outfit.skirted-swimsuit': 'Skirted swimsuit',
        'outfit.lace-lingerie-set': 'Lace lingerie set',
        'outfit.balconette-set': 'Balconette bra & briefs',
        'outfit.plunge-thong': 'Plunge bra & thong',
        'outfit.bodysuit': 'Lace bodysuit',
        'outfit.guepiere': 'Guêpière',
        'outfit.visible-thong-jeans': 'Visible thong & low-rise jeans',
        'outfit.italian-lace-thong': 'Italian lace set · thong',
        'outfit.italian-lace-brazilian': 'Italian lace set · Brazilian',
        'outfit.stockings-mini-dress': 'Mini dress & stockings',
        'outfit.stockings-pencil': 'Pencil skirt & seamed stockings',
        'outfit.stockings-discreet': 'Knee-length skirt & stockings',
        'outfit.fishnets-mini': 'Mini skirt & fishnets',
        'outfit.sheer-blouse': 'Sheer blouse & mini',
    };

    // Filled below. Each language must cover every EN key; the test holds that.
    var EXTRA = {};

    function fill(extra) {
        var out = {};
        Object.keys(EN).forEach(function (key) {
            out[key] = extra && extra[key] ? extra[key] : EN[key];
        });
        return out;
    }

    var PACKS = { 'en-US': EN, 'en-GB': EN };

    function code() {
        try {
            var app = global && global.AppLanguage;
            var value = app && app.code;
            if (typeof value === 'function') value = value.call(app);
            if (value && PACKS[value]) return value;
            if (value && String(value).slice(0, 2).toLowerCase() === 'en') return 'en-US';
        } catch (_) {}
        return 'en-US';
    }

    function apply(text, vars) {
        if (!vars || text == null) return text == null ? '' : String(text);
        var out = String(text);
        Object.keys(vars).forEach(function (name) {
            out = out.split('{' + name + '}').join(vars[name] == null ? '' : String(vars[name]));
        });
        return out;
    }

    function t(key, vars, lang) {
        var pack = PACKS[lang || code()] || EN;
        var text = Object.prototype.hasOwnProperty.call(pack, key) ? pack[key] : EN[key];
        if (text == null || text === '') return '';
        return apply(text, vars);
    }

    function tx(key, fallback, vars) {
        var text = t(key, vars);
        if (text) return text;
        return apply(fallback == null ? '' : fallback, vars);
    }

    var api = {
        CODES: CODES,
        keys: function () {
            return Object.keys(EN);
        },
        code: code,
        t: t,
        tx: tx,
        _setExtra: function (lang, extra) {
            EXTRA[lang] = extra;
            PACKS[lang] = fill(extra);
        },
        // The overlay a language actually shipped, before English fills the gaps.
        // Tests use it to require a translation, not a silent fallback.
        overlay: function (lang) {
            return EXTRA[lang] || null;
        },
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_TRY_ON_LOCALE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
