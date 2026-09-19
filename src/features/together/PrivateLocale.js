/**
 * Every visible word Private says that a model did not write (P14).
 *
 * A session on `it-IT` used to produce Italian model replies interleaved with English buttons,
 * English pace labels and English acknowledgements — because `AppLanguage` cascades into STT, TTS
 * and the LLM, but Private's own strings were literals inside logic. The model spoke Italian; the
 * app did not.
 *
 * ```text
 *   AppLanguage.code ──▶ STT ──▶ TTS ──▶ LLM directive
 *                    └──▶ PrivateLocale ──▶ controls · pace · status · choices
 * ```
 *
 * ## Read, never owned
 *
 * There is no Private language setting and there must not be one. Two places to change a language
 * is one place to forget. `code()` reads `AppLanguage` at call time and falls back to `en-US`, so
 * a page that never loaded it — `demo.html`, a test — still gets a complete set of strings.
 *
 * Resolved per call rather than cached because the person can change the language mid-session from
 * Settings, and a cached pack would leave the card in the language the session opened in.
 *
 * `src/AppLanguage.js` is an IIFE with no `module.exports`, so this file cannot `require()` it even
 * under Jest. It reads the global and takes an override, the same shape every other Private module
 * uses for its dependencies.
 *
 * ## What is here and what is deliberately not
 *
 * Here: the mechanical surface — controls, pace words, status chips, the local fallback choices,
 * the completion card. Short, and translatable without losing anything.
 *
 * Not here: the authored beats in `PrivateBeats.POOLS`. Forty-five lines of prose across ten
 * languages is a translation project, not a coding task, and a machine translation of "I notice I
 * have stopped thinking about what comes next" carries the words and not the tone — and the tone is
 * the product. Those stay English as the last-resort floor while the model, which receives the
 * language directive on every path as of this change, writes the live lines in-language.
 * `docs/PRIVATE_LIVE_SCENE.md` §4.3 has the counting.
 *
 * Exposes: window.NEXUS_PRIVATE_LOCALE
 */
(function (global) {
    'use strict';

    const FALLBACK = 'en-US';

    /**
     * The mechanical surface, in the ten languages `AppLanguage` ships.
     *
     * Key names describe the *role*, never the English text, so a caller cannot accidentally read
     * as a string constant something that is meant to vary.
     */
    const PACKS = {
        'en-US': {
            'controls.closer': 'Closer →',
            'controls.more': 'More →',
            'controls.ease': '← Ease up',
            'controls.end': 'End',
            'controls.aria.forward': 'One step more intense',
            'controls.aria.ease': 'One step gentler',
            'pace.1': 'Warm',
            'pace.2': 'Romantic',
            'pace.3': 'Sensual',
            'pace.aria.step': 'step {step} of {total}',
            'status.softened': '✓ Pace softened',
            'status.eased': '✓ Pace eased',
            'status.quieter': '✓ Quieter',
            'status.alreadyGentle': '✓ Already gentle',
            'status.moment': '✓ Give it a moment',
            'status.ceiling': '✓ As close as this preset goes',
            'status.quiet': '✓ Quiet',
            'card.kicker': '🔐 PRIVATE',
            'card.place': 'Current place',
            'card.you': 'YOU',
            'card.her': 'HER',
            'card.thinking': 'She is thinking',
            'composer.placeholder': 'Talk privately…',
            'complete.title': '✓ Private moment complete',
            'complete.note': 'A quiet ending, with no pressure to continue.',
            'complete.kept': 'Nothing from this Private moment was added to Playground Histories.',
            'complete.again': 'Another private moment',
            'complete.back': 'Back to Together',
            'mood.playful': 'Playful',
            'mood.tender': 'Tender',
            'texture.quieter': 'Quieter',
            'texture.closer': 'Closer',
            'soundtrack.fallback': 'Soft private soundtrack',
            'soundtrack.player': 'Private soundtrack player',
            'choice.opening': 'Tell me what you had in mind.',
            'choice.likeHere': 'I like it here.',
            'choice.thisIsGood': 'This is good.',
            'choice.goOn': 'Go on.',
            'choice.goodAnswer': 'That is a good answer.',
            'choice.mm': 'Mm.',
            'choice.stillHere': 'I am still here.',
            'choice.musicQuiet': 'This music suits the quiet.',
            'choice.tellMore': 'Tell me more.',
            'choice.musicSuits': 'This music suits you.',
            'choice.thinking': 'What are you thinking about?',
            'choice.likeHearing': 'I like hearing you say that.',
            'choice.quiet': '[stay quiet]',
            'choice.askMe': 'Ask me something.',
            'choice.surprise': 'Choose for us.',
        },
        'es-ES': {
            'controls.closer': 'Más cerca →',
            'controls.more': 'Más →',
            'controls.ease': '← Más despacio',
            'controls.end': 'Terminar',
            'controls.aria.forward': 'Un paso más intenso',
            'controls.aria.ease': 'Un paso más suave',
            'pace.1': 'Cálido',
            'pace.2': 'Romántico',
            'pace.3': 'Sensual',
            'pace.aria.step': 'paso {step} de {total}',
            'status.softened': '✓ Ritmo suavizado',
            'status.eased': '✓ Un paso atrás',
            'status.quieter': '✓ Más tranquilo',
            'status.alreadyGentle': '✓ Ya está suave',
            'status.moment': '✓ Dale un momento',
            'status.ceiling': '✓ Hasta aquí llega este modo',
            'status.quiet': '✓ En silencio',
            'card.kicker': '🔐 PRIVADO',
            'card.place': 'Lugar actual',
            'card.you': 'TÚ',
            'card.her': 'ELLA',
            'card.thinking': 'Está pensando',
            'composer.placeholder': 'Habla en privado…',
            'complete.title': '✓ Momento privado completado',
            'complete.note': 'Un final tranquilo, sin ninguna presión para continuar.',
            'complete.kept': 'No se ha añadido nada de este momento privado a los Historiales.',
            'complete.again': 'Otro momento privado',
            'complete.back': 'Volver a Together',
            'mood.playful': 'Juguetón',
            'mood.tender': 'Tierno',
            'texture.quieter': 'Más tranquilo',
            'texture.closer': 'Más cerca',
            'soundtrack.fallback': 'Música suave de fondo',
            'soundtrack.player': 'Reproductor de música privada',
            'choice.opening': 'Dime qué tenías en mente.',
            'choice.likeHere': 'Me gusta estar aquí.',
            'choice.thisIsGood': 'Esto está bien.',
            'choice.goOn': 'Sigue.',
            'choice.goodAnswer': 'Es una buena respuesta.',
            'choice.mm': 'Mm.',
            'choice.stillHere': 'Sigo aquí.',
            'choice.musicQuiet': 'Esta música le va bien al silencio.',
            'choice.tellMore': 'Cuéntame más.',
            'choice.musicSuits': 'Esta música te va bien.',
            'choice.thinking': '¿En qué estás pensando?',
            'choice.likeHearing': 'Me gusta oírte decir eso.',
            'choice.quiet': '[quedarse en silencio]',
            'choice.askMe': 'Pregúntame algo.',
            'choice.surprise': 'Elige tú por los dos.',
        },
        'it-IT': {
            'controls.closer': 'Più vicino →',
            'controls.more': 'Ancora →',
            'controls.ease': '← Più piano',
            'controls.end': 'Fine',
            'controls.aria.forward': 'Un passo più intenso',
            'controls.aria.ease': 'Un passo più delicato',
            'pace.1': 'Caldo',
            'pace.2': 'Romantico',
            'pace.3': 'Sensuale',
            'pace.aria.step': 'passo {step} di {total}',
            'status.softened': '✓ Ritmo attenuato',
            'status.eased': '✓ Un passo indietro',
            'status.quieter': '✓ Più tranquillo',
            'status.alreadyGentle': '✓ È già delicato',
            'status.moment': '✓ Dalle un momento',
            'status.ceiling': '✓ Questo preset arriva fin qui',
            'status.quiet': '✓ In silenzio',
            'card.kicker': '🔐 PRIVATO',
            'card.place': 'Luogo attuale',
            'card.you': 'TU',
            'card.her': 'LEI',
            'card.thinking': 'Sta pensando',
            'composer.placeholder': 'Parla in privato…',
            'complete.title': '✓ Momento privato concluso',
            'complete.note': 'Un finale tranquillo, senza alcuna pressione per continuare.',
            'complete.kept': 'Niente di questo momento privato è stato aggiunto alle Cronologie.',
            'complete.again': 'Un altro momento privato',
            'complete.back': 'Torna a Together',
            'mood.playful': 'Giocoso',
            'mood.tender': 'Tenero',
            'texture.quieter': 'Più tranquillo',
            'texture.closer': 'Più vicino',
            'soundtrack.fallback': 'Musica di sottofondo',
            'soundtrack.player': 'Lettore della musica privata',
            'choice.opening': 'Dimmi cosa avevi in mente.',
            'choice.likeHere': 'Mi piace stare qui.',
            'choice.thisIsGood': 'Così va bene.',
            'choice.goOn': 'Continua.',
            'choice.goodAnswer': 'È una bella risposta.',
            'choice.mm': 'Mm.',
            'choice.stillHere': 'Sono ancora qui.',
            'choice.musicQuiet': 'Questa musica sta bene al silenzio.',
            'choice.tellMore': 'Raccontami di più.',
            'choice.musicSuits': 'Questa musica ti si addice.',
            'choice.thinking': 'A cosa stai pensando?',
            'choice.likeHearing': 'Mi piace sentirtelo dire.',
            'choice.quiet': '[restare in silenzio]',
            'choice.askMe': 'Fammi una domanda.',
            'choice.surprise': 'Scegli tu cosa facciamo.',
        },
        'fr-FR': {
            'controls.closer': 'Plus près →',
            'controls.more': 'Encore →',
            'controls.ease': '← Plus doucement',
            'controls.end': 'Terminer',
            'controls.aria.forward': 'Un cran plus intense',
            'controls.aria.ease': 'Un cran plus doux',
            'pace.1': 'Chaleureux',
            'pace.2': 'Romantique',
            'pace.3': 'Sensuel',
            'pace.aria.step': 'étape {step} sur {total}',
            'status.softened': '✓ Rythme adouci',
            'status.eased': '✓ Un pas en arrière',
            'status.quieter': '✓ Plus calme',
            'status.alreadyGentle': '✓ C’est déjà doux',
            'status.moment': '✓ Laisse-lui un instant',
            'status.ceiling': '✓ Ce préréglage ne va pas plus loin',
            'status.quiet': '✓ En silence',
            'card.kicker': '🔐 PRIVÉ',
            'card.place': 'Lieu actuel',
            'card.you': 'TOI',
            'card.her': 'ELLE',
            'card.thinking': 'Elle réfléchit',
            'composer.placeholder': 'Parle en privé…',
            'complete.title': '✓ Moment privé terminé',
            'complete.note': 'Une fin tranquille, sans aucune pression pour continuer.',
            'complete.kept': 'Rien de ce moment privé n’a été ajouté aux Historiques.',
            'complete.again': 'Un autre moment privé',
            'complete.back': 'Retour à Together',
            'mood.playful': 'Joueur',
            'mood.tender': 'Tendre',
            'texture.quieter': 'Plus calme',
            'texture.closer': 'Plus près',
            'soundtrack.fallback': 'Musique douce en fond',
            'soundtrack.player': 'Lecteur de la musique privée',
            'choice.opening': 'Dis-moi ce que tu avais en tête.',
            'choice.likeHere': 'Je me sens bien ici.',
            'choice.thisIsGood': 'C’est bien comme ça.',
            'choice.goOn': 'Continue.',
            'choice.goodAnswer': 'C’est une belle réponse.',
            'choice.mm': 'Mm.',
            'choice.stillHere': 'Je suis toujours là.',
            'choice.musicQuiet': 'Cette musique va bien au silence.',
            'choice.tellMore': 'Raconte-moi.',
            'choice.musicSuits': 'Cette musique te va bien.',
            'choice.thinking': 'À quoi penses-tu ?',
            'choice.likeHearing': 'J’aime t’entendre dire ça.',
            'choice.quiet': '[rester en silence]',
            'choice.askMe': 'Pose-moi une question.',
            'choice.surprise': 'Choisis pour nous.',
        },
        'de-DE': {
            'controls.closer': 'Näher →',
            'controls.more': 'Mehr →',
            'controls.ease': '← Langsamer',
            'controls.end': 'Beenden',
            'controls.aria.forward': 'Eine Stufe intensiver',
            'controls.aria.ease': 'Eine Stufe sanfter',
            'pace.1': 'Warm',
            'pace.2': 'Romantisch',
            'pace.3': 'Sinnlich',
            'pace.aria.step': 'Stufe {step} von {total}',
            'status.softened': '✓ Tempo zurückgenommen',
            'status.eased': '✓ Einen Schritt zurück',
            'status.quieter': '✓ Ruhiger',
            'status.alreadyGentle': '✓ Schon ganz sanft',
            'status.moment': '✓ Gib ihr einen Moment',
            'status.ceiling': '✓ Weiter geht dieses Preset nicht',
            'status.quiet': '✓ Still',
            'card.kicker': '🔐 PRIVAT',
            'card.place': 'Aktueller Ort',
            'card.you': 'DU',
            'card.her': 'SIE',
            'card.thinking': 'Sie überlegt',
            'composer.placeholder': 'Sprich privat…',
            'complete.title': '✓ Privater Moment beendet',
            'complete.note': 'Ein ruhiger Abschluss, ganz ohne Druck weiterzumachen.',
            'complete.kept': 'Nichts aus diesem privaten Moment wurde in den Verläufen gespeichert.',
            'complete.again': 'Noch ein privater Moment',
            'complete.back': 'Zurück zu Together',
            'mood.playful': 'Verspielt',
            'mood.tender': 'Zärtlich',
            'texture.quieter': 'Ruhiger',
            'texture.closer': 'Näher',
            'soundtrack.fallback': 'Leise Hintergrundmusik',
            'soundtrack.player': 'Player für die private Musik',
            'choice.opening': 'Sag mir, was du dir vorgestellt hast.',
            'choice.likeHere': 'Hier gefällt es mir.',
            'choice.thisIsGood': 'So ist es gut.',
            'choice.goOn': 'Erzähl weiter.',
            'choice.goodAnswer': 'Das ist eine schöne Antwort.',
            'choice.mm': 'Mm.',
            'choice.stillHere': 'Ich bin noch da.',
            'choice.musicQuiet': 'Diese Musik passt zur Stille.',
            'choice.tellMore': 'Erzähl mir mehr.',
            'choice.musicSuits': 'Diese Musik passt zu dir.',
            'choice.thinking': 'Woran denkst du gerade?',
            'choice.likeHearing': 'Ich höre dich das gern sagen.',
            'choice.quiet': '[still bleiben]',
            'choice.askMe': 'Frag mich etwas.',
            'choice.surprise': 'Entscheide du für uns.',
        },
        'pt-BR': {
            'controls.closer': 'Mais perto →',
            'controls.more': 'Mais →',
            'controls.ease': '← Mais devagar',
            'controls.end': 'Encerrar',
            'controls.aria.forward': 'Um passo mais intenso',
            'controls.aria.ease': 'Um passo mais suave',
            'pace.1': 'Caloroso',
            'pace.2': 'Romântico',
            'pace.3': 'Sensual',
            'pace.aria.step': 'passo {step} de {total}',
            'status.softened': '✓ Ritmo suavizado',
            'status.eased': '✓ Um passo atrás',
            'status.quieter': '✓ Mais calmo',
            'status.alreadyGentle': '✓ Já está suave',
            'status.moment': '✓ Dê um momento',
            'status.ceiling': '✓ Este preset vai só até aqui',
            'status.quiet': '✓ Em silêncio',
            'card.kicker': '🔐 PRIVADO',
            'card.place': 'Lugar atual',
            'card.you': 'VOCÊ',
            'card.her': 'ELA',
            'card.thinking': 'Ela está pensando',
            'composer.placeholder': 'Fale em particular…',
            'complete.title': '✓ Momento privado concluído',
            'complete.note': 'Um final tranquilo, sem nenhuma pressão para continuar.',
            'complete.kept': 'Nada deste momento privado foi adicionado aos Históricos.',
            'complete.again': 'Outro momento privado',
            'complete.back': 'Voltar ao Together',
            'mood.playful': 'Brincalhão',
            'mood.tender': 'Terno',
            'texture.quieter': 'Mais calmo',
            'texture.closer': 'Mais perto',
            'soundtrack.fallback': 'Música suave de fundo',
            'soundtrack.player': 'Reprodutor da música privada',
            'choice.opening': 'Me diz o que você tinha em mente.',
            'choice.likeHere': 'Gosto de estar aqui.',
            'choice.thisIsGood': 'Assim está bom.',
            'choice.goOn': 'Continua.',
            'choice.goodAnswer': 'Essa é uma boa resposta.',
            'choice.mm': 'Mm.',
            'choice.stillHere': 'Ainda estou aqui.',
            'choice.musicQuiet': 'Essa música combina com o silêncio.',
            'choice.tellMore': 'Me conta mais.',
            'choice.musicSuits': 'Essa música combina com você.',
            'choice.thinking': 'No que você está pensando?',
            'choice.likeHearing': 'Gosto de ouvir você dizer isso.',
            'choice.quiet': '[ficar em silêncio]',
            'choice.askMe': 'Me pergunta uma coisa.',
            'choice.surprise': 'Escolhe você por nós.',
        },
        'ja-JP': {
            'controls.closer': 'もっと近く →',
            'controls.more': 'もっと →',
            'controls.ease': '← ゆっくり',
            'controls.end': '終わる',
            'controls.aria.forward': 'ひとつ強く',
            'controls.aria.ease': 'ひとつ穏やかに',
            'pace.1': 'あたたかい',
            'pace.2': 'ロマンチック',
            'pace.3': '官能的',
            'pace.aria.step': '{total} 段階中 {step} 段階目',
            'status.softened': '✓ ペースをゆるめました',
            'status.eased': '✓ ひとつ戻しました',
            'status.quieter': '✓ より静かに',
            'status.alreadyGentle': '✓ もう充分に穏やかです',
            'status.moment': '✓ 少しだけ待って',
            'status.ceiling': '✓ このプリセットはここまでです',
            'status.quiet': '✓ 静かに',
            'card.kicker': '🔐 プライベート',
            'card.place': '今いる場所',
            'card.you': 'あなた',
            'card.her': '彼女',
            'card.thinking': '考えています',
            'composer.placeholder': '二人だけで話す…',
            'complete.title': '✓ プライベートな時間が終わりました',
            'complete.note': '続ける必要はありません。静かな終わりです。',
            'complete.kept': 'この時間の内容は履歴に残していません。',
            'complete.again': 'もう一度',
            'complete.back': 'Together に戻る',
            'mood.playful': '軽やかに',
            'mood.tender': 'やさしく',
            'texture.quieter': 'より静かに',
            'texture.closer': 'もっと近く',
            'soundtrack.fallback': '静かな音楽',
            'soundtrack.player': 'プライベート音楽プレーヤー',
            'choice.opening': '何を考えていたか教えて。',
            'choice.likeHere': 'ここ、好きだな。',
            'choice.thisIsGood': 'これでいい。',
            'choice.goOn': '続けて。',
            'choice.goodAnswer': 'いい答えだね。',
            'choice.mm': 'うん。',
            'choice.stillHere': 'まだここにいるよ。',
            'choice.musicQuiet': 'この静けさに合う曲だね。',
            'choice.tellMore': 'もっと聞かせて。',
            'choice.musicSuits': 'この曲、君に似合うね。',
            'choice.thinking': '今、何を考えてる？',
            'choice.likeHearing': 'そう言ってくれるの、好きだな。',
            'choice.quiet': '[黙っている]',
            'choice.askMe': '何か聞いて。',
            'choice.surprise': '君が決めて。',
        },
        'ko-KR': {
            'controls.closer': '더 가까이 →',
            'controls.more': '더 →',
            'controls.ease': '← 천천히',
            'controls.end': '끝내기',
            'controls.aria.forward': '한 단계 더 강하게',
            'controls.aria.ease': '한 단계 더 부드럽게',
            'pace.1': '따뜻함',
            'pace.2': '로맨틱',
            'pace.3': '관능적',
            'pace.aria.step': '{total}단계 중 {step}단계',
            'status.softened': '✓ 속도를 늦췄어요',
            'status.eased': '✓ 한 단계 뒤로',
            'status.quieter': '✓ 더 조용히',
            'status.alreadyGentle': '✓ 이미 충분히 부드러워요',
            'status.moment': '✓ 잠시만요',
            'status.ceiling': '✓ 이 프리셋은 여기까지예요',
            'status.quiet': '✓ 조용히',
            'card.kicker': '🔐 프라이빗',
            'card.place': '지금 있는 곳',
            'card.you': '당신',
            'card.her': '그녀',
            'card.thinking': '생각 중이에요',
            'composer.placeholder': '둘이서만 이야기하기…',
            'complete.title': '✓ 프라이빗 시간이 끝났어요',
            'complete.note': '계속해야 할 이유는 없어요. 조용한 마무리입니다.',
            'complete.kept': '이 시간의 내용은 기록에 남지 않았어요.',
            'complete.again': '다시 한 번',
            'complete.back': 'Together로 돌아가기',
            'mood.playful': '장난스럽게',
            'mood.tender': '다정하게',
            'texture.quieter': '더 조용히',
            'texture.closer': '더 가까이',
            'soundtrack.fallback': '잔잔한 배경 음악',
            'soundtrack.player': '프라이빗 음악 플레이어',
            'choice.opening': '무슨 생각이었는지 말해줘.',
            'choice.likeHere': '여기 좋다.',
            'choice.thisIsGood': '이대로 좋아.',
            'choice.goOn': '계속해.',
            'choice.goodAnswer': '좋은 대답이야.',
            'choice.mm': '음.',
            'choice.stillHere': '나 아직 여기 있어.',
            'choice.musicQuiet': '이 고요함에 어울리는 음악이야.',
            'choice.tellMore': '더 얘기해줘.',
            'choice.musicSuits': '이 음악, 너랑 잘 어울려.',
            'choice.thinking': '지금 무슨 생각 해?',
            'choice.likeHearing': '그렇게 말해주는 거 좋아.',
            'choice.quiet': '[말없이 있기]',
            'choice.askMe': '뭐든 물어봐.',
            'choice.surprise': '네가 정해줘.',
        },
        'zh-CN': {
            'controls.closer': '靠近一点 →',
            'controls.more': '再近一点 →',
            'controls.ease': '← 慢一点',
            'controls.end': '结束',
            'controls.aria.forward': '强一档',
            'controls.aria.ease': '柔和一档',
            'pace.1': '温暖',
            'pace.2': '浪漫',
            'pace.3': '感性',
            'pace.aria.step': '第 {step} 档，共 {total} 档',
            'status.softened': '✓ 已放慢节奏',
            'status.eased': '✓ 退回一档',
            'status.quieter': '✓ 更安静',
            'status.alreadyGentle': '✓ 已经够轻柔了',
            'status.moment': '✓ 稍等一下',
            'status.ceiling': '✓ 这个预设到此为止',
            'status.quiet': '✓ 安静',
            'card.kicker': '🔐 私密',
            'card.place': '当前场景',
            'card.you': '你',
            'card.her': '她',
            'card.thinking': '她在想',
            'composer.placeholder': '私下聊聊…',
            'complete.title': '✓ 私密时刻已结束',
            'complete.note': '安静地收尾，不必继续。',
            'complete.kept': '这段私密时刻的内容没有写入历史记录。',
            'complete.again': '再来一次',
            'complete.back': '返回 Together',
            'mood.playful': '俏皮',
            'mood.tender': '温柔',
            'texture.quieter': '更安静',
            'texture.closer': '更近',
            'soundtrack.fallback': '轻柔的背景音乐',
            'soundtrack.player': '私密音乐播放器',
            'choice.opening': '说说你想到了什么。',
            'choice.likeHere': '我喜欢这里。',
            'choice.thisIsGood': '这样就很好。',
            'choice.goOn': '继续说。',
            'choice.goodAnswer': '这个回答很好。',
            'choice.mm': '嗯。',
            'choice.stillHere': '我还在。',
            'choice.musicQuiet': '这音乐配得上这份安静。',
            'choice.tellMore': '再多说一点。',
            'choice.musicSuits': '这音乐很适合你。',
            'choice.thinking': '你在想什么？',
            'choice.likeHearing': '我喜欢听你这么说。',
            'choice.quiet': '[保持安静]',
            'choice.askMe': '问我点什么。',
            'choice.surprise': '你来决定。',
        },
    };

    // British English shares the American pack; the words this file holds do not differ.
    PACKS['en-GB'] = PACKS['en-US'];

    /**
     * The language name, for the one place a prompt has to *say* it.
     *
     * `AppLanguage.directive()` already tells the model which language to answer in, on every path
     * as of this change. This is for Private's own prompt assembly, which does not go through that
     * wrapper — see `privateSystemPromptSuffix`.
     */
    const NAMES = Object.freeze({
        'en-US': 'English',
        'en-GB': 'English',
        'es-ES': 'Spanish',
        'it-IT': 'Italian',
        'fr-FR': 'French',
        'de-DE': 'German',
        'pt-BR': 'Brazilian Portuguese',
        'ja-JP': 'Japanese',
        'ko-KR': 'Korean',
        'zh-CN': 'Chinese (Simplified)',
    });

    /**
     * Which language, right now.
     *
     * Resolved per call rather than cached: the person can change it mid-session from Settings, and
     * a cached pack would leave the card in whatever it opened in. `AppLanguage` is read off the
     * global because it is an IIFE with no `module.exports` — see the header.
     */
    function code(override) {
        if (override && PACKS[override]) return override;
        try {
            const app = global && global.AppLanguage;
            const chosen = app && app.code;
            if (chosen && PACKS[chosen]) return chosen;
        } catch (_) {
            // A page without AppLanguage gets English, which is the same as before this existed.
        }
        return FALLBACK;
    }

    function name(override) {
        return NAMES[code(override)] || NAMES[FALLBACK];
    }

    /**
     * One string.
     *
     * Falls through the chosen pack, then English, then the key itself. The key is deliberately the
     * last resort rather than an empty string: a button reading `controls.closer` is a bug anybody
     * can see and report, and an invisible button is a bug nobody can.
     */
    function t(key, params, override) {
        const wanted = String(key || '');
        const pack = PACKS[code(override)] || PACKS[FALLBACK];
        let text = pack[wanted];
        if (text === undefined) text = PACKS[FALLBACK][wanted];
        if (text === undefined) return wanted;
        if (!params) return text;
        return String(text).replace(/\{(\w+)\}/g, (whole, token) =>
            params[token] === undefined ? whole : String(params[token])
        );
    }

    /** What a pace level is called here. Levels are 1-indexed, as they are everywhere else. */
    function pace(level, override) {
        return t(`pace.${Math.max(1, Math.min(3, Math.round(Number(level) || 1)))}`, null, override);
    }

    /** Every language this file can dress the card in. */
    function languages() {
        return Object.keys(PACKS);
    }

    const api = { PACKS, NAMES, FALLBACK, code, name, t, pace, languages };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_LOCALE = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
