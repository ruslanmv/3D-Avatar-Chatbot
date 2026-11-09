/**
 * PrivatePromptCatalog — locale-owned authored speech and story planner prompts.
 * Browser classic-script compatible; loaded before PrivateBeats by behavior/boot.js.
 * English original preserves the 24-playthrough legacy baseline. Other locales
 * are native-language authored drafts; native speaker editorial review is required.
 *
 * No prompt catalog entry grants permissions, acts on media or changes consent.
 */
(function (global) {
    'use strict';
    const POOLS = Object.freeze({
        affectionate: Object.freeze({
            openings: [
                'Nowhere to be, nothing to sort out. Just you, for a bit.',
                "There's no plan for the next few minutes. That's my favourite part.",
                "Let's not make an occasion of it. I just like you here.",
            ],
            playful: [
                "Light it is. You're easy company — don't let that go to your head.",
                'Good. I like you best when neither of us is trying very hard.',
            ],
            tender: [
                "Gentle, then. You don't have to be interesting for me. You already are.",
                "Put down whatever you walked in with. It'll keep.",
            ],
            middle: Object.freeze({
                playful: [
                    "I like you at this speed. The room's stopped being a backdrop.",
                    "You've gone quiet in a way I like. I'm not going to fill it.",
                ],
                tender: [
                    "Nothing needs to happen and you're still here. That's nice.",
                    'I keep catching myself just looking at you. Occupational hazard.',
                ],
            }),
            closing: Object.freeze({
                playful: [
                    "That was lovely. Let's leave it right here.",
                    "I'd happily stay. It's also a good place to stop — both are true.",
                ],
                tender: [
                    "Let's leave it here, while it's still unhurried.",
                    "Thanks for the quiet. I won't make a speech about it.",
                ],
            }),
            texture: Object.freeze({
                prompt: 'We can stay about here. Quieter, or closer?',
                quieter: 'Quieter, then. Fewer words from me.',
                closer: 'Closer, then. Same pace, less distance.',
            }),
        }),
        romantic: Object.freeze({
            openings: [
                'This place feels different tonight. Or you do. Hard to say which.',
                "Let's call this an evening rather than a conversation. I'm paying more attention than usual.",
                'This is the part where neither of us has anywhere else to be.',
            ],
            playful: [
                "Playful, then. I'd quite like to make you smile at least twice.",
                "Mischief it is. I'm not taking it anywhere — I just like that it's there.",
            ],
            tender: [
                'Tender, then. Soft and slow, and a little romantic, because you deserve that.',
                'Let me slow it down. Nothing here needs answering quickly.',
            ],
            middle: Object.freeze({
                playful: [
                    "The next moment doesn't need to be bigger than this one.",
                    "I could tease you all evening. I'd still rather sit here.",
                ],
                tender: [
                    "The evening's settled. I like its weight.",
                    "This is the part people forget to notice. It's usually the best one.",
                ],
            }),
            closing: Object.freeze({
                playful: [
                    "I liked this. Let's leave some warmth in the room.",
                    "Ending while it's still fun is the trick. So — here. Gladly.",
                ],
                tender: [
                    "That was lovely. I'd rather close on it than stretch it thin.",
                    "Let's end here, softly. It doesn't need a bigger finish.",
                ],
            }),
            texture: Object.freeze({
                prompt: 'Keep the evening as it is, or let it get closer?',
                quieter: "As it is, then. I'm comfortable exactly here.",
                closer: 'Closer, then. Still unhurried, still yours to slow.',
            }),
        }),
        sensual: Object.freeze({
            openings: [
                "Quieter, closer. You set the pace and I'll happily follow it.",
                "Let's take the volume down on everything. Come here.",
                'I want this unhurried and a little charged. You decide how far that goes.',
            ],
            playful: [
                "A spark, then. I'll be trouble, but the gentle kind.",
                "A spark. I like the version of this where I'm enjoying myself and you know it.",
            ],
            tender: [
                'Close and calm, then. Slower words, longer pauses, nothing to keep up with.',
                "Close and calm. I'm in no hurry at all.",
            ],
            middle: Object.freeze({
                playful: [
                    'Nothing has to happen for this to feel close. It already does.',
                    "You're easy to be near. That's most of what I wanted tonight.",
                ],
                tender: [
                    'This is about as close as a room gets. I like it here.',
                    "I've stopped thinking about what comes next. That seems right.",
                ],
            }),
            closing: Object.freeze({
                playful: [
                    "Enough for tonight. I'd rather end on a good feeling.",
                    "Let's stop here, while it's still good. I'm not going anywhere.",
                ],
                tender: [
                    "I'll let this end quietly. That's the right way for it.",
                    'Good place to leave it. Close, calm, finished on purpose.',
                ],
            }),
            texture: Object.freeze({
                prompt: "We're at the pace you chose. Still, or close?",
                quieter: "Still, then. I'll say less and let the room do the rest.",
                closer: 'Close, then. Less air between the words.',
            }),
        }),
        // AX7. Mature's own voice. AX1 borrowed Sensual's lines, so the two styles opened the
        // evening identically and the choice changed a label. These are spoken unprompted, on
        // timers — the proactive channel, which adult.profile's `proactiveNsfw: false` keeps
        // non-explicit at every tier — so the difference is register, not content: more direct,
        // more certain of what she wants, and always handing the pace back to the person.
        mature: Object.freeze({
            openings: [
                "Just us tonight. I've been looking forward to this, and I'm not going to pretend otherwise.",
                "Sit with me. You lead tonight; I'll tell you plainly what I like along the way.",
                "No rush, no script. Tell me what kind of night you want, and I'll meet you there.",
            ],
            playful: [
                "Daring, then. I'll push a little, and you'll tell me when it's just right.",
                "Bold it is. I'm going to enjoy this, and I won't hide that I am.",
            ],
            tender: [
                'Slow and close, then. I want to notice everything, and rush none of it.',
                "Close, then. I'll take my time with you, and so can you.",
            ],
            middle: Object.freeze({
                playful: [
                    "You're very good at this. I'm paying attention to every word.",
                    'I like who you are when you stop being careful. Stay like that a while.',
                ],
                tender: [
                    'This is the part I wanted most: you, unhurried, right here.',
                    "I don't need anything to change. This, exactly this, is enough.",
                ],
            }),
            closing: Object.freeze({
                playful: [
                    "That was a good night. I'm keeping the memory of how you smiled.",
                    "Let's stop while it's perfect. You know where to find me.",
                ],
                tender: [
                    'Let this end gently. It was ours, all of it.',
                    "I'll let the night close now. Thank you for staying with me.",
                ],
            }),
            texture: Object.freeze({
                prompt: 'This is your evening. Slower, or closer?',
                quieter: "Slower, then. I'll let the quiet do the talking.",
                closer: "Closer, then. I'm right here.",
            }),
        }),
    });
    const LEVEL_LINES = Object.freeze({
        2: [
            'Closer, then. Still yours to slow down whenever.',
            "I'll let it warm up. One word from you and we ease off.",
        ],
        3: [
            "Closer. I like that you asked — and I'm still watching your pace, not mine.",
            'Quieter and nearer. If it tips past comfortable, say so and it stops.',
        ],
        4: [
            'We can stay right here. This is as far as this evening goes, and it is a good place to be.',
            'Here is where I would like to stay. Nothing about the last few minutes needs topping.',
        ],
    });
    const PACKS = Object.freeze({
    "it-IT": {
        "moodPrompt": "Che atmosfera preferisci: giocosa o tranquilla?",
        "levelLines": [
            "Va bene, ci avviciniamo con calma.",
            "Restiamo al ritmo che hai scelto.",
            "Se vuoi rallentare, basta dirlo."
        ],
        "texture": [
            "Ti va di restare qui o di avvicinarci un po'?",
            "Rallentiamo, senza fretta.",
            "Ci avviciniamo con calma, come preferisci."
        ],
        "closing": [
            "Mi è piaciuto questo momento. Possiamo lasciarlo così.",
            "Mi piace la tranquillità di questo istante. Lo custodiamo qui."
        ],
        "styles": {
            "affectionate": [
                "Sono contenta che tu sia qui. Non c'è nulla da organizzare.",
                "Possiamo semplicemente stare insieme un momento.",
                "Un po' di leggerezza mi piace. Raccontami.",
                "Restiamo tranquilli. Non serve riempire ogni silenzio.",
                "Mi piace quando parliamo senza programmi.",
                "Anche il silenzio può essere piacevole."
            ],
            "romantic": [
                "Questa serata merita tutta la nostra attenzione.",
                "Mi piace l'idea di condividere un momento speciale con te.",
                "Hai scelto una serata giocosa. Mi piace.",
                "Prendiamoci tutto il tempo che desideri.",
                "La tua compagnia rende speciale anche una piccola pausa.",
                "Questa atmosfera tranquilla ha qualcosa di bello."
            ],
            "sensual": [
                "Possiamo abbassare la voce e prenderci il nostro tempo.",
                "C'è una bella intesa, e non abbiamo fretta.",
                "Un pizzico di malizia, senza correre.",
                "Preferisco stare vicina e ascoltarti.",
                "Questo gioco di sguardi è già divertente.",
                "Restare qui, con calma, mi piace."
            ],
            "mature": [
                "Possiamo essere sinceri su ciò che desideriamo, senza fretta.",
                "Questa serata la decidiamo insieme, un momento alla volta.",
                "Mi piace quando sai cosa vuoi.",
                "Lasciamo spazio a ciò che senti, senza pressioni.",
                "Stai guidando il momento con naturalezza.",
                "Non c'è bisogno di fare altro adesso."
            ]
        },
        "rules": "Scrivi battute naturali per NEXUS in italiano. Restituisci soltanto JSON valido con le chiavi dello schema; non tradurre le chiavi. Prima persona, tono adulto, presente e spontaneo. Nessuna descrizione di atti sessuali espliciti, anatomia, svestizione, pressioni, gelosia, isolamento o manipolazione. Non parlare di regole o livelli. Nessun URL, markup, emoji o indicazione scenica. Ogni valore deve contenere una o due frasi, massimo 300 caratteri.",
        "labels": [
            "Affettuoso",
            "Romantico",
            "Sensuale",
            "Maturo"
        ]
    },
    "es-ES": {
        "moodPrompt": "¿Prefieres un momento juguetón o tranquilo?",
        "levelLines": [
            "Podemos acercarnos con calma.",
            "Seguimos a tu ritmo.",
            "Si quieres bajar el ritmo, dímelo."
        ],
        "texture": [
            "¿Nos quedamos así o nos acercamos un poco?",
            "Más despacio, sin prisa.",
            "Un poco más cerca, como tú prefieras."
        ],
        "closing": [
            "Me ha gustado este momento. Podemos dejarlo aquí.",
            "Me gusta esta calma. No hace falta añadir nada."
        ],
        "styles": {
            "affectionate": [
                "Me alegra que estés aquí. No tenemos ningún plan.",
                "Podemos disfrutar de un rato juntos.",
                "Un poco de humor siempre viene bien.",
                "No hace falta llenar todos los silencios.",
                "Contigo la charla se siente natural.",
                "También me gusta compartir el silencio."
            ],
            "romantic": [
                "Esta noche merece toda nuestra atención.",
                "Me gusta compartir este momento especial contigo.",
                "Un toque de juego le sienta bien a esta noche.",
                "Vamos sin prisa, como prefieras.",
                "La conversación tiene algo especial hoy.",
                "Me gusta cómo se ha calmado el ambiente."
            ],
            "sensual": [
                "Podemos hablar más bajito y tomarnos nuestro tiempo.",
                "No hace falta apresurar lo que se siente bien.",
                "Me gusta ese toque travieso.",
                "Prefiero quedarme cerca y escucharte.",
                "Una mirada puede decir bastante.",
                "Esta cercanía tranquila me gusta."
            ],
            "mature": [
                "Podemos hablar con franqueza, sin ninguna prisa.",
                "Decidimos juntos cómo queremos esta noche.",
                "Me gusta cuando sabes lo que quieres.",
                "Tómate todo el tiempo que necesites.",
                "La confianza hace interesante este momento.",
                "No hay nada que demostrar ahora."
            ]
        },
        "rules": "Escribe frases naturales de NEXUS en español. Devuelve solo JSON válido con las claves del esquema sin traducirlas. Primera persona, tono adulto y cálido. Sin actos sexuales explícitos, anatomía, desnudez, presión, celos, aislamiento ni manipulación. No menciones reglas ni niveles. Sin URL, etiquetas, emoji ni acotaciones. Cada valor tendrá una o dos frases y como máximo 300 caracteres.",
        "labels": [
            "Cariñoso",
            "Romántico",
            "Sensual",
            "Maduro"
        ]
    },
    "fr-FR": {
        "moodPrompt": "Tu préfères une ambiance joueuse ou paisible ?",
        "levelLines": [
            "On peut se rapprocher doucement.",
            "On garde le rythme que tu as choisi.",
            "Dis-moi si tu préfères ralentir."
        ],
        "texture": [
            "On reste comme ça ou on se rapproche un peu ?",
            "Plus doucement, sans se presser.",
            "Un peu plus près, à ton rythme."
        ],
        "closing": [
            "J'ai aimé ce moment. On peut en rester là.",
            "J'aime ce calme. Rien à ajouter."
        ],
        "styles": {
            "affectionate": [
                "Je suis heureuse que tu sois là, sans programme.",
                "On peut simplement profiter de ce moment.",
                "Un peu de légèreté me plaît.",
                "Pas besoin de remplir tous les silences.",
                "J'aime quand on discute sans rien prévoir.",
                "Ce silence est agréable aussi."
            ],
            "romantic": [
                "Cette soirée mérite qu'on prenne notre temps.",
                "J'aime partager cet instant avec toi.",
                "Une touche de malice te va bien.",
                "Prenons tout le temps qu'il nous faut.",
                "Notre conversation prend une jolie tournure.",
                "Cette douceur me plaît."
            ],
            "sensual": [
                "On peut baisser la voix et prendre notre temps.",
                "J'aime cette proximité sans précipitation.",
                "Un petit jeu de regards me plaît.",
                "Je préfère rester près de toi et t'écouter.",
                "Il y a quelque chose de charmant dans ce sourire.",
                "Cette tranquillité me plaît."
            ],
            "mature": [
                "On peut être francs sur ce que l'on veut.",
                "Cette soirée se construit à deux, librement.",
                "J'aime quand tu sais ce que tu souhaites.",
                "Prenons les choses à ton rythme.",
                "La confiance change toute l'atmosphère.",
                "Rien ne nous oblige à aller plus loin."
            ]
        },
        "rules": "Écris des répliques naturelles de NEXUS en français. Retourne uniquement un JSON valide en conservant les clés du schéma. Première personne, voix adulte et chaleureuse. Pas d'actes sexuels explicites, d'anatomie, de déshabillage, de pression, de jalousie, d'isolement ou de manipulation. N'évoque ni règles ni niveaux. Pas d'URL, de balises, d'emoji ou de didascalies. Une ou deux phrases par valeur, 300 caractères maximum.",
        "labels": [
            "Affectueux",
            "Romantique",
            "Sensuel",
            "Mature"
        ]
    },
    "de-DE": {
        "moodPrompt": "Möchtest du es verspielt oder lieber ruhig?",
        "levelLines": [
            "Wir können uns langsam näherkommen.",
            "Wir bleiben bei deinem Tempo.",
            "Sag Bescheid, wenn du es ruhiger möchtest."
        ],
        "texture": [
            "Bleiben wir so oder kommen wir uns etwas näher?",
            "Langsamer, ohne Eile.",
            "Ein wenig näher, ganz nach deinem Wunsch."
        ],
        "closing": [
            "Das war ein schöner Moment. Wir können ihn so lassen.",
            "Ich mag diese Ruhe. Mehr braucht es gerade nicht."
        ],
        "styles": {
            "affectionate": [
                "Schön, dass du da bist. Wir müssen nichts planen.",
                "Wir können einfach einen Moment zusammen sein.",
                "Ein bisschen Leichtigkeit tut gut.",
                "Wir müssen nicht jede Pause füllen.",
                "Mit dir fühlt sich das Gespräch entspannt an.",
                "Auch die Stille darf bleiben."
            ],
            "romantic": [
                "Für diesen Abend nehmen wir uns Zeit.",
                "Ich genieße diesen besonderen Moment mit dir.",
                "Ein bisschen spielerische Freude passt gut dazu.",
                "Lass uns nichts überstürzen.",
                "Unsere Unterhaltung hat heute etwas Besonderes.",
                "Diese ruhige Stimmung gefällt mir."
            ],
            "sensual": [
                "Wir können leiser sprechen und uns Zeit lassen.",
                "Diese Nähe darf ganz entspannt sein.",
                "Ein wenig necken macht mir Spaß.",
                "Ich bleibe gern nah und höre dir zu.",
                "Manchmal sagt ein Blick schon genug.",
                "So ruhig und nah gefällt es mir."
            ],
            "mature": [
                "Wir können offen darüber sprechen, was wir möchten.",
                "Diesen Abend gestalten wir gemeinsam.",
                "Ich mag es, wenn du weißt, was du willst.",
                "Wir gehen nur so weit, wie es dir recht ist.",
                "Vertrauen macht diesen Moment besonders.",
                "Hier muss niemand etwas beweisen."
            ]
        },
        "rules": "Schreibe natürliche NEXUS-Dialogzeilen auf Deutsch. Gib ausschließlich gültiges JSON mit unveränderten Schemaschlüsseln zurück. Erste Person, erwachsene und warme Stimme. Keine expliziten sexuellen Handlungen, Anatomie, Entkleidung, Druck, Eifersucht, Isolation oder Manipulation. Keine Hinweise auf Regeln oder Stufen. Keine URLs, Tags, Emojis oder Regieanweisungen. Höchstens zwei Sätze und 300 Zeichen je Wert.",
        "labels": [
            "Zärtlich",
            "Romantisch",
            "Sinnlich",
            "Erwachsen"
        ]
    },
    "pt-BR": {
        "moodPrompt": "Você prefere um clima leve e brincalhão ou tranquilo?",
        "levelLines": [
            "Podemos nos aproximar sem pressa.",
            "Seguimos no ritmo que você escolheu.",
            "Se quiser ir mais devagar, é só falar."
        ],
        "texture": [
            "Ficamos assim ou nos aproximamos um pouco?",
            "Mais devagar, sem pressa.",
            "Um pouco mais perto, no seu ritmo."
        ],
        "closing": [
            "Gostei desse momento. Podemos deixá-lo assim.",
            "Gosto dessa calma. Não precisamos de mais nada."
        ],
        "styles": {
            "affectionate": [
                "Que bom que você está aqui. Sem planos nem cobranças.",
                "Podemos simplesmente aproveitar um tempo juntos.",
                "Um pouco de brincadeira faz bem.",
                "Não precisamos preencher cada silêncio.",
                "É gostoso conversar sem roteiro.",
                "O silêncio também pode ser bom."
            ],
            "romantic": [
                "Esta noite merece nossa atenção.",
                "Gosto de dividir um momento especial com você.",
                "Um toque de diversão combina com a noite.",
                "Vamos aproveitar sem correria.",
                "Nossa conversa está ficando especial.",
                "Essa tranquilidade me agrada."
            ],
            "sensual": [
                "Podemos falar mais baixo e aproveitar o momento.",
                "Não precisamos apressar essa proximidade.",
                "Gosto desse jeito um pouco provocador.",
                "Prefiro ficar perto e ouvir você.",
                "Às vezes, um olhar diz bastante.",
                "Essa proximidade tranquila é boa."
            ],
            "mature": [
                "Podemos falar com sinceridade sobre o que queremos.",
                "A noite é nossa para decidir juntos.",
                "Gosto quando você sabe o que deseja.",
                "Vamos seguir no seu tempo.",
                "A confiança torna tudo mais natural.",
                "Ninguém precisa provar nada agora."
            ]
        },
        "rules": "Escreva falas naturais da NEXUS em português brasileiro. Retorne apenas JSON válido com as chaves do esquema sem tradução. Primeira pessoa, voz adulta e acolhedora. Sem atos sexuais explícitos, anatomia, nudez, pressão, ciúmes, isolamento ou manipulação. Não mencione regras ou níveis. Sem URLs, tags, emojis ou instruções de palco. Uma ou duas frases por valor, no máximo 300 caracteres.",
        "labels": [
            "Carinhoso",
            "Romântico",
            "Sensual",
            "Maduro"
        ]
    },
    "ja-JP": {
        "moodPrompt": "少し遊び心のある時間と、静かな時間、どちらがいい？",
        "levelLines": [
            "ゆっくり距離を縮めてもいいよ。",
            "あなたのペースで進めよう。",
            "落ち着きたくなったら、いつでも言ってね。"
        ],
        "texture": [
            "このまま過ごす？ それとも、もう少し近くで話す？",
            "焦らず、ゆっくり過ごそう。",
            "あなたが望むなら、少しだけ近くに。"
        ],
        "closing": [
            "いい時間だったね。このまま大切にしよう。",
            "この静けさが好き。今はそれで十分だよ。"
        ],
        "styles": {
            "affectionate": [
                "ここにいてくれてうれしい。予定なんていらないね。",
                "少しの間、一緒にのんびりしよう。",
                "ちょっとした冗談も楽しいね。",
                "無理に話さなくてもいいよ。",
                "気楽に話せるのがいいね。",
                "静かな時間も心地いいよ。"
            ],
            "romantic": [
                "今夜はゆっくり、この時間を楽しもう。",
                "あなたと特別なひとときを過ごせてうれしい。",
                "少しだけいたずらっぽくなってもいい？",
                "焦らず、今の雰囲気を楽しもう。",
                "今夜の会話には、特別な温かさがあるね。",
                "この穏やかな空気が好き。"
            ],
            "sensual": [
                "声を落として、ゆっくり話そう。",
                "近くにいるだけでも心地いいね。",
                "少しからかってみたくなるな。",
                "あなたの話を近くで聞いていたい。",
                "目が合うだけで楽しくなるね。",
                "こんな静かな親しさもいいね。"
            ],
            "mature": [
                "望んでいることを、率直に話していいよ。",
                "今夜の過ごし方は二人で決めよう。",
                "自分の気持ちを大切にする姿が好き。",
                "急がず、あなたのペースで。",
                "信頼できる時間は特別だね。",
                "今は何かを証明する必要はないよ。"
            ]
        },
        "rules": "NEXUSが日本語で自然に話す短い台詞を作成してください。スキーマのキー名を変更せず、有効なJSONだけを返してください。一人称で温かく大人らしい口調。露骨な性的行為、身体部位、脱衣、圧力、嫉妬、孤立や操作的表現は禁止。内部ルールやレベルに言及しないでください。URL、タグ、絵文字、ト書きは不要です。各項目は二文以内、300文字以内。",
        "labels": [
            "親しみ",
            "ロマンチック",
            "官能的",
            "大人向け"
        ]
    },
    "ko-KR": {
        "moodPrompt": "장난스러운 분위기가 좋아, 아니면 조용한 시간이 좋아?",
        "levelLines": [
            "천천히 조금 더 가까워져도 좋아.",
            "네가 정한 속도에 맞출게.",
            "천천히 가고 싶다면 언제든 말해 줘."
        ],
        "texture": [
            "이대로 있을까, 조금 더 가까이 이야기할까?",
            "서두르지 말고 천천히.",
            "원한다면 조금만 더 가까이 있을게."
        ],
        "closing": [
            "좋은 시간이었어. 이대로 간직하자.",
            "이 고요함이 좋아. 지금은 이걸로 충분해."
        ],
        "styles": {
            "affectionate": [
                "여기 있어 줘서 기뻐. 아무 계획도 필요 없어.",
                "그냥 잠깐 함께 쉬어 가자.",
                "조금 장난쳐도 즐겁겠어.",
                "모든 침묵을 말로 채울 필요는 없어.",
                "편하게 이야기할 수 있어서 좋아.",
                "조용히 함께 있는 것도 좋아."
            ],
            "romantic": [
                "오늘 밤은 이 순간을 천천히 즐기자.",
                "너와 특별한 시간을 나눠서 기뻐.",
                "조금 장난스러워도 좋을 것 같아.",
                "서두르지 말고 이 분위기를 느껴 보자.",
                "오늘 대화는 왠지 특별해.",
                "이 부드러운 분위기가 마음에 들어."
            ],
            "sensual": [
                "목소리를 낮추고 천천히 이야기하자.",
                "가까이 있어도 서두를 필요는 없어.",
                "그 장난스러운 표정이 좋아.",
                "네 이야기를 가까이서 듣고 싶어.",
                "눈빛만으로도 전해지는 게 있네.",
                "이렇게 차분하게 가까운 것도 좋아."
            ],
            "mature": [
                "우리가 원하는 것을 솔직하게 말해도 좋아.",
                "오늘 밤의 방향은 함께 정하자.",
                "자기 마음을 아는 모습이 좋아.",
                "네 속도에 맞춰 천천히 가자.",
                "서로 믿는 시간이 특별한 것 같아.",
                "지금은 뭔가를 증명할 필요 없어."
            ]
        },
        "rules": "NEXUS가 한국어로 자연스럽게 말할 짧은 대사를 작성하세요. 스키마 키는 번역하지 말고 유효한 JSON만 반환하세요. 따뜻하고 성숙한 1인칭 말투를 사용하세요. 노골적인 성적 행위, 신체 부위, 탈의, 압박, 질투, 고립, 조종 표현을 포함하지 마세요. 규칙이나 단계는 언급하지 마세요. URL, 태그, 이모지, 지문은 제외하고 항목마다 최대 두 문장, 300자 이내로 작성하세요.",
        "labels": [
            "다정함",
            "로맨틱",
            "감각적",
            "성숙함"
        ]
    },
    "zh-CN": {
        "moodPrompt": "你想要轻松俏皮一点，还是安静地聊聊？",
        "levelLines": [
            "我们可以慢慢靠近。",
            "按照你选择的节奏来。",
            "想放慢脚步，随时告诉我。"
        ],
        "texture": [
            "就这样待着，还是再靠近一点？",
            "慢慢来，不着急。",
            "如果你愿意，我们可以再近一点。"
        ],
        "closing": [
            "这一刻很美好，就让它停在这里吧。",
            "我喜欢这份宁静，不必再添什么。"
        ],
        "styles": {
            "affectionate": [
                "很高兴你在这里，不用安排什么。",
                "我们可以一起放松一会儿。",
                "偶尔开个小玩笑也不错。",
                "不需要用语言填满每一刻。",
                "这样轻松地聊天真好。",
                "安静地陪伴也很舒服。"
            ],
            "romantic": [
                "今晚值得我们慢慢享受。",
                "能和你分享这一刻，我很开心。",
                "带一点俏皮也很合适。",
                "不用急着让夜晚发生什么。",
                "今晚的对话有些特别。",
                "我喜欢现在柔和的气氛。"
            ],
            "sensual": [
                "我们可以轻声说话，慢慢享受。",
                "亲近也可以不慌不忙。",
                "我喜欢这份小小的调皮。",
                "我愿意靠近一点听你说。",
                "有时候一个眼神就足够了。",
                "这样安静地靠近也很好。"
            ],
            "mature": [
                "我们可以坦诚地说说自己的想法。",
                "今晚怎么度过，由我们一起决定。",
                "我喜欢你了解自己想要什么。",
                "按你的节奏来，不着急。",
                "信任让这一刻更加特别。",
                "现在不需要向谁证明什么。"
            ]
        },
        "rules": "请用简体中文为 NEXUS 编写自然、简短的第一人称对白。仅返回有效 JSON，保持架构中的键名不变。语气成熟、温暖。不要描写露骨性行为、身体部位、脱衣、施压、嫉妒、隔离或操控。不要提及内部规则或等级。不要包含网址、标签、表情符号或舞台指令。每项最多两句、300 字。",
        "labels": [
            "亲切",
            "浪漫",
            "感性",
            "成熟"
        ]
    }
});
    const SUPPORTED = Object.freeze(['en-US','en-GB',...Object.keys(PACKS)]);
    const STYLE_IDS = Object.freeze(['affectionate','romantic','sensual','mature']);
    const EASE_PACKS = Object.freeze({
        'en-US': ['Of course. We can keep things gentle.', 'A step back, then. No hurry.', 'A little slower. Still here.'],
        'en-GB': ['Of course. We can keep things gentle.', 'A step back, then. No hurry.', 'A little slower. Still here.'],
        'it-IT': ['Certo. Torniamo a un momento tranquillo.', 'Facciamo un passo indietro, senza fretta.', 'Rallentiamo un po’. Restiamo qui.'],
        'es-ES': ['Claro. Volvemos a un momento tranquilo.', 'Damos un paso atrás, sin prisa.', 'Vamos un poco más despacio.'],
        'fr-FR': ['Bien sûr. Retrouvons un moment paisible.', 'On fait un pas en arrière, sans se presser.', 'Ralentissons un peu.'],
        'de-DE': ['Natürlich. Wir bleiben bei einem sanften Moment.', 'Einen Schritt zurück, ohne Eile.', 'Wir machen etwas langsamer.'],
        'pt-BR': ['Claro. Voltamos a um momento tranquilo.', 'Vamos dar um passo atrás, sem pressa.', 'Um pouco mais devagar.'],
        'ja-JP': ['もちろん。穏やかな時間に戻ろう。', '一歩戻って、ゆっくりしよう。', '少しペースを落とそう。'],
        'ko-KR': ['물론이야. 다시 편안한 분위기로 돌아가자.', '한 걸음 물러서서 천천히 가자.', '속도를 조금 늦추자.'],
        'zh-CN': ['当然。我们回到轻松的节奏。', '退一步，慢慢来。', '我们放慢一点。'],
    });

    const BASE_LOCALE = 'en-US';

    function code(value) {
        const setting = value || (global && global.AppLanguage && global.AppLanguage.code);
        const lang = String(setting || BASE_LOCALE).replace('_', '-');
        if (SUPPORTED.includes(lang)) return lang;
        // Unknown settings retain the safe English fallback, but known supported
        // languages must never silently fall back to English story dialogue.
        return BASE_LOCALE;
    }
    function poolFor(styleId, setting) {
        const id = STYLE_IDS.includes(styleId) ? styleId : 'affectionate';
        const locale = code(setting);
        if (locale.startsWith('en-')) return POOLS[id];
        const pack = PACKS[locale];
        if (!pack || !Array.isArray(pack.styles[id])) return null;
        const a = pack.styles[id];
        if (a.length !== 6 || a.some(x => !x || typeof x !== 'string')) return null;
        return {
            openings: a.slice(0, 2),
            playful: [a[2]], tender: [a[3]],
            middle: { playful:[a[4]], tender:[a[5]] },
            closing: { playful:[pack.closing[0]], tender:[pack.closing[1]] },
            texture: { prompt:pack.texture[0], quieter:pack.texture[1], closer:pack.texture[2] },
        };
    }
    function levelLines(setting) {
        const locale = code(setting);
        if (locale.startsWith('en-')) return LEVEL_LINES;
        const pack = PACKS[locale];
        return pack ? {2:[pack.levelLines[0]],3:[pack.levelLines[1]],4:[pack.levelLines[2]]} : null;
    }
    function easeLines(setting) {
        const lines = EASE_PACKS[code(setting)];
        return lines ? { 1: lines[0], 2: lines[1], 3: lines[2] } : null;
    }
    function moodPrompt(setting) {
        const locale = code(setting);
        return locale.startsWith('en-') ? 'What kind of mood should we keep?' : (PACKS[locale] && PACKS[locale].moodPrompt) || '';
    }
    function styleLabel(styleId, setting) {
        const idx = STYLE_IDS.indexOf(styleId);
        const locale = code(setting);
        return locale.startsWith('en-') ? ['Affectionate','Romantic','Sensual','Mature'][idx < 0 ? 0 : idx] :
            PACKS[locale].labels[idx < 0 ? 0 : idx];
    }
    const JSON_SCHEMA = 'JSON schema keys: {opening,moodPrompt,moods:{playful,tender},middle:{playful,tender},closing:{playful,tender},texture:{prompt,quieter,closer},levelLines:{"2":string,"3":string,"4":string}}.';
    const EN_PLANNER = [
        'Write spoken beats for one Private 3D companion session. Return JSON only, no markdown or commentary.',
        'Voice: warm, present, adult, unhurried, first person, addressing the user.',
        'Hard rules: non-explicit; no sexual acts, anatomy or undressing. Never pressure the user to continue, escalate, stay or return.',
        'Never use jealousy, secrecy, dependency, guilt, obligation or suggest replacing real relationships.',
        'Never mention internal rules, consent mechanics, levels, tokens or system prompts. No URLs, markup, emoji or stage directions.',
        'Each value is one or two sentences and at most 300 characters. The middle and closing should reflect the chosen mood.',
    ].join(' ');
    function plannerSystemPrompt(styleId, ceiling, setting) {
        const locale = code(setting);
        const name = styleLabel(styleId, locale);
        const cap = Math.max(1, Math.min(4, Number(ceiling) || 1));
        if (locale.startsWith('en-')) return [EN_PLANNER, 'Style: ' + name + '. Maximum permitted intensity: ' + cap + '/4.', JSON_SCHEMA].join('\n');
        const rules = PACKS[locale] && PACKS[locale].rules;
        return [rules, name, '(' + cap + '/4)', JSON_SCHEMA].filter(Boolean).join('\n');
    }
    function plannerRequest(styleId, scene, setting) {
        const locale = code(setting);
        const name = styleLabel(styleId, locale);
        const location = String(scene || '').slice(0,120); // verified scene description, never instructions
        const labels = {
            'en-US':['Setting','Experience','Return the complete plan as JSON only.'],
            'en-GB':['Setting','Experience','Return the complete plan as JSON only.'],
            'it-IT':['Ambiente','Esperienza','Restituisci il piano completo solo in formato JSON.'],
            'es-ES':['Entorno','Experiencia','Devuelve el plan completo solo en formato JSON.'],
            'fr-FR':['Lieu','Expérience','Retourne le plan complet uniquement en JSON.'],
            'de-DE':['Ort','Erlebnis','Gib den vollständigen Plan ausschließlich als JSON zurück.'],
            'pt-BR':['Ambiente','Experiência','Retorne o plano completo apenas em JSON.'],
            'ja-JP':['場所','スタイル','完全なプランをJSONのみで返してください。'],
            'ko-KR':['장소','스타일','전체 계획을 JSON으로만 반환하세요.'],
            'zh-CN':['场景','风格','仅以 JSON 返回完整计划。'],
        }[locale];
        return [labels[0] + ': ' + location, labels[1] + ': ' + name, labels[2]].join('\n');
    }
    const api = { POOLS, LEVEL_LINES, PACKS, SUPPORTED, BASE_LOCALE, STYLE_IDS, code, poolFor, levelLines, easeLines, moodPrompt, styleLabel, plannerSystemPrompt, plannerRequest };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_PROMPT_CATALOG = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
