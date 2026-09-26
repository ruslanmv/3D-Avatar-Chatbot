/**
 * V1. VRoid Hub links in the Avatar Library's search box.
 *
 * People find a model on hub.vroid.com and paste its address into "Search avatars…". That
 * found nothing, for three reasons that each looked like the other two:
 *
 * - The search box treated the address as words. The catalogue filter looked for
 *   "https://hub.vroid.com/en/characters/…" inside names and tags, and the VRoid Hub keyword
 *   search sent the whole address to VRoid Hub as a keyword. Neither can match.
 * - The one path meant for a direct lookup — a bare numeric model id — asked the local proxy
 *   for `action=detail`, which only the Vercel function implemented, so `npm start` answered
 *   400. And where it did answer, the client read the model from `data`, but VRoid Hub nests
 *   it one level down, in `data.character_model`; the lookup returned null every time.
 * - It also required a VRoid Hub sign-in, though a model's details are public. Signing in is
 *   needed to *download*, not to look.
 *
 * This module is the pure half of the fix: find model ids in whatever was typed or pasted,
 * unwrap the detail response, and read a VRM 1.0 model's conditions of use from where
 * VRoid Hub actually keeps them. The Library does the fetching. A link search is a fallback
 * added on top of the ordinary search, never a replacement: it runs only when the text holds
 * a VRoid Hub model link or is nothing but model ids, and it only ever adds cards.
 *
 * Exposes: window.NEXUS_VROID_LINKS
 */
(function (global) {
    'use strict';

    /** VRoid Hub model ids are long numbers (18–19 digits today); ten keeps short numbers out. */
    var MIN_ID_DIGITS = 10;
    /** A paste of the whole list is fine; a paste of a page's worth of links is not a search. */
    var MAX_IDS = 20;

    // hub.vroid.com/[locale/]characters/{character}/models/{model}, or …/models/{model} alone.
    // Digits stop at the first non-digit, so links pasted with no space between them (an
    // <input> drops the newlines of a multi-line paste) still split correctly.
    var LINK = /hub\.vroid\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:characters\/\d+\/)?models\/(\d{10,25})/gi;
    var BARE = /^\d{10,25}$/;

    /**
     * The VRoid Hub model ids in ``text``, in the order given, without repeats.
     *
     * Links are found anywhere, so a pasted list with names and notes between the links works.
     * Bare numbers count only when the whole text is numbers — "girl 1234567890" is a keyword
     * search, not a lookup.
     */
    function parseModelIds(text) {
        var source = String(text || '');
        var ids = [];
        var seen = {};
        function add(id) {
            if (!seen[id] && ids.length < MAX_IDS) {
                seen[id] = true;
                ids.push(id);
            }
        }
        var match;
        LINK.lastIndex = 0;
        while ((match = LINK.exec(source))) add(match[1]);
        if (ids.length) return ids;
        var tokens = source.split(/[\s,;]+/).filter(Boolean);
        if (
            tokens.length &&
            tokens.every(function (token) {
                return BARE.test(token) && token.length >= MIN_ID_DIGITS;
            })
        ) {
            tokens.forEach(add);
        }
        return ids;
    }

    /** True when ``text`` should be answered by looking models up, not by matching words. */
    function isLinkQuery(text) {
        return parseModelIds(text).length > 0;
    }

    /**
     * The character model from a `GET /api/character_models/{id}` answer, or null.
     *
     * VRoid Hub answers `{data: {character_model: {…}, description, …}}`; search results are
     * the model itself. Accept either, so a proxy that already unwrapped it still works.
     */
    function unwrapDetail(payload) {
        if (!payload || typeof payload !== 'object') return null;
        var data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
        var model = data.character_model || data;
        return model && model.id ? model : null;
    }

    /**
     * A VRM 1.0 model's conditions of use, in the Library's vocabulary, or null for VRM 0.0.
     *
     * VRM 0.0 models carry them in `license` (corporate_commercial_use, redistribution, …).
     * VRM 1.0 models leave those fields null and keep the terms in the VRM meta VRoid Hub
     * reports as `latest_character_model_version.vrm_meta` — so a VRM 1.0 model's card said
     * "Not set" for every condition, including models whose creators allow everything.
     * Mapped to the same values the Library's filters and panel already use.
     */
    function conditionsFromVrmMeta(model) {
        var version = (model && (model.latest_character_model_version || model.character_model_version)) || {};
        var meta = version.vrm_meta || {};
        meta = meta.vrm10 || meta;
        if (!('allowRedistribution' in meta) && !('commercialUsage' in meta) && !('modification' in meta)) {
            return null;
        }
        function yesNo(value) {
            return value === true ? 'allow' : value === false ? 'disallow' : 'default';
        }
        var commercial = meta.commercialUsage;
        return {
            avatarUse:
                meta.avatarPermission === 'everyone'
                    ? 'everyone'
                    : meta.avatarPermission === 'onlyAuthor' || meta.avatarPermission === 'onlySeparatelyLicensedPerson'
                      ? 'author'
                      : 'default',
            violentExpression: yesNo(meta.allowExcessivelyViolentUsage),
            sexualExpression: yesNo(meta.allowExcessivelySexualUsage),
            corporateCommercialUse: commercial === 'corporation' ? 'allow' : commercial ? 'disallow' : 'default',
            personalCommercialUse:
                commercial === 'corporation' || commercial === 'personalProfit'
                    ? 'profit'
                    : commercial === 'personalNonProfit'
                      ? 'nonprofit'
                      : 'default',
            redistribution: yesNo(meta.allowRedistribution),
            modification:
                meta.modification === 'allowModification' || meta.modification === 'allowModificationRedistribution'
                    ? 'allow'
                    : meta.modification === 'prohibited'
                      ? 'disallow'
                      : 'default',
            credit:
                meta.creditNotation === 'required'
                    ? 'necessary'
                    : meta.creditNotation === 'unnecessary'
                      ? 'unnecessary'
                      : 'default',
        };
    }

    /** The public model page for a model id and, when known, its character id. */
    function pageUrl(modelId, characterId) {
        return 'https://hub.vroid.com/en/characters/' + (characterId || modelId) + '/models/' + modelId;
    }

    var api = {
        MAX_IDS: MAX_IDS,
        parseModelIds: parseModelIds,
        isLinkQuery: isLinkQuery,
        unwrapDetail: unwrapDetail,
        conditionsFromVrmMeta: conditionsFromVrmMeta,
        pageUrl: pageUrl,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_VROID_LINKS = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
