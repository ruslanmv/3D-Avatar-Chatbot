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

    /**
     * PX15. Garments people name, in English, Italian and Spanish (the three this app is used in
     * most), each to one English canonical name — the vocabulary her saved looks and Forge's
     * dictionary are written in. So "il reggiseno nero", "el sujetador negro" and "the black bra"
     * are one request, and the decision engine can find a look called "Black Lace Bra" for any of
     * them. `cat` decides what kind of outfit it is: `lingerie` makes the request a private one,
     * so only the existing gate (private mode on, the avatar declared adult by Forge's operator)
     * can make it wearable.
     *
     * Written as plain alternatives, longest first inside each entry, and matched as whole words.
     * Adding a word is a one-line change here; nothing else needs to know.
     */
    const GARMENTS = [
        // lingerie and underwear
        [
            'lingerie set',
            'lingerie',
            'lingerie set|lingerie|underwear set|completo intimo|completino intimo|biancheria intima|intimo|conjunto de lencería|lencería|ropa interior',
        ],
        ['bra', 'lingerie', 'push-up bra|bralette|brassiere|bra|reggiseno|reggiseni|sujetador|sostén|brasier'],
        [
            'panties',
            'lingerie',
            'g-string|thong|knickers|panties|briefs|mutandine|mutande|slip|tanga|perizoma|bragas|braguitas|culotte|culotes',
        ],
        ['corset', 'lingerie', 'corset|bustier|basque|corsetto|bustino|corsé|corpiño'],
        ['bodysuit', 'lingerie', 'lace bodysuit|bodysuit|teddy|body di pizzo|body de encaje|body'],
        ['babydoll', 'lingerie', 'baby doll|baby-doll|babydoll'],
        ['garter belt', 'lingerie', 'suspender belt|garter belt|garters|reggicalze|liguero|ligas'],
        ['negligee', 'lingerie', 'negligee|négligé|chemise|sottoveste|combinación|picardías|salto de cama'],
        // hosiery
        ['fishnets', 'hosiery', 'fishnet stockings|fishnets|calze a rete|medias de red|medias de rejilla'],
        [
            'stockings',
            'hosiery',
            'thigh-highs|hold-ups|stockings|calze autoreggenti|autoreggenti|calze|medias de liga|medias',
        ],
        ['tights', 'hosiery', 'pantyhose|tights|collant|collants|pantis|panties de nylon'],
        // night and swim
        ['nightdress', 'night', 'nightdress|nightgown|camicia da notte|camisón'],
        ['robe', 'night', 'dressing gown|bathrobe|robe|kimono|vestaglia|accappatoio|bata|albornoz'],
        ['pyjamas', 'night', 'pyjamas|pajamas|pigiama|pijama'],
        ['bikini', 'swim', 'bikini'],
        [
            'swimsuit',
            'swim',
            'one-piece swimsuit|swimsuit|bathing suit|costume da bagno|costume intero|bañador|traje de baño',
        ],
        // dresses
        ['slip dress', 'dress', 'slip dress|abito sottoveste|vestito sottoveste|vestido lencero'],
        [
            'evening gown',
            'dress',
            'evening gown|ball gown|gown|abito da sera|vestito da sera|vestido de noche|vestido de gala',
        ],
        [
            'cocktail dress',
            'dress',
            'cocktail dress|little black dress|abito da cocktail|tubino nero|tubino|vestido de cóctel',
        ],
        [
            'bodycon dress',
            'dress',
            'bodycon dress|bodycon|abito aderente|vestito aderente|vestido ajustado|vestido ceñido',
        ],
        ['mini dress', 'dress', 'mini dress|minidress|minivestito|vestitino|vestido corto|minivestido'],
        ['sundress', 'dress', 'sundress|abito estivo|vestito estivo|prendisole|vestido de verano'],
        ['dress', 'dress', 'dress|vestito|abito|vestido'],
        // tops
        ['crop top', 'top', 'crop top|top corto|top cropped|top'],
        ['tank top', 'top', 'tank top|camisole|cami|canotta|canottiera|camiseta de tirantes|camisola'],
        ['blouse', 'top', 'sheer blouse|blouse|camicetta|blusa'],
        ['shirt', 'top', 'shirt|camicia|camisa'],
        ['tee', 'top', 't-shirt|tshirt|tee|maglietta|camiseta'],
        ['sweater', 'top', 'sweater|jumper|cardigan|maglione|golfino|jersey|suéter|chaqueta de punto'],
        ['hoodie', 'top', 'hoodie|sweatshirt|felpa|sudadera'],
        // bottoms
        ['miniskirt', 'bottom', 'miniskirt|mini skirt|minigonna|minifalda'],
        ['pencil skirt', 'bottom', 'pencil skirt|gonna a tubino|falda lápiz|falda de tubo'],
        ['skirt', 'bottom', 'skirt|gonna|gonnellina|falda'],
        ['jeans', 'bottom', 'jeans|denim|vaqueros|tejanos'],
        ['shorts', 'bottom', 'hot pants|shorts|pantaloncini|calzoncini|pantalones cortos|short'],
        ['leggings', 'bottom', 'leggings|leggins|mallas'],
        ['trousers', 'bottom', 'trousers|pants|pantaloni|pantalones'],
        // shoes and outerwear
        [
            'heels',
            'shoes',
            'high heels|stilettos|heels|pumps|tacchi a spillo|tacchi|décolleté|tacones|zapatos de tacón',
        ],
        ['boots', 'shoes', 'thigh-high boots|ankle boots|boots|stivali|stivaletti|botas|botines'],
        ['jacket', 'outer', 'leather jacket|jacket|blazer|giacca|giubbotto|chaqueta|americana'],
        ['coat', 'outer', 'trench coat|coat|cappotto|abrigo|gabardina'],
    ].map(([name, cat, alt]) => ({ name, cat, re: new RegExp(word(alt), 'iu'), words: alt.split('|') }));

    /** The garments named in a message, in the order of the table (more specific first). */
    function garmentsIn(text) {
        const found = [];
        for (const g of GARMENTS) if (g.re.test(text)) found.push(g);
        return found;
    }

    const MEDIA_NOUN =
        'music|songs?|tracks?|tunes?|album|playlist|soundtrack|musica|canzon[ei]|brano|brani|pezzo|música|canción|canciones|tema|musique|chansons?|morceau|musik|lied(?:er)?|canção|canções|faixa';
    const MEDIA = new RegExp(word(MEDIA_NOUN), 'iu');
    const MEDIA_CJK = /音楽|曲|歌|음악|노래|音乐|歌曲/u;

    const CLOTHING_NOUN =
        'outfits?|clothes|clothing|underwear|bra|panties|stockings|heels|mutand(?:e|ine)|reggiseno|reggiseni|calze|collant|tacchi|biancheria|dress(?:es)?|sundress|minidress|nightgown|gown|skirt|shirt|blouse|jeans|trousers|lingerie|bikini|swimsuit|pyjamas|pajamas|nightdress|look|vestit[oi]|abit[oi]|gonna|maglia|camicia|completo|intimo|costume|pigiama|vestidos?|ropa|falda|camisa|conjunto|lencería|robe|tenue|jupe|chemise|vêtements|kleid(?:er)?|rock|hemd|kleidung|roupas?|saia|blusa';
    const CLOTHING = {
        // PX15. The garment table counts as clothing too, in all three of its languages.
        test: (text) => new RegExp(word(CLOTHING_NOUN), 'iu').test(text) || garmentsIn(text).length > 0,
    };
    const CLOTHING_CJK = /服|ドレス|옷|드레스|衣服|裙子/u;

    /** Style words, in the app's languages, to one canonical tag the decision engine reads. */
    const STYLES = [
        // PX14. First: "solo mutande e reggiseno" names underwear, and underwear is a kind of
        // outfit here (private-rated, so only where the existing gate opens it), not "sexy".
        [
            'lingerie',
            'lingerie|intimo|biancheria(?: intima)?|mutand(?:e|ine)|reggiseno|reggiseni|tanga|perizoma|underwear|bra|panties|knickers|ropa interior|lencería|bragas|sujetador|sous-vêtements|soutien-gorge|culotte|unterwäsche|dessous|bh|slip|calcinha|sutiã|roupa íntima|下着|ランジェリー|속옷|란제리|内衣|文胸',
        ],
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
        'wear|change into|try on|dress (?:up )?in|slip into|get into|get dressed in|mettiti|mettersi|indos+a+(?:re)?|indossi|vestiti|cambiati|provati|infilati|ponte|vístete|vistete|pruébate|pruebate|enfile|porte|habille-toi|mets-toi|veste|vista|usa';
    /**
     * PX14. "Togliti il vestito", "spogliati": in this app that is a change into underwear, made by
     * the same wardrobe as any other outfit and behind the same private-outfit gate — never a
     * removal the avatar cannot show. UN1: it is `wardrobe.undress`, one layer at a time, open
     * only at the top of the evening's pace. Without this the request reached the model as talk and she
     * described undressing while the avatar stayed exactly as she was.
     */
    const UNDRESS = new RegExp(
        `^(?:${word(
            // UN18. The reported session: "Togliete vestiti" (plural imperative, no article) moved
            // nothing and she said "li tolgo". Clothes named, so "togli la musica" stays music.
            'togliete(?:vi)? (?:(?:i |tutti i )?(?:vestiti|abiti))|toglietevi|togli (?:i |tutti i )?(?:vestiti|abiti)|spogliatevi|svestitevi|levatevi (?:i )?(?:vestiti|abiti)|' +
                'togliti|toglierti|levati|spogliati|svestiti|take off|take (?:\\S+ ){0,3}?\\S+ off|undress|get undressed|quítate|quitate|desnúdate|desvístete|enlève|déshabille-toi|zieh(?:e)? dich aus|zieh .{1,20} aus|tira (?:a|o|sua)|despe-te'
        )})`,
        'iu'
    );

    /**
     * UN20. The reported Italian session: "poi togliete i vestiti" took a layer off, then "Toglili
     * tutti" ("take them all off") parsed as nothing. No action ran, so nothing told her why, and
     * the reply check put "Per ora resto come sono." in place of whatever she said: a flat
     * non-answer to a clear request, at the level the person had chosen. An object pronoun on the
     * verb ("toglili", "levateli", "quítatelos", "enlève-les", "tira-os") points back at what was
     * being talked about, so it counts as undressing unless that was the music ("toglila" then
     * means switch it off, which the music path reads).
     */
    const UNDRESS_PRONOUN = new RegExp(
        `^(?:${word(
            'togli(?:te)?(?:li|le|lo|la)|toglietel[ieoa]|toglitel[ieoa]|toglietevel[ieoa]|leva(?:te)?(?:li|le|lo|la)|levatel[ieoa]|' +
                'quít(?:a|ate)l[oa]s?|quit(?:a|ate)l[oa]s?|enl[èe]ve-(?:les|le|la)|retire-(?:les|le|la)|tira-(?:os|as|o|a)|zieh (?:sie|es|die) aus'
        )})`,
        'iu'
    );

    /** UN1. "All of it": straight to the last layer she has, not one at a time. */
    const UNDRESS_ALL = new RegExp(
        `${word(
            // UN20. "Toglili tutti": the plural "all" counts as much as "everything".
            'everything|all of it|all of them|them all|completely|all the way|tutto|tutta|tutti|tutte|completamente|del tutto|todo|toda|todos|todas|completamente|tout|tous|toutes|complètement|entièrement|alles|ganz|komplett|tudo|toda'
        )}|全部|すべて|全部脱|다 벗|모두|全部脱|都脱`,
        'iu'
    );

    /**
     * UN7. Asked to be seen naked, in words that are not a verb of undressing: "I wanna see you
     * naked", "get naked", "strip for me", "voglio vederti nuda", "senza vestiti". Reported: at
     * level 4 "Please, I wanna see you naked" parsed as nothing, no wardrobe action ran, and her
     * reply said she was undressing while the avatar stayed dressed. These are the "everything
     * off" step; `nude` counts only with a person ("you nude", "get nude") because it is a colour
     * too ("the nude heels").
     */
    const NAKED = new RegExp(
        [
            '\\bnaked\\b|\\b(?:get|be|go|stay|see you|you)\\s+(?:completely\\s+|totally\\s+|fully\\s+)?nude\\b|^strip(?:\\s+(?:for me|down|naked|off|now|please))*[\\s.!,]*$|\\bstrip (?:for me|down|naked|off)\\b',
            '\\bnud[ao]\\b|\\bnude\\b(?=.*\\b(?:ti|te|vederti|mostrati)\\b)|\\bsenza (?:vestiti|niente addosso|nulla addosso)\\b|\\bspogliata del tutto\\b',
            '\\bdesnud[ao]\\b|\\bsin (?:ropa|nada puesto)\\b|\\bencuérate\\b',
            '\\b(?:toute )?nue\\b|\\bsans (?:vêtements|rien sur (?:toi|vous))\\b',
            '\\bnackt\\b|\\bohne (?:kleider|kleidung)\\b',
            '\\bnua\\b|\\bpelad[ao]\\b|\\bsem roupa\\b',
            '裸|알몸|벗은 몸|光着|裸体',
        ].join('|'),
        'iu'
    );
    /** "Are you naked?" asks about her state; it is not a request. */
    const ASKS_STATE = /^(?:are you|you are|sei|tu sei|estás|tu es|es-tu|bist du|du bist|você está|voce esta)\b/iu;

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

    /**
     * UN34. Finishing: the person says they are coming, and where. It is their climax, so their words
     * are the only way in: the policy refuses her tag, and the pace must be at its top. What
     * happens is on her skin (the look's skin pack): where they came is shown on her, live, and the
     * conversation is told the same, so what she says matches what is seen.
     *
     * A climax word is needed, never "come" alone ("come here" is not one). The place is optional:
     * without it the bridge chooses from what the look can show and the position she holds.
     */
    const FINISH_VERB = new RegExp(
        word(
            "i[’']?m cumming|i am cumming|cumming|cum|i[’']?m coming|i am coming|gonna come|going to come|about to come|let me finish|i[’']?m finishing|vengo|sto venendo|sto per venire|venirti|ti vengo|me corro|me vengo|correrme|voy a acabar|acabo|je jouis|je vais jouir|jouir|ich komme|ich spritze|abspritzen|vou gozar|estou gozando|gozar|gozo"
        ),
        'iu'
    );
    const FINISH_PLACES = [
        // UR1. Her face and her mouth (Unrestrained only; the policy decides).
        [
            'face',
            'on your face|in your face|on her face|in faccia|sulla faccia|sul viso|sul tuo viso|en tu cara|en la cara|sur ton visage|sur ta figure|sur ton visage|ins gesicht|in dein gesicht|auf dein gesicht|na tua cara|na cara|no teu rosto|no seu rosto',
        ],
        [
            'mouth',
            'in your mouth|down your throat|in bocca|nella tua bocca|in gola|en tu boca|en la boca|dans ta bouche|dans la bouche|in deinen mund|in den mund|na tua boca|na boca|na sua boca',
        ],
        ['all', 'all over|everywhere|ovunque|dappertutto|addosso|por todas partes|partout|überall|toda (?:você|voce)'],
        ['both', 'both holes|in both|entrambi i buchi|in entrambi|ambos agujeros|les deux trous|beide löcher|nos dois'],
        ['ass', 'ass|asshole|butt|culo|culetto|nel sedere|cul|arsch|bunda|cu'],
        ['back', 'back|lower back|schiena|sulla schiena|espalda|dos|rücken|costas'],
        // UN37. Facing them: her belly and her breasts.
        ['belly', 'belly|tummy|stomach|pancia|pancino|ventre|vientre|barriga|bauch'],
        ['chest', 'chest|tits|boobs|breasts|seno|tette|pecho|tetas|seins|poitrine|nichons|brüste|titten|peitos|mamas'],
        [
            'inside',
            'inside|in you|in your pussy|in her|dentro|dentro di te|en ti|adentro|en toi|dedans|in dir|rein|dentro de (?:você|voce)',
        ],
    ];

    /**
     * UN36. Routines: a show she moves through on her own (PrivateRoutines). By name, or "show me"
     * for the boldest the evening allows; while one runs, "slower" / "faster" / "stop the show";
     * after one, "again" / "more" plays it again. Position words are read first (so "straddle me"
     * stays a position): these are only the show's own phrases. Japanese, Korean and Chinese are
     * the ⋯ menu's lines, matched as substrings.
     */
    const ROUTINE_NAMES = [
        [
            'tease',
            'tease me|stuzzicami|provocami|provócame|provocame|allume-moi|reiz mich|provoca-me|じらして|애태워줘|挑逗我',
        ],
        ['ride', 'ride me|cavalcami|cabálgame|cabalgame|chevauche-moi|reite mich|cavalga-me|乗って|기승위로 해줘|骑我'],
        [
            'open-for-you',
            'open (?:up |yourself )?for me|apriti per me|ábrete para mí|abrete para mi|ouvre-toi pour moi|öffne dich für mich|abre-te para mim|私のために開いて|나를 위해 벌려줘|为我张开',
        ],
        [
            'from-behind',
            'offer yourself (?:to me )?from behind|present yourself(?: to me)?|offriti (?:a me )?da dietro|ofrécete por detrás|ofrecete por detras|offre-toi par derrière|biete dich von hinten an|oferece-te por trás|後ろから誘って|뒤에서 나를 유혹해줘|从后面诱惑我',
        ],
        // VA3. The danced shows.
        [
            'striptease',
            'striptease|strip tease|do a striptease for me|spogliarello|fammi uno spogliarello|haz(?:me)? un striptease|fais-moi un strip-?tease|strip-?tease|mach (?:mir )?einen striptease|faz(?:-me)? um striptease(?: para mim)?|ストリップして|스트립쇼 해줘|跳脱衣舞',
        ],
        [
            'table-dance',
            'table dance|lap dance|give me a (?:table|lap) dance|dance on the table for me|ballo sul tavolo|fammi un ballo sul tavolo|baile en la mesa|hazme un baile en la mesa|danse sur la table|fais-moi une danse sur la table|tischtanz|mach mir einen tischtanz|dança na mesa|faz uma dança na mesa(?: para mim)?|テーブルダンス|테이블 댄스|桌上舞',
        ],
        // UR1. The Unrestrained shows (each also needs Unrestrained on: the bridge and the policy).
        // L5. Valentina's and Chiara's shows, by name in nine languages.
        [
            'full-service',
            '(?:give me )?the full service|full service|(?:fammi )?il servizio completo|servizio completo|(?:hazme )?el servicio completo|servicio completo|(?:fais-moi )?le service complet|service complet|(?:gib mir )?das volle programm|volles programm|(?:faz-me )?o serviço completo|serviço completo|フルサービスして|フルサービス|풀서비스 해줘|풀서비스|全套服务',
        ],
        [
            'like-last-time',
            '(?:just )?like last time|come l.ultima volta|come la volta scorsa|como la última vez|como la ultima vez|comme la dernière fois|wie letztes mal|wie beim letzten mal|como da última vez|como da ultima vez|前みたいにして|前みたいに|지난번처럼 해줘|지난번처럼|像上次一样',
        ],
        // BD31. The fist-then-inside stories, by their exact names (matched first: see STORY_SHOWS).
        [
            'fist-then-inside',
            'first the fist,? then inside|prima il pugno,? poi dentro|primero el puño,? luego dentro|primero el puno,? luego dentro|d.abord le poing,? (?:et )?puis dedans|erst die faust,? dann rein|primeiro o punho,? depois dentro|先に拳、それから中に|먼저 주먹, 그다음 안에|先拳交再内射',
        ],
        [
            'fist-then-ass',
            'the fist,? then the ass|prima il pugno,? poi il culo|primero el puño,? luego el culo|primero el puno,? luego el culo|d.abord le poing,? (?:et )?puis le cul|erst die faust,? dann der arsch|primeiro o punho,? depois o cu|先に拳、それからお尻に|먼저 주먹, 그다음 엉덩이에|先拳交再射屁股',
        ],
        [
            'worse-than-last-time',
            'worse than last time|peggio dell.ultima volta|peor que la última vez|peor que la ultima vez|pire que la dernière fois|schlimmer als letztes mal|pior do que da última vez|pior do que da ultima vez|前よりもっとひどく|지난번보다 더 심하게|比上次更狠',
        ],
        [
            'used-marked',
            'used and marked|use me and mark me|usami e segnami|usata e segnata|úsame y márcame|usada y marcada|utilise-moi et marque-moi|utilisée et marquée|benutz mich und markier mich|benutzt und markiert|usa-me e marca-me|usada e marcada|使って印をつけて|써 주고 흔적을 남겨|用我并留下痕迹',
        ],
        [
            'edging',
            'edge me|edging|keep me on the edge|tienimi al limite|portami al limite|mantenme al borde|llévame al borde|garde-moi au bord|halte mich an der grenze|deixa-me no limite|mantém-me no limite|寸止めして|애태워 줘|让我一直在边缘',
        ],
        [
            'dom-sub',
            'who leads tonight|dominate me|chi comanda stasera|dominami|quién manda esta noche|domíname|dominame|qui commande ce soir|domine-moi|wer führt heute|dominier mich|quem manda hoje|domina-me|今夜はどっちが支配する|오늘 밤은 누가 리드해|今晚谁主导',
        ],
        [
            'oil-everything',
            'oil then everything|oil massage|oil me up|olio e poi tutto|massaggio con l.olio|aceite y luego todo|masaje con aceite|huile puis tout|massage à l.huile|öl und dann alles|ölmassage|óleo e depois tudo|massagem com óleo|オイルからすべて|오일 마사지부터 전부|先油按摩再全部',
        ],
        [
            'tied',
            'tie me up|tied for you|legami|legata per te|átame|atame|atada para ti|attache-moi|attachée pour toi|fessel mich|gefesselt für dich|amarra-me|amarrada para ti|縛って|묶어 줘|把我绑起来',
        ],
        [
            'rounds',
            'round two|round three|secondo round|terzo round|segunda ronda|tercera ronda|deuxième round|troisième round|zweite runde|dritte runde|segunda rodada|terceira rodada|二回戦|두 번째 라운드|再来一轮',
        ],
        [
            'window-show',
            'window show|show at the window|spettacolo alla finestra|show alla finestra|show en la ventana|espectáculo en la ventana|show à la fenêtre|spectacle à la fenêtre|show am fenster|show na janela|窓辺のショー|창가 쇼|窗边表演',
        ],
        // WR1. The Window Room's whole evening.
        [
            'window-evening',
            'the full evening|give me the full evening|la serata completa|dammi la serata completa|la noche completa|dame la noche completa|la soirée complète|donne-moi la soirée complète|den ganzen abend|gib mir den ganzen abend|a noite completa|dá-me a noite completa|da-me a noite completa|フルコースでして|풀코스로 해 줘|给我整晚全套',
        ],
        [
            'everything',
            'show me everything|fammi vedere tutto|enséñamelo todo|ensenamelo todo|montre-moi tout|zeig mir alles|mostra-me tudo|全部見せて|다 보여줘|全部给我看',
        ],
    ];
    const ROUTINE_ANY = new RegExp(
        word(
            'show me|(?:do|put on|give me) (?:a |me a )?(?:little )?show|fammi (?:uno|un) spettacolo|hazme un (?:show|espectáculo|espectaculo)|fais-moi un (?:show|spectacle)|mach mir eine show|faz(?:-me)? um show(?: para mim)?'
        ),
        'iu'
    );
    const ROUTINE_STOP = new RegExp(
        word(
            'stop the show|enough of the show|ferma lo spettacolo|basta spettacolo|para el (?:show|espectáculo)|arrête le (?:show|spectacle)|hör auf mit der show|para o show'
        ),
        'iu'
    );
    const ROUTINE_SLOWER = new RegExp(
        word(
            'slower|slow down|more slowly|più piano|più lentamente|rallenta|más despacio|mas despacio|más lento|plus lentement|langsamer|mais devagar'
        ),
        'iu'
    );
    const ROUTINE_FASTER = new RegExp(
        word(
            'faster|speed up|più veloce|più in fretta|más rápido|mas rapido|plus vite|schneller|mais rápido|mais rapido'
        ),
        'iu'
    );
    const ROUTINE_AGAIN = new RegExp(
        word(
            'again|more|once more|one more time|ancora|di nuovo|otra vez|más|encore|nochmal|noch mal|mehr|de novo|mais'
        ),
        'iu'
    );
    const ROUTINE_SLOWER_CJK = /ゆっくり|천천히|慢一点|慢点/u;
    const ROUTINE_FASTER_CJK = /速く|もっと早く|빨리|快一点|快点/u;
    const ROUTINE_AGAIN_CJK = /もう一回|もっと|한 번 더|더 해줘|再来|还要/u;

    const CJK_TEXT = /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/u;

    function routineFrom(body, context) {
        const c = context || {};
        for (const [id, words] of ROUTINE_NAMES) {
            const all = words.split('|');
            const latin = all.filter((w) => !CJK_TEXT.test(w));
            const asian = all.filter((w) => CJK_TEXT.test(w));
            if (new RegExp(word(latin.join('|')), 'iu').test(body) || asian.some((w) => body.includes(w)))
                return action('avatar.routine', { routine: id, move: 'start' }, 'avatar');
        }
        if (ROUTINE_ANY.test(body)) return action('avatar.routine', { routine: 'choose', move: 'start' }, 'avatar');
        if (c.routine === 'running') {
            if (ROUTINE_STOP.test(body)) return action('avatar.routine', { move: 'stop' }, 'avatar');
            if (ROUTINE_SLOWER.test(body) || ROUTINE_SLOWER_CJK.test(body))
                return action('avatar.routine', { move: 'slower' }, 'avatar');
            if (ROUTINE_FASTER.test(body) || ROUTINE_FASTER_CJK.test(body))
                return action('avatar.routine', { move: 'faster' }, 'avatar');
        }
        // "Ancora!" after a show is asking for it again — only then, and only a short line.
        if (c.routine === 'done' && body.length <= 40 && (ROUTINE_AGAIN.test(body) || ROUTINE_AGAIN_CJK.test(body)))
            return action('avatar.routine', { move: 'again' }, 'avatar');
        return null;
    }

    /**
     * LM7. Motion as a response: while she holds a position she is still, and moves only when the
     * person asks — "move for me", "rock your hips", "keep going", "slower", "faster", "stop", in the
     * app's nine languages. Read only while a position is held, after positions and shows (so "ride
     * me" stays the show and "straddle me" the position).
     *
     * Two tiers, because several of these are everyday words: verbs that only mean moving her body
     * count anywhere in the message; the ambiguous ones ("keep going", "continua", "sigue",
     * "para" — which is also Spanish for "for") count only as the whole of a short message, and
     * only while she is moving for the stilling ones, so they never take a word from the music.
     * A bare "stop" never reaches this file in Private: consent reads it first (the turn's
     * `end`/`pace-down` intent) and eases or ends the evening — which stills her too. Holding
     * still and going on is "stay still", "don't move", "ferma"…
     */
    const MOVE_VERBS = new RegExp(
        word(
            'move (?:slowly |slow |faster |fast |gently |harder )?for me|move (?:slowly|slow|faster|gently)|keep moving|move your hips|muoviti (?:piano|lentamente|più veloce|più forte)|muévete (?:despacio|más rápido|mas rapido)|bouge (?:doucement|lentement|plus vite)|beweg dich (?:langsam|schneller)|mexe-te (?:devagar|mais rápido)|rock your hips|rock for me|grind on me|grind for me|muoviti per me|muovi i fianchi|continua a muoverti|muévete para mí|muevete para mi|mueve las caderas|sigue moviéndote|sigue moviendote|bouge pour moi|bouge tes hanches|continue de bouger|beweg dich für mich|beweg deine hüften|beweg dich weiter|mexe-te para mim|mexe as ancas|mexa os quadris|continua a mexer'
        ),
        'iu'
    );
    const MOVE_SHORT =
        /^(?:(?:please|per favore|por favor|s[’']il te plaît|bitte)\s+)?(?:move|moving|rock|grind|keep going|go on|don[’']?t stop|do not stop|muoviti|continua|non fermarti|non smettere|muévete|muevete|sigue|no pares|bouge|continue|ne t[’']arrête pas|beweg dich|mach weiter|hör nicht auf|mexe-te|mexa-se|continua|não pares|nao pares|não pare)(?:\s+(?:please|per favore|por favor|bitte))?[\s.!…]*$/iu;
    const MOVE_CJK =
        /動いて|腰を振って|止めないで|続けて|움직여|계속해|멈추지 마|허리를 움직여|动起来|动一动|继续|别停|扭动/u;
    const STILL_VERBS = new RegExp(
        word(
            "stop moving|stay still|hold still|keep still|don[’']?t move|do not move|stai ferma|resta ferma|smetti di muoverti|non muoverti|quédate quieta|quedate quieta|deja de moverte|no te muevas|ne bouge plus|arrête de bouger|reste immobile|bleib still|hör auf dich zu bewegen|beweg dich nicht|fica quieta|para de te mexer|não te mexas"
        ),
        'iu'
    );
    const STILL_SHORT =
        /^(?:stop|freeze|enough|fermati|basta|ferma|para|párate|parate|arrête|arrete|stopp|halt|pára)[\s.!…]*$/iu;
    const STILL_CJK = /止まって|じっとして|動かないで|멈춰|가만히 있어|움직이지 마|别动|停下|不要动/u;
    const MOVE_SLOW = new RegExp(
        word('slowly|slow|piano|lentamente|despacio|lento|doucement|lentement|langsam|devagar'),
        'iu'
    );
    const MOVE_FAST = new RegExp(word('fast|faster|quick|veloce|rápido|rapido|vite|schnell|depressa'), 'iu');

    /**
     * Codex (#196). "Don't rock your hips", "I don't want you to keep moving", "non muoverti così":
     * a movement word under a negation is a no. It runs before the general negation gate (so
     * "don't stop" can be a yes), so it checks for itself: negated and not one of the affirmative
     * "don't stop" phrases means stop if she is moving, and nothing otherwise — never a start.
     */
    const MOVE_NEGATED =
        /(?:^|[\s,.!])(?:don[’']?t|do not|never|stop|i don[’']?t want|non|no|nunca|jamais|ne|n[’']|nicht|kein|não|nao|nie)(?=[\s,.!])/iu;
    const MOVE_YES_DESPITE_NO =
        /don[’']?t stop|do not stop|non fermarti|non smettere|no pares|ne t[’']arrête pas|hör nicht auf|hor nicht auf|não pares|nao pares|não pare|止めないで|멈추지 마|别停/iu;

    /**
     * HA1. Her hair aside, in the nine languages, and back as it was. Explicit phrases only: "hair"
     * alone is talk ("I love your hair"), and pulling it is not this (that is never a hair move).
     * The ⋯ chip speaks the first English/Italian/… phrase of each list.
     */
    const HAIR_ASIDE = new RegExp(
        word(
            'hair aside|move your hair|your hair out of the way|hair out of the way|hair over your shoulder|hair forward|capelli da parte|sposta i capelli|scosta i capelli|capelli in avanti|togli i capelli dalla schiena|pelo a un lado|aparta el pelo|aparta tu pelo|cabello a un lado|aparta el cabello|cheveux sur le côté|écarte tes cheveux|écarte les cheveux|dégage tes cheveux|haare zur seite|nimm die haare zur seite|haare nach vorne|cabelo para o lado|afasta o cabelo|tira o cabelo das costas'
        ),
        'iu'
    );
    const HAIR_ASIDE_CJK =
        /髪をよけて|髪をどけて|髪を横に|髪を前に|머리카락 치워|머리 넘겨|머리카락을 옆으로|把头发拨开|头发拨到一边|把头发撩开/u;
    const HAIR_BACK = new RegExp(
        word(
            'hair back|hair down again|let your hair down|let your hair fall|capelli come prima|lascia cadere i capelli|rimetti i capelli|pelo como antes|suelta el pelo|cheveux comme avant|lâche tes cheveux|haare wieder zurück|haare wie vorher|cabelo como antes|solta o cabelo'
        ),
        'iu'
    );
    const HAIR_BACK_CJK = /髪を戻して|머리 원래대로|头发放下|头发恢复/u;
    const HAIR_LEFT = new RegExp(word('left|sinistra|izquierda|gauche|links|esquerda'), 'iu');
    const HAIR_RIGHT = new RegExp(word('right|destra|derecha|droite|rechts|direita'), 'iu');

    function hairFrom(body) {
        if (HAIR_BACK.test(body) || HAIR_BACK_CJK.test(body)) return action('avatar.hair', { move: 'back' }, 'avatar');
        if (HAIR_ASIDE.test(body) || HAIR_ASIDE_CJK.test(body)) {
            const side = HAIR_LEFT.test(body) ? 'left' : HAIR_RIGHT.test(body) ? 'right' : 'front';
            return action('avatar.hair', { move: 'aside', side }, 'avatar');
        }
        return null;
    }

    const STORY_SHOWS = ['fist-then-inside', 'worse-than-last-time', 'fist-then-ass'];
    function storyShowFrom(body) {
        for (const [id, words] of ROUTINE_NAMES) {
            if (!STORY_SHOWS.includes(id)) continue;
            if (new RegExp(words, 'iu').test(body))
                return action('avatar.routine', { routine: id, move: 'start' }, 'avatar');
        }
        return null;
    }

    function motionFrom(body, context) {
        const c = context || {};
        if (!c.poseHeld || c.routine === 'running') return null;
        const short = body.length <= 40;
        if ((STILL_VERBS.test(body) || STILL_CJK.test(body)) && !MOVE_SHORT.test(body))
            return action('avatar.move', { move: 'still' }, 'avatar');
        if (c.moving && short && STILL_SHORT.test(body)) return action('avatar.move', { move: 'still' }, 'avatar');
        if (` ${body} `.match(MOVE_NEGATED) && !MOVE_YES_DESPITE_NO.test(body)) {
            const aboutMoving =
                MOVE_VERBS.test(body) ||
                MOVE_SHORT.test(body.replace(MOVE_NEGATED, ' ').trim()) ||
                /\b(?:move|moving|rock|grind)\b/iu.test(body);
            if (!aboutMoving) return null;
            return c.moving ? action('avatar.move', { move: 'still' }, 'avatar') : null;
        }
        if (c.moving) {
            if (ROUTINE_SLOWER.test(body) || ROUTINE_SLOWER_CJK.test(body))
                return action('avatar.move', { move: 'slower' }, 'avatar');
            if (ROUTINE_FASTER.test(body) || ROUTINE_FASTER_CJK.test(body))
                return action('avatar.move', { move: 'faster' }, 'avatar');
        }
        if (MOVE_VERBS.test(body) || (short && (MOVE_SHORT.test(body) || MOVE_CJK.test(body)))) {
            const tempo = MOVE_SLOW.test(body) ? 'slow' : MOVE_FAST.test(body) ? 'fast' : undefined;
            return action('avatar.move', tempo ? { move: 'start', tempo } : { move: 'start' }, 'avatar');
        }
        return null;
    }

    /**
     * UN35. Japanese, Korean and Chinese, which the ⋯ menu's finish chips speak too: no word
     * boundaries in those scripts, so plain substrings. The back comes before inside because
     * 背中に (on your back) contains 中に (inside).
     */
    // Codex (#193). Only words that mean climax on their own count alone: いく and 出る are also "go"
    // and "go out" (ホテルにいく), and 射 alone is "shoot" (射击). 出す ("let out") counts only
    // with a place on her body (中に出す), never alone (ゴミを出す).
    const FINISH_VERB_CJK = /イク|イっ|イキそう|射精|쌀게|싼다|쌀 것 같|射了|要射|射在|射满|射进/u;
    const FINISH_WITH_PLACE_CJK = /出す|出して|出すよ/u;
    const FINISH_PLACES_CJK = [
        ['face', /顔に|얼굴에|脸上/u],
        ['mouth', /口に|口の中|입에|입안에|嘴里/u],
        ['all', /全身|온몸/u],
        ['both', /両方|둘 다|两个洞/u],
        ['ass', /お尻|엉덩이|屁股/u],
        ['back', /背中|등에|背上/u],
        ['belly', /お腹|おなか|배에|肚子/u],
        ['chest', /胸|おっぱい|가슴|奶子/u],
        ['inside', /中に|中で|안에|里面/u],
    ];

    /**
     * PS2. Fisting, in the app's languages. Only words that mean it: "pugno" or "puño" alone is
     * also a punch, so they count only with the act around them (il pugno dentro, fammi il pugno).
     * Anal when they say so; both when they say both; otherwise the bridge picks by her position.
     */
    const FIST = new RegExp(
        word(
            'fist me|fisting|fist you|your fist|my fist|whole hand inside|fammi il pugno|ti faccio il pugno|il pugno dentro|col pugno dentro|pugno nella|pugno nel culo|mano intera dentro|meterte el puño|el puño dentro|mi puño|tu puño|con el puño|mon poing|ton poing|le poing en|faust rein|meine faust|deine faust|o punho dentro|meu punho|teu punho|enfiar o punho'
        ),
        'iu'
    );
    const FIST_CJK = /フィスト|拳を入れ|拳入れ|피스팅|주먹을 넣|拳交|拳头插/u;
    const FIST_ANAL = new RegExp(word('anal|ass|culo|nel culo|in the ass|cul|arsch|cu|anus|ano'), 'iu');
    const FIST_ANAL_CJK = /アナル|お尻|애널|엉덩이|屁眼|肛/u;
    const FIST_BOTH = new RegExp(word('both|entrambi|tutti e due|ambos|los dos|les deux|beide|os dois'), 'iu');
    // L5. Her pussy, named: without it "the fist in my pussy" fell to the position's own order,
    // which from behind tries her ass first.
    const FIST_FRONT = new RegExp(
        word('pussy|cunt|vagina|figa|fica|nella figa|coño|cono|chatte|muschi|fotze|buceta|xoxota|boceta'),
        'iu'
    );
    const FIST_FRONT_CJK = /おまんこ|マンコ|보지|屄|小穴/u;
    const FIST_BOTH_CJK = /両方|둘 다|两个/u;

    /*
     * Codex (#200). Only a request runs it: "Do you like fisting?" and "I do not want fisting"
     * named the act and showed it on her. Now the message must ask (a request cue), must not be a
     * question, and must hold no negation anywhere — NEGATED only looks at the start.
     */
    const FIST_REQUEST = new RegExp(
        word(
            "fist me|fammi|voglio|vorrei|dammi|ti faccio|prendi|i want|give me|let me|take my|i'm going to|quiero|dame|déjame|dejame|toma|meterte|je veux|donne-moi|laisse-moi|prends|ich will|gib mir|lass mich|nimm|quero|dá-me|da-me|deixa-me|toma|enfiar"
        ),
        'iu'
    );
    const FIST_REQUEST_CJK = /して|したい|入れて|해 줘|해줘|넣어|넣을게|想要|给我|让我/u;
    const FIST_NOT = new RegExp(
        word("not|don't|don’t|do not|never|no|non|mai|niente|nunca|ni|pas|jamais|nicht|kein|keine|nie|não|nao|nem"),
        'iu'
    );
    const FIST_NOT_CJK = /ない|しない|やめ|않|안 |싫|不|别|没/u;

    /**
     * L5. A bottle inside her, asked for: the word and a request to put it in, in each language.
     * The same rules as the fist (a request, not a question, no negation anywhere).
     */
    const BOTTLE = new RegExp(word('bottle|bottiglia|botella|bouteille|flasche|garrafa'), 'iu');
    const BOTTLE_CJK = /ボトル|瓶を|병을|瓶子/u;
    const BOTTLE_IN = new RegExp(
        word(
            'in me|inside|in your|into you|in you|dentro|nella|nel|infila|mettimi|metti|ficca|en ti|dentro de|métete|metete|en toi|dans|rein|in dich|in deine|enfia|enfiar|em ti|na tua|no teu'
        ),
        'iu'
    );
    const BOTTLE_IN_CJK = /入れ|넣|插/u;
    const BOTTLE_VERB = new RegExp(
        word(
            'put|stick|push|shove|insert|use|infilami|infila|mettimi|metti|ficcami|spingi|usa|métete|metete|méteme|meteme|mete|mets|enfonce|utilise|steck|schieb|benutz|enfia|mete|usa'
        ),
        'iu'
    );

    function bottleFrom(body) {
        if (!BOTTLE.test(body) && !BOTTLE_CJK.test(body)) return null;
        if (!BOTTLE_IN.test(body) && !BOTTLE_IN_CJK.test(body)) return null;
        if (/[?？]/.test(body) || FIST_NOT.test(body) || FIST_NOT_CJK.test(body)) return null;
        if (
            !FIST_REQUEST.test(body) &&
            !BOTTLE_VERB.test(body) &&
            !FIST_REQUEST_CJK.test(body) &&
            !BOTTLE_IN_CJK.test(body)
        )
            return null;
        const where =
            FIST_BOTH.test(body) || FIST_BOTH_CJK.test(body)
                ? 'both'
                : FIST_ANAL.test(body) || FIST_ANAL_CJK.test(body)
                  ? 'anal'
                  : 'front';
        return action('body.fist', { where, with: 'bottle' }, 'body');
    }

    function fistFrom(body) {
        const bottle = bottleFrom(body);
        if (bottle) return bottle;
        if (!FIST.test(body) && !FIST_CJK.test(body)) return null;
        if (/[?？]/.test(body) || FIST_NOT.test(body) || FIST_NOT_CJK.test(body)) return null;
        if (!FIST_REQUEST.test(body) && !FIST_REQUEST_CJK.test(body)) return null;
        const where =
            FIST_BOTH.test(body) || FIST_BOTH_CJK.test(body)
                ? 'both'
                : FIST_ANAL.test(body) || FIST_ANAL_CJK.test(body)
                  ? 'anal'
                  : FIST_FRONT.test(body) || FIST_FRONT_CJK.test(body)
                    ? 'front'
                    : 'choose';
        return action('body.fist', { where }, 'body');
    }

    function finishFrom(body) {
        if (FINISH_VERB.test(body)) {
            for (const [where, words] of FINISH_PLACES) {
                if (new RegExp(word(words), 'iu').test(body)) return action('body.finish', { where }, 'body');
            }
            return action('body.finish', { where: 'choose' }, 'body');
        }
        const strong = FINISH_VERB_CJK.test(body);
        if (strong || FINISH_WITH_PLACE_CJK.test(body)) {
            for (const [where, words] of FINISH_PLACES_CJK) {
                if (words.test(body)) return action('body.finish', { where }, 'body');
            }
            if (strong) return action('body.finish', { where: 'choose' }, 'body');
        }
        return null;
    }

    /** "yes" to something she offered, in the app's languages — a short message and nothing else. */
    const YES =
        /^(?:yes|yeah|yep|yup|ok|okay|sure|please do|do it|go ahead|go on|sì|si|certo|va bene|dai|fallo|volentieri|oui|d[’']accord|vas-y|ja|klar|gern|mach das|sim|claro|pode|vale|hazlo|venga|はい|うん|お願い|いいよ|네|응|좋아|好|好的|可以|行)(?:[\s,]+(?:please|per favore|por favor|bitte|grazie|thanks))?[\s.!]*$/iu;

    /**
     * UN4. Going somewhere else, in their words. A verb of going (or "take me") must start the
     * message; the destination is a keyword the bridge resolves against the places this device
     * can show — never a world id typed by anybody. With no destination named it is `elsewhere`:
     * the bridge turns that into her invitation to tonight's destination, which their yes takes.
     */
    const GO_VERB = new RegExp(
        `^(?:${word(
            "let[’']?s go|let us go|shall we go|can we go|could we go|take me|bring me|go to|we could go|andiamo|andiamocene|portami|possiamo andare|potremmo andare|podemos ir|on peut aller|können wir (?:gehen|nach|zu)|podemos ir|vamos|vámonos|vamonos|llévame|llevame|allons|on va|emmène-moi|emmene-moi|lass uns gehen|lass uns|gehen wir|bring mich|bora|leva-me|me leva|vamos para"
        )})`,
        'iu'
    );
    const GO_CJK = /行こう|に行きたい|連れて行って|가자|데려가|我们去|带我去|走吧/u;
    const PLACE_WORDS = [
        ['hotel', 'hotel|hôtel|albergo|suite|ホテル|호텔|酒店|宾馆'],
        [
            'apartment',
            'apartment|flat|appartamento|apartamento|appartement|wohnung|casa tua|casa mia|da te|da me|chez toi|chez moi|zu dir|zu mir|tua casa|your place|my place|部屋|아파트|집|公寓',
        ],
        [
            'bedroom',
            'bedroom|camera da letto|in camera|dormitorio|habitación|chambre|schlafzimmer|quarto|寝室|침실|卧室',
        ],
        ['motel', 'motel'],
        ['discoteca', 'discoteca|disco|nightclub|club|boîte|ディスコ|클럽|夜店'],
        ['cabaret', 'cabaret|cabaré|カバレー'],
        ['rooftop', 'rooftop|terrazza|tetto|azotea|toit|dachterrasse|屋上|옥상|天台'],
        ['street', 'street|strada|calle|rue|straße|strasse|rua|街|거리'],
    ];
    const ELSEWHERE = new RegExp(
        `${word(
            "somewhere(?: else| quieter)?|elsewhere|another place|out of here|altrove|da un[’']?altra parte|un altro posto|un posto più tranquillo|via di qui|a otro sitio|a otro lugar|ailleurs|autre part|woanders(?:hin)?|outro lugar"
        )}|どこか|다른 곳|别的地方`,
        'iu'
    );

    function travelFrom(body) {
        if (!GO_VERB.test(body) && !GO_CJK.test(body)) return null;
        for (const [key, words] of PLACE_WORDS)
            if (
                new RegExp(
                    `${word(words)}|${
                        words
                            .split('|')
                            .filter((w) => /[\u3040-\u9fff\uac00-\ud7af]/u.test(w))
                            .join('|') || '(?!)'
                    }`,
                    'iu'
                ).test(body)
            )
                return action('world.travel', { world: key }, 'world');
        if (ELSEWHERE.test(body)) return action('world.travel', { world: 'elsewhere' }, 'world');
        return null;
    }

    /**
     * UN5. Her body's positions, in neutral words, nine languages. Plain "sdraiati" / "lie down"
     * stays the lie-down motion it always was; only "on your back / front / side" is a held pose.
     * "Alzati" / "stand up" lets go of a held pose — and only when one is held, so it is still the
     * ordinary stand-up motion otherwise.
     */
    const POSE_WORDS = [
        // UN27. The closer positions (PrivatePoseController.INTIMATE), first: each is a more
        // specific form of a plainer one below ("in ginocchio a gambe aperte" starts like "in
        // ginocchio", "仰向けで膝を立てて" contains "仰向け"), and the first match wins. Gated like all
        // fours: the policy opens them only at the top of the pace. Every line the ⋯ menu sends
        // (PrivateLocale `position.*.say`) is matched here, in its own language — a test holds it.
        // UN38. Six more, ahead of the plainer ones they contain ("bück dich für mich" starts like
        // "bück dich", "うつ伏せでお尻を上げて" contains "うつ伏せ", "ride me facing away" like the
        // ride show). Each line the ⋯ menu sends is matched in its own language (a test holds it).
        [
            'face-down',
            "(?:mettiti |stai )?(?:a )?faccia in giù,? (?:e |col |con il )?(?:sedere|culo) (?:in su|in alto|all'insù)|face down,? (?:and )?(?:ass|butt|hips) up|(?:ponte )?boca abajo,? con el culo (?:arriba|en pompa)|visage en bas,? (?:les )?fesses relevées|la tête en bas,? les fesses en l.air|gesicht nach unten,? (?:hintern|arsch|po) hoch|cara para baixo,? bunda para cima|empina a bunda",
            /うつ伏せでお尻を上げて|お尻を上げて|엎드려서\s?엉덩이를\s?들어|엉덩이를\s?들어|趴下撅起屁股|撅起屁股/u,
        ],
        [
            'legs-up',
            '(?:metti |appoggia )?le gambe sulle mie spalle|gambe in alto|(?:alza|solleva) le gambe|(?:put |rest )?your legs (?:up )?(?:on|over) my shoulders|legs (?:up )?(?:on|over) my shoulders|(?:put |raise |lift )?your legs (?:up )?in the air|legs in the air|(?:pon )?las piernas (?:sobre|en) mis hombros|piernas (?:arriba|en el aire)|levanta las piernas|mets tes jambes sur mes épaules|(?:les )?jambes (?:levées|en l.air)|lève les jambes|leg deine beine auf meine schultern|beine (?:auf meine schultern|hoch|in die luft)|põe as pernas nos meus ombros|poe as pernas nos meus ombros|pernas (?:nos meus ombros|para cima|para o ar)|levanta as pernas',
            /脚を私の肩に乗せて|脚を肩に|다리를\s?내\s?어깨에\s?올려|다리를\s?어깨에|把腿放在我肩上|腿放在我肩上|把腿举起来/u,
        ],
        [
            'bent-over',
            'piegati per me|piegati (?:a|con le) gambe (?:aperte|larghe)|bend over for me|bend over with your legs (?:apart|open|spread)|inclínate para mí|inclinate para mi|inclínate y abre las piernas|penche-toi pour moi|penche-toi,? (?:les )?jambes écartées|bück dich für mich|bueck dich fuer mich|bück dich (?:und spreiz die beine|breitbeinig)|curva-te para mim|curva-te de pernas abertas',
            /前かがみになって脚を開いて|前かがみで脚を開いて|다리를\s?벌리고\s?숙여|为我弯下腰|弯下腰分开腿/u,
        ],
        [
            'spoon',
            '(?:mettiti )?a cucchiaio(?: con me)?|a cucchiaino(?: con me)?|spoon (?:with )?me|let me spoon you|spooning|(?:hagamos |haz )?(?:la )?cucharita(?: conmigo)?|en (?:petite )?cuillère(?: avec moi)?|löffelchen(?:stellung)?(?: mit mir)?|(?:de )?conchinha(?: comigo)?',
            /横向きで後ろから抱かせて|横向きで後ろから|옆으로\s?누워서\s?등을\s?기대|侧躺让我从后面抱你|勺子式/u,
        ],
        [
            'reverse',
            'cavalcami di spalle|(?:mettiti )?a cavalcioni di spalle|a cavalcioni al contrario|ride me (?:facing away|backwards)|straddle me facing away|reverse cowgirl|móntame de espaldas|montame de espaldas|a horcajadas de espaldas|vaquera invertida|chevauche-moi dos à moi|à califourchon dos à moi|reite mich rückwärts|reite mich rueckwaerts|rittlings mit dem rücken zu mir|monta em mim de costas|montada de costas',
            /後ろ向きでまたがって|背面騎乗位|등을\s?보이며\s?올라타|背对着我跨坐|反向骑乘/u,
        ],
        [
            'on-knees',
            '(?:mettiti |stai )?in ginocc?hio davanti a me|inginocchiati davanti a me|(?:get )?on your knees (?:in front of|before) me|kneel (?:down )?(?:in front of|before) me|(?:ponte )?de rodillas (?:delante de|frente a) mí|(?:ponte )?de rodillas (?:delante de|frente a) mi|arrodíllate (?:delante de|frente a) mí|(?:mets-toi )?à genoux devant moi|knie dich vor mich(?: hin)?|knie vor mir|(?:fica )?de joelhos na minha frente|de joelhos à minha frente|ajoelha-te à minha frente',
            /私の前でひざまずいて|私の前で跪いて|내\s?앞에\s?무릎\s?꿇어|跪在我面前/u,
        ],
        [
            'sit-open',
            '(?:siediti |stai seduta )?(?:a|con le) gambe (?:aperte|larghe)|apri le gambe|allarga le gambe|sit with your legs (?:open|apart|spread)|(?:open|spread) your legs|(?:siéntate |sientate )?con las piernas abiertas|abre las piernas|(?:assieds-toi |assois-toi )?les jambes écartées|écarte les jambes|setz dich breitbeinig(?: hin)?|spreiz die beine|(?:senta(?:-te)? |sente )?de pernas abertas|abr[ae] as pernas',
            /脚を開いて座って|脚を開いて|다리를\s?벌리고\s?앉아|다리를\s?벌려|张开腿坐下|张开腿|分开腿/u,
        ],
        [
            'kneel-wide',
            '(?:mettiti |metti |stai )?in ginocc?hio (?:a|con le) (?:gambe|ginocchia) (?:aperte|larghe)|inginocchiati (?:a|con le) (?:gambe|ginocchia) (?:aperte|larghe)|kneel(?: down)? with your (?:knees|legs) (?:apart|open|wide)|kneel wide|(?:arrodíllate|arrodillate) con las (?:rodillas separadas|piernas abiertas)|de rodillas con las rodillas separadas|(?:mets-toi )?à genoux,? les genoux écartés|knie dich breitbeinig hin|(?:ajoelha-te|ajoelhe(?:-se)?|de joelhos) com os joelhos afastados',
            /膝を開いてひざまずいて|膝を開いて跪いて|무릎을\s?벌리고\s?꿇어|分开膝盖跪下|分开腿跪下/u,
        ],
        [
            'knees-up',
            '(?:sdraiati |stenditi |mettiti )?(?:sulla schiena|a pancia in su),? (?:con le|a) ginocchia (?:alzate|su|piegate)|(?:lie |lay )?on your back with your knees (?:up|bent|raised)|(?:túmbate |tumbate |acuéstate |acuestate )?boca arriba con las rodillas (?:dobladas|arriba|levantadas)|(?:allonge-toi |couche-toi )?sur le dos,? les genoux (?:relevés|pliés)|leg dich auf den rücken und stell die knie auf|(?:leg dich )?auf den rücken mit (?:aufgestellten|angezogenen) knien|(?:deita-te |deite(?:-se)? )?de costas com os joelhos (?:dobrados|para cima)',
            /仰向けで膝を立てて|仰向けで膝を立てる|누워서\s?무릎을\s?세워|仰躺屈膝|躺下屈膝/u,
        ],
        [
            'straddle',
            '(?:mettiti |siediti |stai )?a cavalcioni(?: su di me| sopra di me)?|straddle me|straddle|sit astride(?: me)?|(?:siéntate |sientate |ponte )?a horcajadas(?: sobre mí| sobre mi)?|súbete encima de mí|(?:mets-toi |assieds-toi )?à califourchon(?: sur moi)?|setz dich rittlings(?: auf mich)?|mont[ae] em mim|(?:senta(?:-te)? )?escarranchada em mim',
            /私にまたがって|またがって|내\s?위에\s?올라타|올라타|跨坐在我身上|跨坐/u,
        ],
        [
            // The everyday adult name for the same static position maps to it too (owner
            // decision): the pose, held, nothing more — and it opens only where all fours does.
            'all-fours',
            // UN21. "meti in 4 zampi", "mettiti a 4 zampe", "mettiti alla pecorina", "carponi": the
            // digit, "in" for "a", the everyday typos. Unmatched, "mettiti a 4 zampe" fell through
            // to clothes and she was asked to put on a look called "4 zampe".
            '(?:(?:mettiti|mettit[ae]|metti|meti|mettere|vai|va|stai|resta|get|go|stay) )?(?:(?:a|in|su|alla|on|onto) )?(?:(?:quattro|4) zamp[aeio]|all (?:fours|4s?)|pecorina|carponi|gattoni)|(?:in )?doggy(?: style)?|a cuatro patas|a lo perrito|en perrito|à quatre pattes|en levrette|auf alle viere|de quatro|de gatas',
            /四つん這い|四つんばい|네\s?발로|跪趴|趴在床上/u,
        ],
        [
            'kneel',
            '(?:(?:mettiti|metti|meti|vai|stai) )?in ginocc?hi[oa]|in[gn]?inocc?hiati|inginocchiati|kneel(?: down)?|get on your knees|arrodíllate|arrodillate|de rodillas|à genoux|mets-toi à genoux|knie dich hin|auf die knie|ajoelha-te|de joelhos',
            /跪いて|ひざまずいて|무릎\s?꿇어|跪下/u,
        ],
        [
            'lie-back',
            '(?:sdraiati |stenditi |mettiti )?(?:sulla schiena|a pancia in su)|(?:lie |lay )?on your back|(?:túmbate |acuéstate )?boca arriba|sur le dos|auf den rücken|de costas|barriga para cima',
            /仰向け|똑바로\s?누워|躺平|仰躺/u,
        ],
        [
            'lie-front',
            '(?:sdraiati |stenditi |mettiti )?(?:a pancia in giù|sulla pancia|a pancia sotto)|(?:lie |lay )?on your (?:stomach|front|belly)|(?:túmbate |acuéstate )?boca abajo|sur le ventre|auf den bauch|de bruços',
            /うつ伏せ|엎드려|趴着|趴下/u,
        ],
        [
            'lie-side',
            '(?:sdraiati |stenditi |mettiti )?sul fianco|(?:lie |lay )?on your side|(?:túmbate |acuéstate )?de lado|de costado|sur le côté|auf die seite',
            /横向き|옆으로\s?누워|侧躺/u,
        ],
        [
            'bend-forward',
            'piegati(?: in avanti)?|chinati|bend over|bend forward|lean forward|inclínate|inclinate|agáchate|agachate|penche-toi|beug dich vor|bück dich|inclina-te|curva-te',
            /前かがみ|かがんで|숙여|弯腰|俯身/u,
        ],
        [
            'arch-back',
            'inarca la schiena|arch your back|arquea la espalda|cambre-toi|mach ein hohlkreuz|arqueia as costas',
            /背中を反らして|허리를\s?젖혀|弯起背/u,
        ],
    ];
    /**
     * OL3. Her legs, relative to the position she holds: "apri", "aprile di più", "open up",
     * "chiudi le gambe". These name no position, so they mean nothing without one — the bridge
     * resolves them through PrivatePoseController.transition from where she is. The bare forms
     * are the whole utterance only ("apri la finestra" is not her legs); the close forms name
     * the legs or knees, or say "chiudile".
     */
    const OPEN_ALONE =
        /^(?:apri(?:le|ti)?(?: di più| ancora| bene)?|allargale|più aperte|open(?: up| them| wider| more)?|wider|spread(?: them| wider)?|ábrelas|abrelas|abre(?:las)? más|ouvre(?:-les)?(?: plus)?|écarte(?:-les)?|öffne(?: sie| dich)?|spreiz sie|mais abertas|abre-as)[\s!.…]*$/iu;
    const OPEN_CJK = /^(?:もっと)?開いて[!！。]*$|^(?:더\s?)?벌려[!！.]*$|^张开[!！。]*$/u;
    const CLOSE_WORDS =
        /\b(?:chiudi(?:le)?|stringi) (?:le )?(?:gambe|ginocchia)\b|^chiudile\b|\bclose (?:your|ur) (?:legs|knees)\b|^close them\b|\bcierra(?:las)? (?:las )?piernas\b|^ciérralas|\b(?:serre|ferme) (?:les )?jambes\b|\bschlie(?:ß|ss) (?:die )?beine\b|\bfech[ae] (?:as )?pernas\b/iu;
    const CLOSE_CJK = /脚を閉じて|다리를\s?오므려|合上腿|并拢/u;
    /** OL3. Words that ask her to sit: "siediti a gambe aperte" is the seat, not her legs where she is. */
    const SIT_WORDS = /sied|sedut|\bsit\b|sient|sentad|assi[es]|assoi|setz|senta|座|앉|坐/iu;

    const STAND_WORDS = new RegExp(
        `^(?:${word('alzati|in piedi|stand up|get up|levántate|levantate|lève-toi|leve-toi|steh auf|levanta-te')}|立って|일어나|站起来)`,
        'iu'
    );
    const TURN_WORDS = new RegExp(
        `^(?:(?:adesso|ora|now|ahora|maintenant|jetzt|agora)\\s+)?(?:${word(
            'girati|voltati|gira ti|turn around|turn round|show me your back|let me see your back|fammi vedere la schiena|mostrami la schiena|date la vuelta|date vuelta|muéstrame la espalda|muestrame la espalda|retourne-toi|tourne-toi|montre-moi ton dos|dreh dich um|zeig mir deinen rücken|vira-te|mostra-me as costas'
        )})`,
        'iu'
    );
    const TURN_CJK = /振り向いて|後ろを向いて|背中を見せて|뒤돌아|등\s?보여\s?줘|转过身|转身|让我看看你的背/u;

    /** "Torna come prima" — the previous position, while one is held. */
    const AS_BEFORE = new RegExp(
        `^(?:${word('torna come prima|come prima|come eri prima|as before|like before|as you were|go back to how you were|como antes|vuelve como antes|comme avant|reviens comme avant|wie vorher|wie eben|como estavas')})|元に戻って|아까처럼|像刚才那样`,
        'iu'
    );
    const REDRESS = new RegExp(
        `^(?:${word(
            'rivestiti|vestiti di nuovo|rimettiti (?:i vestiti|il vestito|le tue cose)|get dressed(?: again)?|dress again|put (?:your|the) clothes (?:back )?on|put your clothes back on|vuelve a vestirte|vístete de nuevo|vistete de nuevo|ponte la ropa|rhabille-toi|zieh dich wieder an|veste-te de novo|volta a vestir'
        )})|服を着て|옷\s?입어|옷을\s?입어|穿上衣服|穿好衣服|把衣服穿上`,
        'iu'
    );

    /** "Ho finito", "I'm done": a lead before "rivestiti", or alone once something came off. */
    const DONE = new RegExp(
        `^(?:${word("ho finito|abbiamo finito|i[’']?m done|i am done|we[’']?re done|he terminado|terminé|j[’']ai fini|ich bin fertig|terminei|acabei")})(?:[\\s,.!]+|$)`,
        'iu'
    );
    const DONE_CJK = /^(?:終わった|終わり|끝났어|다\s?했어|我好了|结束了)/u;

    /** NL1. Pose Studio presets that already have a key here (PrivatePoseController.POSES). */
    const KEY_OF_PRESET = {
        kneeling: 'kneel',
        kneelingUp: 'kneel-up',
        lyingBack: 'lie-back',
        lyingFront: 'lie-front',
        lyingSide: 'lie-side',
        standingBendForward: 'bend-forward',
        standingBentBackward: 'arch-back',
        sittingLegsUp: 'lounge',
    };
    function poseCommands() {
        if (global && global.NEXUS_POSE_COMMANDS) return global.NEXUS_POSE_COMMANDS;
        if (typeof module !== 'undefined' && module.exports) {
            try {
                return require('../../xr/PoseCommands.js');
            } catch (_) {
                return null;
            }
        }
        return null;
    }

    function bodyFrom(body, context) {
        const c = context || {};
        const rest = body.replace(DONE, '').trim();
        // NL1. "Please change your position to …" in front of a position's words: the words
        // below matched only at the very start, so the frame made the whole request invisible
        // (reported: she said she had moved and stood still). The frame comes off first, in the
        // session's own language.
        const Commands = poseCommands();
        const inner = Commands ? Commands.stripFrame(body, c.lang).body : body;
        if (REDRESS.test(rest)) return action('wardrobe.redress', {}, 'wardrobe');
        if (
            c.undressed &&
            (DONE.test(body) || DONE_CJK.test(body)) &&
            rest.split(' ').length <= 3 &&
            !REDRESS.test(rest)
        )
            return action('wardrobe.redress', {}, 'wardrobe');
        for (const [key, words, cjk] of POSE_WORDS) {
            const re = new RegExp(`^(?:${word(words)})`, 'iu');
            if (re.test(body) || re.test(inner) || cjk.test(body)) {
                // OL3. "Apri le gambe" is relative to where she is; "siediti a gambe aperte" is the seat.
                if (key === 'sit-open' && !SIT_WORDS.test(body))
                    return action('avatar.pose', { pose: key, rel: 'open' }, 'avatar');
                return action('avatar.pose', { pose: key }, 'avatar');
            }
        }
        if (c.poseHeld && (OPEN_ALONE.test(body) || OPEN_CJK.test(body)))
            return action('avatar.pose', { pose: 'sit-open', rel: 'open' }, 'avatar');
        if (c.poseHeld && (CLOSE_WORDS.test(body) || CLOSE_CJK.test(body)))
            return action('avatar.pose', { pose: 'lie-back', rel: 'close' }, 'avatar');
        if (c.poseHeld && STAND_WORDS.test(body)) return action('avatar.pose', { pose: 'stand' }, 'avatar');
        if (c.poseHeld && AS_BEFORE.test(body)) return action('avatar.pose', { pose: 'back' }, 'avatar');
        // While she holds a position, turning keeps it (her whole body turns in place).
        if (c.poseHeld && (TURN_WORDS.test(body) || TURN_CJK.test(body)))
            return action('avatar.pose', { pose: 'turn' }, 'avatar');
        return presetFrom(body, c, Commands);
    }

    /**
     * NL1. Everything else Pose Studio offers, asked for in words: the resolver reads the live
     * catalogue the bridge hands in (`context.poseCatalogue`), so a preset added to the
     * navigator is reachable here without a line in this file. A position that was asked for
     * and is not there is an action too (`pose: 'unknown'`): the bridge fails it, and the reply
     * is told she did not move, where before nothing was said and the model was left to invent.
     */
    function presetFrom(body, c, Commands) {
        if (!Commands || typeof Commands.resolve !== 'function') return null;
        const found = Commands.resolve(body, { catalogue: c.poseCatalogue || [], held: c.poseHeld, lang: c.lang });
        if (!found) return null;
        if (found.kind === 'pose') {
            const key = KEY_OF_PRESET[found.preset];
            return action('avatar.pose', key ? { pose: key } : { pose: 'preset', preset: found.preset }, 'avatar');
        }
        if (found.kind === 'stand') return action('avatar.pose', { pose: 'stand' }, 'avatar');
        if (found.kind === 'previous') return action('avatar.pose', { pose: 'back' }, 'avatar');
        if (found.kind === 'ambiguous')
            return action(
                'avatar.pose',
                { pose: 'unknown', said: found.said, ask: found.options.map((o) => o.label).join(' / ') },
                'avatar'
            );
        // A loose posture request the motion fast path will answer itself ("sit on the sofa") is
        // its to answer; anything else that named a position gets an honest "I can't".
        if (found.kind === 'unknown-position' && !(found.loose && c.fastPathHit))
            return action('avatar.pose', { pose: 'unknown', said: String(found.said || '').slice(0, 80) }, 'avatar');
        return null;
    }

    /** "Andiamo!", "volentieri" — a yes to going, in particular. */
    const GO_YES = new RegExp(
        `^(?:${word(
            "andiamo|volentieri|let[’']?s go|let[’']?s do it|vamos|vámonos|vamonos|allons-y|on y va|gehen wir|los geht[’']?s|bora|vamos lá"
        )}|行こう|가자|走吧)`,
        'iu'
    );
    const GO_YES_ANYWHERE = new RegExp(GO_YES.source.replace(/^\^/, ''), 'iu');
    /**
     * UN6. A refusal or a delay anywhere in the answer: not a yes to going, whatever else it says.
     * Found in the real browser: "Let's stay here a little longer" took her to the bedroom (a bare
     * "let's" counted as yes), and "No, non andiamo", "Aspetta, andiamo dopo" and "Not yet, let's
     * wait" would have too. "Why not" / "perché no" are yeses, and are taken out before the check.
     */
    const GO_NOT_NOW = new RegExp(
        word(
            "no|non|not|don[’']?t|never|stay|wait|later|yet|restiamo|rimaniamo|resta|aspetta|dopo|più tardi|ancora no|quedemos|quedémonos|espera|luego|todavía no|restons|attends|plus tard|pas encore|bleiben|bleib|warte|später|noch nicht|ficamos|fiquemos|depois|ainda não|nicht|pas"
        ),
        'iu'
    );
    const WHY_NOT = new RegExp(
        word('why not|perché no|perchè no|por qué no|porque no|pourquoi pas|warum nicht|por que não'),
        'giu'
    );
    function affirmsGoing(text) {
        const said = clean(text);
        if (!said) return false;
        if (GO_NOT_NOW.test(said.replace(WHY_NOT, ' '))) return false;
        WHY_NOT.lastIndex = 0;
        if (WHY_NOT.test(said)) return true;
        if (said.split(' ').length > 6 || NEGATED.test(said)) return affirms(text);
        return GO_YES_ANYWHERE.test(said) || affirms(text);
    }

    /**
     * UN9. The evening's own cues, which move no world, outfit or music: "si è fatto tardi" asks
     * for the epilogue (she winds down, proposes nothing new — the person still decides when it
     * ends), and "dimentica le nostre serate" asks her to forget past evenings (StoryWeaver's
     * between-evenings history: catalogue ids, never words). Returns 'epilogue', 'forget' or null.
     */
    const EPILOGUE = new RegExp(
        [
            'si (?:è|e) fatto tardi|(?:è|e) tardi|si sta facendo tardi|ultimo ballo|ultimo bicchiere|chiudiamo (?:in bellezza|la serata)|la serata (?:sta )?(?:finendo|per finire)',
            "it[’']?s (?:getting )?late|getting late|last dance|last drink|wind (?:it )?down|wrap (?:it )?up|the night is (?:almost )?over",
            'se (?:está )?hac(?:e|iendo) tarde|es tarde|último baile|última copa',
            'il se fait tard|il est tard|dernière danse|dernier verre',
            'es wird spät|es ist spät|letzter tanz',
            'está ficando tarde|(?:já )?é tarde|última dança',
        ].join('|'),
        'iu'
    );
    const FORGET_STORIES = new RegExp(
        [
            'dimentica (?:le nostre |le )?(?:serate|storie|notti)',
            'forget (?:our |the |my |all our )?(?:evenings|nights|stories)',
            'olvida (?:nuestras |las )?(?:noches|historias|veladas)',
            'oublie (?:nos |les )?(?:soirées|nuits|histoires)',
            'vergiss (?:unsere |die )?(?:abende|nächte|geschichten)',
            'esquece (?:as nossas |as )?(?:noites|histórias|serões)',
        ].join('|'),
        'iu'
    );
    function storyCue(text) {
        const said = clean(text);
        if (!said || NEGATED.test(said)) return null;
        if (FORGET_STORIES.test(said)) return 'forget';
        if (EPILOGUE.test(said)) return 'epilogue';
        return null;
    }

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
    const POSTURE_NOT_CLOTHES =
        /^(?:mettiti|mettit[ae]|metti|meti|stai|resta)\s+(?:(?:a|in|sul|sulla|alla|di|più)\s+)*(?:sedut[oa]|sdraiat[oa]|stes[oa]|distes[oa]|in piedi|piedi|comod[oa]|cavalcioni|ginocc?hi[oa]|fianco|pancia|schiena|accovacciat[oa]|piegat[oa]|dritt[oa]|qui|qua|lì|li|là|vicino)(?![\p{L}\p{N}])/iu;

    function wardrobeFrom(text) {
        const styles = stylesIn(text);
        const colours = coloursIn(text);
        // A plain "dress" / "vestito" / "vestido" is how people say "an outfit" ("cambia vestito",
        // "un vestito elegante"): it names no garment, and treating it as one picked any look with
        // "dress" in its tags over the one that matched the style that was asked for.
        const garments = garmentsIn(text).filter((g) => g.name !== 'dress');
        const params = {};
        if (garments.length) {
            params.garment = garments[0].name;
            // Underwear named outright is a private outfit, whatever other style word is there.
            if (garments.some((g) => g.cat === 'lingerie') && !styles.includes('lingerie')) styles.unshift('lingerie');
        }
        if (styles.length) params.style = styles[0];
        if (colours.length) params.colour = colours[0];
        if (!styles.length && !colours.length && !garments.length) {
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
        // BD31. The two story shows are named with fist and finish words ("first the fist, then
        // inside"): their exact names are read before anything could take them for the acts.
        const story = !NEGATED.test(body) ? storyShowFrom(body) : null;
        if (story) return story;
        // UN5. Her body, and dressing again, before anything could read them as clothes or talk.
        const posed = !NEGATED.test(body) ? bodyFrom(body, c) : null;
        if (posed) return posed;
        // UN34. Coming, and where: before anything could read "on your back" as a position.
        const finished = !NEGATED.test(body) ? finishFrom(body) : null;
        if (finished) return finished;
        // PS2. Their fist, asked for in words: after the finish (its words win), before shows.
        const fisted = !NEGATED.test(body) ? fistFrom(body) : null;
        if (fisted) return fisted;
        // HA1. Her hair aside or back: its own words, before shows and moving ("move your hair"
        // is not "move for me").
        const hair = !NEGATED.test(body) ? hairFrom(body) : null;
        if (hair) return hair;
        // UN36. A show, after positions (their words win) and finishing.
        const show = !NEGATED.test(body) ? routineFrom(body, c) : null;
        if (show) return show;
        // LM7. Moving in the position she holds — before the negation gate: "don't stop" is a yes.
        const moving = motionFrom(body, c);
        if (moving) return moving;
        // UN7. Seeing her naked is the "everything off" step, asked for as a wish or a question.
        if (NAKED.test(body) && !NEGATED.test(body) && !ASKS_STATE.test(body))
            return action('wardrobe.undress', { step: 'all', naked: true, words: body.slice(0, 120) }, 'wardrobe');
        // UN4. "Possiamo andare altrove?" is a request put as a question; going is never talk.
        const goingFirst = travelFrom(body);
        if (goingFirst && !NEGATED.test(body)) return goingFirst;
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
        if (
            UNDRESS.test(body) ||
            /脱いで|벗어|脱掉/u.test(body) ||
            (UNDRESS_PRONOUN.test(body) && c.lastFamily !== 'music' && !aboutMusic)
        ) {
            // UN1. One layer at a time unless they say "all of it"; the policy decides whether the
            // evening is there yet (level 4), and the bridge picks the layer from her own looks.
            const step = UNDRESS_ALL.test(body) ? 'all' : 'next';
            return action('wardrobe.undress', { step, words: bare.slice(0, 120) }, 'wardrobe');
        }
        if (CHANGE_OUTFIT.test(body) || CHANGE_OUTFIT_CJK.test(body)) {
            const wanted = wardrobeFrom(bare);
            wanted.params.different = true;
            return wanted;
        }
        const wearSure = new RegExp(`^${word(WEAR_SURE)}(?:\\s+|$)`, 'iu');
        // UN21. "Mettiti seduta", "mettiti a cavalcioni", "mettiti comoda": "mettiti" is also how
        // Italian asks for a posture, and those became a look to put on ("seduta"). A posture is
        // never clothes: nothing here, so the body's own path (the motion fast path) reads it.
        if (POSTURE_NOT_CLOTHES.test(body)) return null;
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

    const api = {
        parse,
        topic,
        affirms,
        affirmsGoing,
        storyCue,
        travelFrom,
        bodyFrom,
        finishFrom,
        fistFrom,
        routineFrom,
        motionFrom,
        hairFrom,
        queryFrom,
        stylesIn,
        coloursIn,
        garmentsIn,
        GARMENTS,
        STYLES,
        COLOURS,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_ACTION_INTENT = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
