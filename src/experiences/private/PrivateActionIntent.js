/**
 * PX1. What the person asked her to *do*, read from their own words, in every app language.
 *
 * Reported from an Italian Private session:
 *
 *     YOU    Che musica ti piace?
 *     NEXUS  Adoro synthwave e musica elettronica.
 *     YOU    Sì, suona Daft Punk ora.
 *     NEXUS  Dimmi di più.                      ← nothing played
 *
 * Two causes. The pattern matcher that turns "play some jazz" into playback (`YouTubeAsk`) knows
 * English verbs and wants a media noun, so "suona Daft Punk" was conversation to it. And inside
 * Private the model is deliberately not told it can play anything (the soundtrack is the
 * person's — see `TogetherCapability.systemPromptSuffix`), so it could not act either. A request
 * nobody recognises is answered with small talk.
 *
 * This module is the recognition half, and only that: a pure function from one message to at
 * most one action name with parameters. It grants nothing — `PrivateActionPolicy` decides
 * whether the action may run, and the bridge runs it.
 *
 * ## The rules it keeps
 *
 * - **A request starts the message.** After an optional "yes," and an optional "can you", the
 *   verb comes first. "We could play something later" and "I was playing guitar" are talk.
 * - **Talking about a thing is not asking for it.** "Che musica ti piace?" has no verb of
 *   asking and ends in a question mark; it returns null. So does "Cosa ti piacerebbe
 *   indossare?". A question becomes a request only with a "can you" in front of it.
 * - **A bare "stop" is never the music.** In Private that word ends the session
 *   (`PrivateTurnDirector`), and nothing here may stand in front of it. Stopping the music needs
 *   the word for music.
 * - **Ambiguous verbs need a noun.** `metti`, `put on`, `pon`, `mets` dress her *and* start a
 *   song. With a clothing word or a style it is the wardrobe; with a media word it is music;
 *   with neither it is nothing, and the model answers.
 * - **Never a guess at a query.** "Play music" has no query; the caller chooses something that
 *   fits the evening. Nothing here invents an artist.
 *
 * Exposes: window.NEXUS_PRIVATE_ACTION_INTENT
 */
(function (global) {
    'use strict';

    /** A word that is not inside a longer one, for scripts where `\b` is wrong about accents. */
    function word(alternatives) {
        return `(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`;
    }

    const MEDIA_NOUN =
        'music|songs?|tracks?|tunes?|album|playlist|soundtrack|musica|canzon[ei]|brano|brani|pezzo|música|canción|canciones|tema|musique|chansons?|morceau|musik|lied(?:er)?|canção|canções|faixa';
    const MEDIA = new RegExp(word(MEDIA_NOUN), 'iu');
    const MEDIA_CJK = /音楽|曲|歌|음악|노래|音乐|歌曲/u;

    const CLOTHING_NOUN =
        'outfits?|clothes|clothing|dress(?:es)?|sundress|minidress|nightgown|gown|skirt|shirt|blouse|jeans|trousers|lingerie|bikini|swimsuit|pyjamas|pajamas|nightdress|look|vestit[oi]|abit[oi]|gonna|maglia|camicia|completo|intimo|costume|pigiama|vestidos?|ropa|falda|camisa|conjunto|lencería|robe|tenue|jupe|chemise|vêtements|kleid(?:er)?|rock|hemd|kleidung|roupas?|saia|blusa';
    const CLOTHING = new RegExp(word(CLOTHING_NOUN), 'iu');
    const CLOTHING_CJK = /服|ドレス|옷|드레스|衣服|裙子/u;

    /** Style words, in the app's languages, to one canonical tag the decision engine reads. */
    const STYLES = [
        [
            'elegant',
            'elegant|classy|chic|fancy|elegante|eleganti|raffinat[oa]|chic|élégant[e]?|elegante|schick|edel|エレガント|上品|우아한|优雅',
        ],
        ['formal', 'formal|formale|formel(?:le)?|förmlich|フォーマル|정장|正式'],
        [
            'casual',
            'casual|relaxed|everyday|informale|casual|décontracté[e]?|lässig|locker|descontraíd[oa]|カジュアル|캐주얼|休闲',
        ],
        [
            'comfy',
            'comfy|comfortable|cozy|cosy|comod[oa]|cómod[oa]|confortable|bequem|gemütlich|confortável|楽な|편한|舒服',
        ],
        [
            'sexy',
            'sexy|hot|seductive|sensual|sensuale|provocante|seducente|sexi|atrevid[oa]|séduisant[e]?|verführerisch|sedutor[a]?|セクシー|섹시|性感',
        ],
        ['sporty', 'sporty|sportiv[oa]|deportiv[oa]|sporti(?:f|ve)|sportlich|esportiv[oa]|スポーティ|스포티|运动'],
        ['cute', 'cute|sweet|carin[oa]|dolce|lind[oa]|mignon(?:ne)?|süß|niedlich|fof[oa]|かわいい|귀여운|可爱'],
        ['summer', "summer|summery|estiv[oa]|veranieg[oa]|d’été|d'été|sommerlich|de verão|夏|여름|夏天"],
        ['night', 'nightwear|for bed|da notte|per la notte|de noche|de nuit|für die nacht|de noite'],
        ['party', 'party|da sera|da festa|de fiesta|de soirée|festlich|de festa|パーティー|파티|派对'],
    ].map(([tag, alt]) => [tag, new RegExp(word(alt), 'iu')]);

    const COLOURS = [
        ['red', 'red|ross[oa]|roj[oa]|rouge|rot(?:es|e|en)?|vermelh[oa]|赤|빨간|红'],
        ['black', 'black|ner[oa]|negr[oa]|noir[e]?|schwarz(?:es|e|en)?|pret[oa]|黒|검은|黑'],
        ['white', 'white|bianc[oa]|blanc[oa]|blanc(?:he)?|weiß(?:es|e|en)?|branc[oa]|白|흰|白色'],
        ['blue', 'blue|blu|azzurr[oa]|azul|bleu[e]?|blau(?:es|e|en)?|青|파란|蓝'],
        ['pink', 'pink|rosa|rose|ピンク|분홍|粉'],
        ['yellow', 'yellow|giall[oa]|amarill[oa]|jaune|gelb(?:es|e|en)?|amarel[oa]|黄色|노란|黄'],
        ['green', 'green|verde|vert[e]?|grün(?:es|e|en)?|緑|초록|绿'],
    ].map(([tag, alt]) => [tag, new RegExp(word(alt), 'iu')]);

    /** "yes," / "sì," / "ok" — and the politeness people put in front of a request. */
    const AFFIRM =
        "yes|yeah|yep|ok|okay|sure|alright|sì|si|certo|va bene|dai|ok|oui|d[’']accord|ja|klar|gern|sim|claro|vale|venga";
    const POLITE = "please|pls|per favore|per piacere|por favor|s[’']il te pla[iî]t|bitte|ti prego";
    const CAN_YOU =
        '(?:can|could|would|will) (?:you|u)|puoi|potresti|ti va di|mi|puedes|podrías|podrias|tu peux|peux-tu|pourrais-tu|kannst du|könntest du|você pode|pode|podes';
    /**
     * PX10. The small words people put before a request without thinking — "Grazie, suona…",
     * "Allora metti…", "Poi mettere una canzone" (a typed "Puoi"). Reported from a real session:
     * each of those reached the model as conversation, and she answered "Che genere preferisci?"
     * to somebody who had already asked for music three times. Up to three, in any order.
     */
    const FILLER =
        'grazie|thanks|thank you|thx|gracias|merci|danke|obrigad[oa]|poi|allora|adesso|ora|quindi|anche|e|and|then|so|now|also|y|entonces|ahora|et|alors|und|dann|jetzt|então|agora|bene|good|great|perfetto|perfect|perfecto|parfait';
    const LEAD = new RegExp(
        `^(?:(?:${FILLER}|${AFFIRM})[\\s,.!]+){0,3}(?:(?:${POLITE})[\\s,]+)?(?:(${CAN_YOU})\\s+)?(?:(?:${POLITE})[\\s,]+)?`,
        'iu'
    );

    /** Kinds of music: a request that names one is about music even without the word "music". */
    const GENRE = new RegExp(
        word(
            'jazz|rock|pop|lo-?fi|blues|soul|r&b|rnb|funk|disco|techno|house|edm|electronic|elettronica|electrónica|électronique|elektronisch|synthwave|ambient|chill|chillout|lounge|indie|hip hop|hip-hop|rap|reggae|reggaeton|latin[oa]?|salsa|bachata|bossa nova|metal|country|swing|classical|classica|clásica|classique|klassik|clássica|piano|acoustic|acustic[oa]|acústic[oa]|relaxing|rilassante|relajante|relaxante|entspannend|romantic|romantica|romántica|romantique|romantisch|romântica|lenta|slow songs?'
        ),
        'iu'
    );

    /** "I want to hear…", "vorrei ascoltare…": a request phrased as a wish. */
    const WANT = new RegExp(
        `^(?:i want to|i'd like to|i would like to|let me|voglio|vorrei|mi va di|quiero|quisiera|me gustaría|je veux|je voudrais|ich will|ich möchte|quero|queria|gostaria de)\\s+(?:hear|listen to|sentire|ascoltare|escuchar|oír|écouter|entendre|hören|ouvir|escutar)\\s+(.+)$`,
        'iu'
    );

    /** "Aspetto il brano", "where's the music?" — the request already made, not yet playing. */
    const WAITING = new RegExp(
        word(
            "aspetto|sto aspettando|ancora niente|dov[’']è|dove è|e la musica|allora la musica|waiting for|still waiting|where[’']?s the|where is the|and the music|nothing yet|espero|estoy esperando|dónde está|j[’']attends|où est|ich warte|wo ist|estou esperando|cadê|onde está"
        ),
        'iu'
    );

    /** Verbs that only ever mean playback. */
    const PLAY_SURE =
        'suona(?:mi|ci)?|suonare|riproduci|riprodurre|fammi (?:sentire|ascoltare)|facci (?:sentire|ascoltare)|reproduce|reproducir|reproduz(?:ir)?|spiel(?:e|en)?(?: mir| uns)?|joue(?:-moi|-nous|r)?|toque|tocar';
    /** Verbs that start a song *or* dress her; they need a noun to mean either. */
    const PLAY_AMBIGUOUS =
        'play|put on|metti(?:mi|ci)?(?: su)?|mettere|pon(?:me|nos)?|poner|mets(?:-moi|-nous)?|mettre|lance|coloca|colocar|põe|bota|toca';
    /** "suona bene" is a remark, not a request. */
    const NOT_A_QUERY =
        /^(?:bene|male|stran[oa]|bell[oa]|giust[oa]|familiare|interessante|meglio|come|good|great|nice|weird|familiar|like)(?:[\s,.!]|$)/iu;
    /** "play with me", "play along": the verb is not about music. */
    const NOT_MUSIC_PLAY =
        /^(?:with|along|a game|games?|nice|fair|dumb|coy|hard to get|it (?:cool|safe)|pretend|around|house)(?:[\s,.!]|$)/iu;

    const QUANTIFIER = new RegExp(
        `^(?:(?:me|us|mi|ci|nos|moi|mir|uns)\\s+)?(?:some|a bit of|a little|an?|the|un po[’']? di|un po di|qualche|della|dello|del|dei|degli|delle|gli|la|il|lo|le|i|una|uno|un|algo de|un poco de|los|las|el|quelque chose de|un peu de|du|de la|des|les|etwas|ein bisschen|ein paar|um pouco de|alguma coisa d[eo]|uma|um|os|as|o)\\s+`,
        'iu'
    );
    const SOMETHING_BY = new RegExp(
        `^(?:something|anything|qualcosa|algo|quelque chose|etwas|alguma coisa)\\s+(?:by|from|of|di|dei|degli|delle|della|dello|dell[’']|del|de los|de las|de la|de|von|d[aeo]s?)\\s*`,
        'iu'
    );
    const NOUN_BY = new RegExp(
        `^(?:${MEDIA_NOUN})\\s+(?:by|from|of|di|dei|degli|delle|della|dello|dell[’']|del|de los|de las|de la|de|von|d[aeo]s?)\\s*(.+)$`,
        'iu'
    );
    const TRAILING = new RegExp(
        `[\\s,]+(?:now|right now|please|for us|for me|ora|adesso|subito|per favore|per noi|per me|ahora|ya|por favor|para nosotros|maintenant|s[’']il te pla[iî]t|pour nous|jetzt|bitte|für uns|agora|para nós)[\\s.!]*$`,
        'iu'
    );
    const ONLY_NOUN = new RegExp(`^(?:${MEDIA_NOUN})$`, 'iu');
    const DIFFERENT = new RegExp(
        word(
            "something else|another (?:song|one|track)|a different (?:song|one|track)|next song|change (?:the )?(?:music|song)|un[’' ]?altra(?: canzone)?|qualcos[’' ]?altro|cambia (?:musica|canzone|brano)|otra(?: canción)?|cambia (?:de )?(?:música|canción)|autre chose|une autre(?: chanson)?|change (?:de )?(?:musique|chanson)|etwas anderes|ein anderes lied|outra(?: música)?|muda (?:a |de )?música"
        ),
        'iu'
    );

    const STOP_VERB =
        'stop|turn off|switch off|shut off|kill|cut|ferma|fermare|spegni|spegnere|togli|togliere|basta|para|parar|quita|apaga|arr[êe]te|coupe|[ée]teins|stopp(?:e)?|beende|desliga|tira';
    const STOP_PHRASE = new RegExp(
        word(
            'no music|no more music|niente musica|senza musica|sin música|pas de musique|plus de musique|keine musik|musik aus|sem música'
        ),
        'iu'
    );
    const PAUSE_VERB =
        'pause|pausa|metti in pausa|mettere in pausa|pon en pausa|pausar|mets en pause|pausiere|pausieren';
    const RESUME_VERB =
        'resume|unpause|riprendi|riprendere|rimetti|continua|reanuda|sigue|reprends|remets|weiter|mach weiter|retoma|continue|keep playing';
    const BARE_PAUSE =
        /^(?:pause(?: it| that)?|pausa|metti(?:la)? in pausa|pon(?:la)? en pausa|mets en pause|pausiere)[\s.!]*$/iu;
    const BARE_RESUME =
        /^(?:resume(?: it)?|unpause(?: it)?|play it again|riprendi(?:la)?|rimetti(?:la)?|reanuda(?:la)?|reprends)[\s.!]*$/iu;

    const DANCE = new RegExp(
        `^(?:${word(
            "let[’']?s dance|shall we dance|dance (?:with|for) me|dance|balliamo|balla(?: con me| per me| un po[’']?)?|vuoi ballare|ti va di ballare|bailemos|bailamos|baila(?: conmigo| para mí)?|dansons|on danse|danse(?: avec moi| pour moi)?|tanzen wir|lass uns tanzen|tanz(?:e)?(?: mit mir| für mich)?|vamos dançar|dança(?: comigo| para mim)?"
        )}|踊ろう|踊って|一緒に踊|춤추자|춤 ?춰|跳舞|跳支舞)`,
        'iu'
    );
    const NEGATED = /^(?:don[’']?t|do not|never|non|no|ne|nicht|não|nao|nunca)\s/iu;

    /** Verbs that are only about clothes. */
    const WEAR_SURE =
        'wear|change into|try on|dress (?:up )?in|slip into|get into|get dressed in|mettiti|mettersi|indossa|indossare|vestiti|cambiati|provati|infilati|ponte|vístete|vistete|pruébate|pruebate|enfile|porte|habille-toi|mets-toi|veste|vista|usa';
    const CHANGE_OUTFIT = new RegExp(
        word(
            "change (?:your )?(?:outfit|clothes|dress|look)|get changed|cambia(?:ti)?(?: (?:il |d[’'])?(?:vestito|abito|outfit|look))|cambiati|cámbiate(?: de ropa)?|cambiate(?: de ropa)?|cambia de (?:ropa|vestido)|change-toi|change de tenue|zieh dich um|troca de roupa|muda de roupa"
        ),
        'iu'
    );
    const CHANGE_OUTFIT_CJK = /着替えて|갈아입어|换衣服|换件衣服/u;
    const YOU_CHOOSE = new RegExp(
        word(
            'you choose|you pick|your choice|your pick|surprise me|you decide|scegli tu|decidi tu|a tua scelta|sorprendimi|elige tú|tú eliges|tu eliges|decide tú|sorpréndeme|choisis|à toi de choisir|surprends-moi|such du aus|du entscheidest|überrasch mich|escolhe você|você escolhe|me surpreende'
        ),
        'iu'
    );
    const YOU_CHOOSE_CJK = /あなたが選んで|任せる|おまかせ|네가 골라|你来选|你选|你决定/u;
    const UNDO_OUTFIT = new RegExp(
        word(
            "(?:go|change|switch) back(?: to (?:the )?(?:previous|other|last|first|old)(?: (?:one|outfit|dress|look))?)?|back to (?:the )?(?:previous|other|old|first|last) (?:outfit|dress|look|one)|undo(?: that| it)?|torna (?:al|all[’']|a quello)(?: (?:vestito|abito|outfit))?(?: di)? prima|rimetti(?:ti)? (?:quello|il vestito|l[’']abito) di prima|vuelve al (?:anterior|de antes)|ponte el de antes|remets (?:celui|la tenue|la robe) d[’']avant|zieh (?:wieder )?das (?:vorherige|alte) an|volta (?:ao|pro) (?:anterior|de antes)"
        ),
        'iu'
    );
    const UNDO_OUTFIT_CJK = /前の服に戻して|元に戻して|아까 옷으로|换回(?:原来的|之前的)/u;
    const BARE_UNDO = /^undo(?: that| it)?[\s.!]*$/iu;

    function clean(text) {
        return String(text == null ? '' : text)
            .normalize('NFC')
            .replace(/[‘’]/g, '’')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function stylesIn(text) {
        const found = [];
        for (const [tag, re] of STYLES) if (re.test(text)) found.push(tag);
        return found;
    }

    function coloursIn(text) {
        const found = [];
        for (const [tag, re] of COLOURS) if (re.test(text)) found.push(tag);
        return found;
    }

    /** What to search for, from what followed the verb. `''` means "you choose something". */
    function queryFrom(rest) {
        let q = clean(rest).replace(/[.!?…]+$/u, '');
        q = q.replace(TRAILING, '');
        for (let i = 0; i < 3; i += 1) q = q.replace(QUANTIFIER, '');
        q = q.replace(SOMETHING_BY, '');
        const by = NOUN_BY.exec(q);
        if (by) q = by[1];
        q = q.replace(TRAILING, '').trim();
        if (ONLY_NOUN.test(q)) return '';
        return q.slice(0, 120);
    }

    function action(name, params, family) {
        return { name, params: params || {}, family };
    }

    /** "yes" to something she offered, in the app's languages — a short message and nothing else. */
    const YES =
        /^(?:yes|yeah|yep|yup|ok|okay|sure|please do|do it|go ahead|go on|sì|si|certo|va bene|dai|fallo|volentieri|oui|d[’']accord|vas-y|ja|klar|gern|mach das|sim|claro|pode|vale|hazlo|venga|はい|うん|お願い|いいよ|네|응|좋아|好|好的|可以|行)(?:[\s,]+(?:please|per favore|por favor|bitte|grazie|thanks))?[\s.!]*$/iu;

    function affirms(text) {
        return YES.test(clean(text));
    }

    /** Words that ask for clothes without naming any: "something", "a dress", "something else". */
    const GENERIC_GARMENT = new RegExp(
        `^(?:(?:something|anything|qualcosa|qualcos[’']altro|algo|quelque chose|etwas|alguma coisa|else|altro|otra cosa|autre chose|anderes|different|divers[oa]|new|nuov[oa]|nuev[oa]|nouveau|neues|nov[oa]|nice|bell[oa]|di|de|d[’']|${CLOTHING_NOUN})\\s*)*$`,
        'iu'
    );
    const WEAR_LEAD = new RegExp(
        `^(?:${WEAR_SURE}|${PLAY_AMBIGUOUS})\\s+(?:(?:the|a|an|your|that|some|il|lo|la|i|gli|le|un|uno|una|quel|quella|el|los|las|ese|esa|tu|le|les|ce|cette|ta|ton|das|den|die|dein|deine|o|os|as|aquele|aquela)\\s+)*`,
        'iu'
    );

    /** The wardrobe request in a message already known to be about clothes. */
    function wardrobeFrom(text) {
        const styles = stylesIn(text);
        const colours = coloursIn(text);
        const params = {};
        if (styles.length) params.style = styles[0];
        if (colours.length) params.colour = colours[0];
        if (!styles.length && !colours.length) {
            // "Wear the lace set" names something; "wear something" leaves it to her.
            const named = text
                .replace(WEAR_LEAD, '')
                .replace(TRAILING, '')
                .replace(/[.!?…]+$/u, '')
                .trim();
            if (named && named !== text && !GENERIC_GARMENT.test(named)) params.look = named.slice(0, 60);
            else params.choose = true;
        }
        params.words = text.slice(0, 120);
        return action('wardrobe.wear', params, 'wardrobe');
    }

    /**
     * One message → at most one action, or null for conversation.
     *
     * @param {string} text  what the person said
     * @param {object} [context]
     * @param {string} [context.musicStatus]  `playing` | `paused` | … from the media controller
     * @param {boolean} [context.canUndoOutfit]  she is in a look the session put on
     * @param {string} [context.lastFamily]  `music` | `wardrobe` — what the last exchange was about
     */
    function parse(text, context) {
        const c = context || {};
        const said = clean(text);
        if (!said || said.length > 200) return null;

        const lead = LEAD.exec(said);
        const askedPolitely = Boolean(lead && lead[1]);
        const body = said.slice(lead ? lead[0].length : 0).trim();
        if (!body) return null;
        // Waiting for music asked for a moment ago is asking for it again — even as a question.
        if (
            WAITING.test(said) &&
            (MEDIA.test(said) || MEDIA_CJK.test(said) || c.lastFamily === 'music') &&
            !['playing', 'loading', 'searching'].includes(c.musicStatus)
        )
            return action('music.play', { query: '', again: true }, 'music');
        // A question is talk, unless it was put as "can you …?".
        const question = /[?？]\s*$/u.test(said);
        if (question && !askedPolitely) return null;
        if (NEGATED.test(body)) return null;
        const bare = body.replace(/[.!?？…]+$/u, '').trim();

        // ---- the music's transport, before anything could read it as a search
        if (BARE_PAUSE.test(body) && c.musicStatus === 'playing') return action('music.pause', {}, 'music');
        if (BARE_RESUME.test(body) && ['paused', 'blocked', 'unconfirmed'].includes(c.musicStatus))
            return action('music.resume', {}, 'music');
        const aboutMusic = MEDIA.test(body) || MEDIA_CJK.test(body) || GENRE.test(body);
        if (aboutMusic) {
            if (/音楽(?:を)?(?:止めて|消して)|음악\s*(?:꺼|멈춰)|(?:停止|关掉|关闭)音乐/u.test(body))
                return action('music.stop', {}, 'music');
            if (/一時停止|일시\s*정지|暂停/u.test(body)) return action('music.pause', {}, 'music');
            if (/再開|다시\s*(?:틀어|재생)|继续播放/u.test(body)) return action('music.resume', {}, 'music');
            if (new RegExp(`^${word(STOP_VERB)}`, 'iu').test(body) || STOP_PHRASE.test(body))
                return action('music.stop', {}, 'music');
            if (new RegExp(`^${word(PAUSE_VERB)}`, 'iu').test(body)) return action('music.pause', {}, 'music');
            if (new RegExp(`^${word(RESUME_VERB)}`, 'iu').test(body) && !DIFFERENT.test(body))
                return action('music.resume', {}, 'music');
        }

        // ---- her outfit
        const aboutClothes = CLOTHING.test(body) || CLOTHING_CJK.test(body);
        if (UNDO_OUTFIT.test(body) || UNDO_OUTFIT_CJK.test(body)) {
            if (!BARE_UNDO.test(body) || c.canUndoOutfit) return action('wardrobe.undo', {}, 'wardrobe');
        }
        if (CHANGE_OUTFIT.test(body) || CHANGE_OUTFIT_CJK.test(body)) {
            const wanted = wardrobeFrom(bare);
            wanted.params.different = true;
            return wanted;
        }
        const wearSure = new RegExp(`^${word(WEAR_SURE)}(?:\\s+|$)`, 'iu');
        if (wearSure.test(body) || /着て|입어|穿上|换上/u.test(body)) {
            // "usa", "porte", "veste" are ordinary words too: they need something to wear.
            if (
                aboutClothes ||
                stylesIn(body).length ||
                coloursIn(body).length ||
                /^(?:mettiti|indossa|vestiti|cambiati|ponte|wear|try on|change into)/iu.test(body)
            )
                return wardrobeFrom(bare);
        }

        // ---- "something more comfortable": a style and nothing else, while clothes are the subject
        if (c.lastFamily === 'wardrobe' && !aboutMusic && bare.split(' ').length <= 6) {
            if (stylesIn(body).length || coloursIn(body).length) return wardrobeFrom(bare);
        }

        // ---- "you choose": whichever of the two the conversation is about
        if (YOU_CHOOSE.test(body) || YOU_CHOOSE_CJK.test(body)) {
            if (aboutClothes || /indossare|mettere|wear|ponerte|porter|anziehen|vestir/iu.test(body))
                return action('wardrobe.wear', { choose: true, words: bare.slice(0, 120) }, 'wardrobe');
            if (aboutMusic) return action('music.play', { query: '' }, 'music');
            if (c.lastFamily === 'wardrobe')
                return action('wardrobe.wear', { choose: true, words: bare.slice(0, 120) }, 'wardrobe');
            if (c.lastFamily === 'music') return action('music.play', { query: '' }, 'music');
            return null;
        }

        // ---- "I want to hear some jazz"
        const wish = WANT.exec(body);
        if (wish && !question) return action('music.play', { query: queryFrom(wish[1]) }, 'music');

        // ---- music: a different one, then a verb of playing
        if (DIFFERENT.test(body) && (aboutMusic || c.lastFamily === 'music' || c.musicStatus === 'playing')) {
            if (!aboutClothes) return action('music.play', { query: '', different: true }, 'music');
        }
        const sure = new RegExp(`^${word(PLAY_SURE)}\\s+(.+)$`, 'iu').exec(body);
        if (sure && !NOT_A_QUERY.test(sure[1])) return action('music.play', { query: queryFrom(sure[1]) }, 'music');
        const ambiguous = new RegExp(`^(${word(PLAY_AMBIGUOUS)})\\s+(.+)$`, 'iu').exec(body);
        if (ambiguous) {
            const verb = ambiguous[1].toLowerCase();
            const rest = ambiguous[2];
            const styled = stylesIn(rest).length > 0;
            if (aboutClothes || (styled && !aboutMusic)) return wardrobeFrom(bare);
            if (verb === 'play') {
                if (!NOT_MUSIC_PLAY.test(rest)) return action('music.play', { query: queryFrom(rest) }, 'music');
            } else if (
                aboutMusic ||
                SOMETHING_BY.test(rest.replace(QUANTIFIER, '')) ||
                // PX10. "Ora metti i Coldplay": a name, not a garment. Clothes were ruled out above.
                /^\p{Lu}/u.test(rest.replace(QUANTIFIER, '').trim())
            ) {
                // "metti qualcosa di elegante" was caught above; what is left names an artist.
                if (
                    !/^(?:something|qualcosa|algo|quelque chose|etwas)\s+(?:di|de|von)\s+\p{Ll}/u.test(rest) ||
                    aboutMusic
                )
                    return action('music.play', { query: queryFrom(rest) }, 'music');
            }
        }
        const cjkPlay =
            /^(.*?)(?:を)?(?:流して|かけて|再生して)/u.exec(body) ||
            /^(.*?)\s*(?:틀어|재생해)/u.exec(body) ||
            /^(?:播放|放)(?:一?首|点|些)?(.*)$/u.exec(body);
        if (cjkPlay && (aboutMusic || cjkPlay[1].trim())) {
            const q = cjkPlay[1]
                .replace(MEDIA_CJK, '')
                .replace(/[のを的\s]+$/u, '')
                .trim();
            return action('music.play', { query: q.slice(0, 120) }, 'music');
        }

        // ---- dancing
        if (DANCE.test(body)) return action('avatar.dance', {}, 'avatar');

        return null;
    }

    /** What a message is *about*, when it asks for nothing: `music` | `wardrobe` | null. */
    function topic(text) {
        const said = clean(text);
        if (!said) return null;
        if (
            CLOTHING.test(said) ||
            CLOTHING_CJK.test(said) ||
            /indoss|wear|vestir|porter|anziehen|着|입|穿/iu.test(said)
        )
            return 'wardrobe';
        if (MEDIA.test(said) || MEDIA_CJK.test(said)) return 'music';
        return null;
    }

    const api = { parse, topic, affirms, queryFrom, stylesIn, coloursIn, STYLES, COLOURS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_ACTION_INTENT = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
