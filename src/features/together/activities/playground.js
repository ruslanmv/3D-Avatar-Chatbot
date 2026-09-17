/**
 * Playground — scene-aware, family-safe shared experiences.
 *
 * V1 deliberately exposes one real experience: Scene Tale. Clicking Playground opens the
 * Scene Tale configuration directly; planning is a separate visible phase; playback starts
 * only from the explicit Start story user gesture. The main 3D viewport stays dominant while
 * a small HUD carries narration, choices, pause/end controls and completion actions.
 *
 * This file also owns the separate Private/Intimate Together bridge. The two systems remain
 * independent: Playground is always family-safe; the Private tile follows the user's Settings
 * preference, while starting a Private experience still requires trusted adult verification
 * and the repository's existing ConsentFlow.
 *
 * Exposes:
 *   window.NEXUS_BD_PLAYGROUND
 *   window.NEXUS_BD_INTIMATE
 */
const PlaygroundActivity = (() => {
    'use strict';

    const VERIFY_RETRY_MS = 5000;
    const HISTORY_KEY = 'nexus_playground_histories_v1';
    const MAX_HISTORY = 20;
    const MAX_NODES = 24;
    const FAMILY_BLOCK = /\b(?:porn|pornographic|explicit sex|sexual act|nude|naked|rape|incest|self-harm|suicide|gore)\b/i;

    const SCENE_TALE = Object.freeze({
        id: 'scene-tale',
        label: 'Scene Tale',
        permission: null,
        note: 'A short interactive story inspired by where we are.',
    });

    const INTIMATE_PRESETS = Object.freeze([
        Object.freeze({
            id: 'affectionate',
            label: 'Affectionate',
            permission: null,
            note: 'Warm, close and gentle.',
            maxLevel: 1,
        }),
        Object.freeze({
            id: 'romantic',
            label: 'Romantic',
            permission: null,
            note: 'Romantic conversation and atmosphere.',
            maxLevel: 2,
        }),
        Object.freeze({
            id: 'sensual',
            label: 'Sensual',
            permission: null,
            note: 'A more intimate atmosphere, still consent-gated.',
            maxLevel: 3,
        }),
    ]);

    function globalObject() {
        if (typeof window !== 'undefined') return window;
        return null;
    }

    function busEmit(bus, name, payload) {
        if (bus && typeof bus.emit === 'function') bus.emit(name, payload);
    }

    function safeStorage(win) {
        try {
            return win && win.localStorage ? win.localStorage : typeof localStorage !== 'undefined' ? localStorage : null;
        } catch (_) {
            return null;
        }
    }

    function clamp(value, min, max) {
        const n = Number(value);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
    }

    function cleanText(value, max = 500) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max || 500);
    }

    function safeIdea(value) {
        const idea = cleanText(value, 180);
        if (!idea || FAMILY_BLOCK.test(idea)) return '';
        return idea;
    }

    function slug(value) {
        return cleanText(value, 80)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'story';
    }

    function storyId(title) {
        return `scene-tale-${slug(title)}-${Date.now().toString(36)}`;
    }

    function humanizeScene(scene) {
        const raw = cleanText(scene || '', 100);
        if (!raw) return 'Current scene';
        const words = raw
            .replace(/[._/]+/g, '-')
            .split('-')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
        if (!words.length) return 'Current scene';
        const timeWords = new Set(['Day', 'Night', 'Twilight', 'Sunrise', 'Moonlight', 'Starlight', 'Sunset', 'Dawn', 'Dusk']);
        const last = words[words.length - 1];
        if (words.length > 1 && timeWords.has(last)) return `${words.slice(0, -1).join(' ')} · ${last}`;
        return words.join(' ');
    }

    function currentScene(win) {
        const d = win && win.NEXUS_BD;
        const scene = d && d.blackboard && d.blackboard.scene;
        if (scene && typeof scene === 'object') {
            const id = cleanText(scene.id || scene.sceneId || '', 100);
            const label = cleanText(scene.label || scene.title || '', 120);
            return { id: id || slug(label || 'current-scene'), label: label || humanizeScene(id) };
        }
        const id = cleanText(scene || '', 100) || 'current-scene';
        return { id, label: humanizeScene(id) };
    }

    function addEl(doc, parent, tag, className, text) {
        const el = doc.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined && text !== null) el.textContent = String(text);
        if (parent) parent.appendChild(el);
        return el;
    }

    function button(doc, parent, label, className, onClick) {
        const b = addEl(doc, parent, 'button', className, label);
        b.type = 'button';
        if (onClick) b.addEventListener('click', onClick);
        return b;
    }

    function parseJsonObject(raw) {
        const text = String(raw || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start < 0 || end <= start) throw new Error('Story planner did not return JSON');
        return JSON.parse(text.slice(start, end + 1));
    }

    function normalizeChoice(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const id = slug(raw.id || raw.label || 'choice');
        const label = cleanText(raw.label, 60);
        const next = cleanText(raw.next, 80);
        if (!label || !next) return null;
        return { id, label, next };
    }

    /** Validate and normalize a complete deterministic StoryPlan. */
    function validateStoryPlan(raw, context = {}) {
        if (!raw || typeof raw !== 'object') return { ok: false, why: 'StoryPlan must be an object' };
        const title = cleanText(raw.title, 90);
        const startNode = cleanText(raw.startNode || raw.start || '', 80);
        const nodesRaw = raw.nodes;
        if (!title || !startNode || !nodesRaw || typeof nodesRaw !== 'object' || Array.isArray(nodesRaw)) {
            return { ok: false, why: 'StoryPlan is missing title, startNode, or nodes' };
        }
        const keys = Object.keys(nodesRaw);
        if (!keys.length || keys.length > MAX_NODES) return { ok: false, why: 'StoryPlan has an invalid node count' };
        if (!Object.prototype.hasOwnProperty.call(nodesRaw, startNode)) return { ok: false, why: 'StoryPlan startNode is missing' };

        const nodes = {};
        let choiceCount = 0;
        const allText = [title];
        for (const key of keys) {
            const id = cleanText(key, 80);
            const node = nodesRaw[key];
            if (!id || !node || typeof node !== 'object') return { ok: false, why: `Invalid node ${key}` };
            const type = cleanText(node.type, 30).toLowerCase();
            if (type === 'narration') {
                const text = cleanText(node.text, 900);
                const next = cleanText(node.next, 80);
                if (!text || !next) return { ok: false, why: `Narration ${id} is incomplete` };
                allText.push(text);
                nodes[id] = {
                    type,
                    text,
                    next,
                    pauseAfterMs: clamp(node.pauseAfterMs || 600, 0, 5000),
                };
            } else if (type === 'choice') {
                const prompt = cleanText(node.prompt, 180);
                const options = Array.isArray(node.options) ? node.options.map(normalizeChoice).filter(Boolean) : [];
                if (!prompt || options.length < 2 || options.length > 3) return { ok: false, why: `Choice ${id} is incomplete` };
                choiceCount += 1;
                allText.push(prompt, ...options.map((x) => x.label));
                nodes[id] = { type, prompt, options };
            } else if (type === 'end') {
                const text = cleanText(node.text, 500);
                if (text) allText.push(text);
                nodes[id] = { type, text };
            } else {
                return { ok: false, why: `Unsupported node type: ${type || 'empty'}` };
            }
        }
        if (choiceCount !== 2) return { ok: false, why: 'Scene Tale V1 requires exactly two choices' };
        if (allText.some((text) => FAMILY_BLOCK.test(text) || /https?:\/\//i.test(text))) {
            return { ok: false, why: 'StoryPlan contains content outside the family-safe plan contract' };
        }
        for (const [id, node] of Object.entries(nodes)) {
            if (node.type === 'narration' && !nodes[node.next]) return { ok: false, why: `Node ${id} points to missing ${node.next}` };
            if (node.type === 'choice') {
                for (const opt of node.options) if (!nodes[opt.next]) return { ok: false, why: `Choice ${id} points to missing ${opt.next}` };
            }
        }

        const visiting = new Set();
        const visited = new Set();
        function walk(id) {
            if (visited.has(id)) return true;
            if (visiting.has(id)) return false;
            visiting.add(id);
            const node = nodes[id];
            const nexts = node.type === 'narration' ? [node.next] : node.type === 'choice' ? node.options.map((x) => x.next) : [];
            for (const next of nexts) if (!walk(next)) return false;
            visiting.delete(id);
            visited.add(id);
            return true;
        }
        if (!walk(startNode)) return { ok: false, why: 'StoryPlan contains a cycle' };

        const sceneId = cleanText(context.sceneId || raw.sceneId || 'current-scene', 100);
        const sceneLabel = cleanText(context.sceneLabel || raw.sceneLabel || humanizeScene(sceneId), 120);
        const durationSec = clamp(raw.durationSec || 300, 180, 420);
        const musicQuery = cleanText(raw.music && raw.music.query ? raw.music.query : context.musicQuery || '', 160);
        const plan = {
            version: 1,
            id: cleanText(raw.id, 120) || storyId(title),
            title,
            sceneId,
            sceneLabel,
            fiction: true,
            audience: 'family',
            durationSec,
            startNode,
            nodes,
            music: { enabled: Boolean(context.musicEnabled), query: musicQuery },
        };
        return { ok: true, plan };
    }

    function fallbackStory(scene, idea, musicEnabled) {
        const seed = safeIdea(idea);
        const isLetter = /letter|message|note/i.test(seed);
        const title = isLetter ? 'The Letter at the Last Light' : seed ? 'The Story the Light Remembered' : 'The Light That Stayed';
        const place = scene.label;
        const hook = seed ? `Tonight, one small thought follows us into ${place}: ${seed}.` : `Tonight, ${place} feels as if it has been waiting for one quiet story.`;
        const raw = {
            version: 1,
            id: storyId(title),
            title,
            sceneId: scene.id,
            sceneLabel: scene.label,
            durationSec: 300,
            startNode: 'opening',
            music: { query: `${place} gentle cinematic instrumental ambient` },
            nodes: {
                opening: {
                    type: 'narration',
                    text: `${hook} The air is calm enough that every distant sound seems deliberate. I want to imagine that long before we arrived, somebody came here at the same hour carrying a small decision they had postponed all day. They did not know yet that the place itself would make the choice feel simpler.`,
                    next: 'arrival',
                    pauseAfterMs: 900,
                },
                arrival: {
                    type: 'narration',
                    text: `Her name was Mira. She walked slowly, not because she was lost, but because she wanted the walk to last. In one hand she carried something folded small enough to hide in her palm. In the other, nothing at all. That empty hand mattered: it meant she had come prepared to let something go.`,
                    next: 'choice-one',
                    pauseAfterMs: 1000,
                },
                'choice-one': {
                    type: 'choice',
                    prompt: 'What do you think Mira was carrying?',
                    options: [
                        { id: 'confession', label: 'A confession', next: 'confession' },
                        { id: 'goodbye', label: 'A goodbye', next: 'goodbye' },
                    ],
                },
                confession: {
                    type: 'narration',
                    text: `A confession. Not a dramatic one, just the kind that becomes heavier every day it stays unsaid. Mira had written that she missed someone, that pride had kept her quiet, and that being honest now mattered more than being perfectly understood. She read the first line twice, smiled at how frightened the handwriting looked, and kept walking.`,
                    next: 'middle',
                    pauseAfterMs: 1100,
                },
                goodbye: {
                    type: 'narration',
                    text: `A goodbye. Not angry, and not final in the cruel sense. Mira had written thanks for a season of her life that had ended before either person admitted it. The words were gentle because the memory deserved gentleness. She read the first line twice, noticed her shoulders loosen, and kept walking.`,
                    next: 'middle',
                    pauseAfterMs: 1100,
                },
                middle: {
                    type: 'narration',
                    text: `At the quietest point in ${place}, she stopped. Nothing magical happened. No sign appeared. The world simply continued: light changing, air moving, distant sounds arriving and fading. And because nothing demanded an answer, Mira finally heard the answer she had been covering with noise. The message was not really about the other person. It was about who she wanted to be after sending it.`,
                    next: 'quiet',
                    pauseAfterMs: 1800,
                },
                quiet: {
                    type: 'narration',
                    text: `So she sat for a while and let herself do absolutely nothing. That was the strange luxury of the evening. For a few breaths there was no past to repair and no future to predict. Only this place, this moment, and a folded piece of paper waiting without impatience.`,
                    next: 'choice-two',
                    pauseAfterMs: 1800,
                },
                'choice-two': {
                    type: 'choice',
                    prompt: 'What should Mira do with the message?',
                    options: [
                        { id: 'send', label: 'Send it tonight', next: 'send' },
                        { id: 'keep', label: 'Keep it for herself', next: 'keep' },
                    ],
                },
                send: {
                    type: 'narration',
                    text: `She decided to send it tonight. Not because she expected a particular reply, but because the message was true and she was tired of asking fear to edit the truth. She took out her phone, copied the words carefully, and pressed send before she could turn honesty back into another plan for tomorrow.`,
                    next: 'finale',
                    pauseAfterMs: 1200,
                },
                keep: {
                    type: 'narration',
                    text: `She decided to keep it. Writing the message had already done its work. The page had shown her what she felt, and she did not owe every feeling an audience. She folded it once more, but this time it felt less like a secret and more like a small record of the person she had been that evening.`,
                    next: 'finale',
                    pauseAfterMs: 1200,
                },
                finale: {
                    type: 'narration',
                    text: `Before leaving, Mira looked back at ${place}. She knew the place had not solved anything for her. It had only made enough quiet for her own answer to become audible. Years later, she would remember almost none of the exact words she had written. She would remember the light, the pause, and the relief of choosing deliberately. Maybe that is why some places stay with us: they become the background of a moment when we finally hear ourselves clearly.`,
                    next: 'end',
                    pauseAfterMs: 2500,
                },
                end: {
                    type: 'end',
                    text: 'We can leave the story here for a few seconds. No need to add anything to it.',
                },
            },
        };
        return validateStoryPlan(raw, {
            sceneId: scene.id,
            sceneLabel: scene.label,
            musicEnabled,
            musicQuery: raw.music.query,
        }).plan;
    }

    function plannerSystemPrompt() {
        return [
            'You create one family-safe interactive Scene Tale for a 3D companion experience.',
            'Return JSON only, no markdown.',
            'The story is explicitly fictional, calm, warm, non-clinical, and suitable for a general audience.',
            'Target about five minutes of spoken narration with breathing room and exactly two choices.',
            'Precompute every branch. Do not ask the model for more text during playback.',
            'Never include URLs, HTML, scripts, sexual content, self-harm, graphic violence, or claims of factual local history.',
            'Schema: {title,durationSec,startNode,music:{query},nodes:{id:{type:"narration",text,next,pauseAfterMs}|{type:"choice",prompt,options:[{id,label,next},{id,label,next}]}|{type:"end",text}}}.',
            'Keep node ids simple. Every path must terminate. Use exactly two choice nodes.',
        ].join(' ');
    }

    class StoryPlanner {
        constructor({ win, bus } = {}) {
            this.win = win || globalObject();
            this.bus = bus || null;
        }

        async prepare({ scene, idea = '', music = 'auto', onProgress } = {}) {
            const safeScene = scene || currentScene(this.win);
            const safeSeed = safeIdea(idea);
            const musicEnabled = music !== 'none';
            const progress = (id) => {
                if (typeof onProgress === 'function') onProgress(id);
                busEmit(this.bus, 'playground:prepare-progress', { step: id });
            };

            progress('scene');
            let plan = null;
            const llm = this.win && this.win._nexusLLM;
            try {
                const settings = llm && typeof llm.getSettings === 'function' ? llm.getSettings() : null;
                if (llm && typeof llm.sendMessage === 'function' && (!settings || settings.provider !== 'none')) {
                    const request = [
                        `Scene id: ${safeScene.id}`,
                        `Scene label: ${safeScene.label}`,
                        `Optional user idea: ${safeSeed || '(none — invent a gentle mystery)'}`,
                        'Write the complete plan now. It is fictional and inspired by the scene, not factual history.',
                    ].join('\n');
                    const raw = await llm.sendMessage(request, plannerSystemPrompt(), []);
                    const parsed = parseJsonObject(raw);
                    const checked = validateStoryPlan(parsed, {
                        sceneId: safeScene.id,
                        sceneLabel: safeScene.label,
                        musicEnabled,
                        musicQuery: parsed && parsed.music && parsed.music.query,
                    });
                    if (checked.ok) plan = checked.plan;
                }
            } catch (error) {
                busEmit(this.bus, 'playground:planner-fallback', { why: String((error && error.message) || error) });
            }

            progress('story');
            if (!plan) plan = fallbackStory(safeScene, safeSeed, musicEnabled);
            progress('choices');

            let soundtrack = null;
            if (musicEnabled) {
                soundtrack = await this._findSoundtrack(plan.music.query || `${safeScene.label} gentle instrumental`);
            }
            progress('music');
            return { plan, soundtrack };
        }

        async _findSoundtrack(query) {
            const discovery = this.win && this.win.NEXUS_DISCOVERY;
            if (!discovery) return null;
            try {
                if (typeof discovery.warm === 'function') await discovery.warm();
                const provider = typeof discovery.forCapability === 'function' ? discovery.forCapability('music.search') : null;
                if (!provider || typeof provider.search !== 'function') return null;
                const found = await provider.search(cleanText(query, 160), { max: 3, kind: 'music' });
                return Array.isArray(found) && found.length ? found[0] : null;
            } catch (_) {
                return null;
            }
        }
    }

    class HistoryStore {
        constructor({ win } = {}) {
            this.win = win || globalObject();
        }

        all() {
            const storage = safeStorage(this.win);
            if (!storage) return [];
            try {
                const parsed = JSON.parse(storage.getItem(HISTORY_KEY) || '[]');
                return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
            } catch (_) {
                return [];
            }
        }

        save(plan, choices = []) {
            const checked = validateStoryPlan(plan, {
                sceneId: plan && plan.sceneId,
                sceneLabel: plan && plan.sceneLabel,
                musicEnabled: Boolean(plan && plan.music && plan.music.enabled),
                musicQuery: plan && plan.music && plan.music.query,
            });
            if (!checked.ok) return false;
            const storage = safeStorage(this.win);
            if (!storage) return false;
            const entry = {
                id: checked.plan.id,
                title: checked.plan.title,
                sceneId: checked.plan.sceneId,
                sceneLabel: checked.plan.sceneLabel,
                durationSec: checked.plan.durationSec,
                fiction: true,
                savedAt: Date.now(),
                choices: Array.isArray(choices) ? choices.slice(0, 2).map((x) => cleanText(x, 60)) : [],
                plan: checked.plan,
            };
            try {
                const next = [entry, ...this.all().filter((x) => x && x.id !== entry.id)].slice(0, MAX_HISTORY);
                storage.setItem(HISTORY_KEY, JSON.stringify(next));
                return true;
            } catch (_) {
                return false;
            }
        }
    }

    class AudioFocusManager {
        constructor({ win, bus } = {}) {
            this.win = win || globalObject();
            this.bus = bus || null;
            this.saved = [];
            this.ducked = false;
        }

        duck() {
            if (this.ducked) return;
            this.ducked = true;
            this.saved = [];
            const doc = this.win && this.win.document;
            if (doc && typeof doc.querySelectorAll === 'function') {
                for (const media of doc.querySelectorAll('audio,video')) {
                    if (!media || media.dataset && media.dataset.storyVoice === 'true') continue;
                    const volume = Number(media.volume);
                    if (!Number.isFinite(volume)) continue;
                    this.saved.push({ media, volume });
                    try {
                        media.volume = Math.min(volume, 0.16);
                    } catch (_) {}
                }
            }
            busEmit(this.bus, 'story:audio-duck', { volume: 0.16 });
        }

        restore() {
            if (!this.ducked) return;
            for (const item of this.saved) {
                try {
                    item.media.volume = item.volume;
                } catch (_) {}
            }
            this.saved = [];
            this.ducked = false;
            busEmit(this.bus, 'story:audio-restore', {});
        }
    }

    const HUD_CSS = `
#nexus-scene-tale-hud{position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147482500;width:min(680px,calc(100vw - 28px));pointer-events:none;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff}
#nexus-scene-tale-hud *{box-sizing:border-box}
.nexus-story-bar,.nexus-story-card{pointer-events:auto;background:rgba(12,15,24,.76);border:1px solid rgba(255,255,255,.14);box-shadow:0 16px 50px rgba(0,0,0,.34);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-radius:16px}
.nexus-story-bar{display:flex;align-items:center;gap:10px;padding:9px 11px;margin-top:8px}.nexus-story-title{font-weight:650;font-size:.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}.nexus-story-time{font-size:.76rem;opacity:.68;font-variant-numeric:tabular-nums}.nexus-story-btn{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:#fff;border-radius:10px;padding:7px 11px;font:inherit;font-size:.78rem;cursor:pointer}.nexus-story-btn:hover,.nexus-story-btn:focus-visible{background:rgba(255,255,255,.15);outline:none}.nexus-story-btn.is-end{opacity:.82}.nexus-story-card{padding:15px 17px;margin-bottom:8px}.nexus-story-caption{font-size:1rem;line-height:1.55;text-wrap:pretty}.nexus-story-choice-title{font-size:.92rem;line-height:1.45;margin-bottom:11px}.nexus-story-options{display:grid;grid-template-columns:1fr 1fr;gap:8px}.nexus-story-option{width:100%;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.1);color:#fff;border-radius:12px;padding:12px;text-align:left;font:inherit;cursor:pointer}.nexus-story-option:hover,.nexus-story-option:focus-visible{background:rgba(255,255,255,.18);outline:none}.nexus-story-complete-title{font-weight:700;font-size:1rem;margin-bottom:5px}.nexus-story-complete-note{font-size:.84rem;opacity:.76;margin-bottom:12px}.nexus-story-complete-actions{display:flex;flex-wrap:wrap;gap:8px}
.nexus-story-setup-label{display:block;font-size:.78rem;opacity:.72;margin:12px 0 5px}.nexus-story-setup-input{width:100%;min-height:72px;resize:vertical;border-radius:11px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:inherit;padding:10px;font:inherit}.nexus-story-radio{display:flex;align-items:center;gap:8px;margin:7px 0;font-size:.88rem}.nexus-story-progress{display:grid;gap:7px;margin:12px 0}.nexus-story-progress-row{font-size:.86rem;opacity:.72}.nexus-story-progress-row.is-done{opacity:1}.nexus-story-ready-meta{font-size:.84rem;opacity:.75;line-height:1.55;margin:8px 0 14px}
@media(max-width:560px){#nexus-scene-tale-hud{width:calc(100vw - 18px);bottom:max(9px,env(safe-area-inset-bottom))}.nexus-story-options{grid-template-columns:1fr}.nexus-story-caption{font-size:.94rem}.nexus-story-bar{gap:6px}.nexus-story-btn{padding:7px 9px}}
`;

    function ensureStoryStyles(doc) {
        if (!doc || doc.getElementById('nexus-scene-tale-styles')) return;
        const style = doc.createElement('style');
        style.id = 'nexus-scene-tale-styles';
        style.textContent = HUD_CSS;
        (doc.head || doc.documentElement).appendChild(style);
    }

    class StoryPlayer {
        constructor({ plan, soundtrack, bus, win, doc, say, audioFocus, history, timingScale = 1, onComplete, onReplay } = {}) {
            this.plan = plan;
            this.soundtrack = soundtrack || null;
            this.bus = bus || null;
            this.win = win || globalObject();
            this.doc = doc || (this.win && this.win.document) || null;
            this.say = say || (this.win && this.win.NEXUS_BD_SAY) || null;
            this.audioFocus = audioFocus || new AudioFocusManager({ win: this.win, bus: this.bus });
            this.history = history || new HistoryStore({ win: this.win });
            this.timingScale = Math.max(0, Number(timingScale) || 0);
            if (timingScale === undefined) this.timingScale = 1;
            this.onComplete = typeof onComplete === 'function' ? onComplete : null;
            this.onReplay = typeof onReplay === 'function' ? onReplay : null;
            this.state = 'idle';
            this.nodeId = null;
            this.startedAt = null;
            this.elapsedBeforePause = 0;
            this.pausedAt = null;
            this.choices = [];
            this.hud = null;
            this.card = null;
            this.caption = null;
            this.timer = null;
            this._generation = 0;
            this._waiters = [];
            this._mediaStarted = false;
        }

        start() {
            const checked = validateStoryPlan(this.plan, {
                sceneId: this.plan && this.plan.sceneId,
                sceneLabel: this.plan && this.plan.sceneLabel,
                musicEnabled: Boolean(this.plan && this.plan.music && this.plan.music.enabled),
                musicQuery: this.plan && this.plan.music && this.plan.music.query,
            });
            if (!checked.ok) return checked;
            this.plan = checked.plan;
            if (!this.doc) return { ok: false, why: 'Scene Tale cannot mount its player' };
            this._generation += 1;
            this.nodeId = this.plan.startNode;
            this.startedAt = Date.now();
            this.state = 'playing';
            this._mount();
            this._startSoundtrack();
            this._ticker();
            busEmit(this.bus, 'playground:story-state', { state: this.state, storyId: this.plan.id });
            Promise.resolve().then(() => this._run(this._generation));
            return { ok: true, why: 'playing' };
        }

        pause() {
            if (this.state !== 'playing' && this.state !== 'waiting-choice') return false;
            this._beforePause = this.state;
            this.state = 'paused';
            this.pausedAt = Date.now();
            try {
                if (this.win && this.win.speechSynthesis && typeof this.win.speechSynthesis.pause === 'function') this.win.speechSynthesis.pause();
            } catch (_) {}
            this._paintBar();
            busEmit(this.bus, 'playground:story-state', { state: this.state, storyId: this.plan.id });
            return true;
        }

        resume() {
            if (this.state !== 'paused') return false;
            if (this.pausedAt) this.elapsedBeforePause += Date.now() - this.pausedAt;
            this.pausedAt = null;
            this.state = this._beforePause || 'playing';
            try {
                if (this.win && this.win.speechSynthesis && typeof this.win.speechSynthesis.resume === 'function') this.win.speechSynthesis.resume();
            } catch (_) {}
            const waiters = this._waiters.splice(0);
            for (const resolve of waiters) resolve();
            this._paintBar();
            busEmit(this.bus, 'playground:story-state', { state: this.state, storyId: this.plan.id });
            return true;
        }

        choose(id) {
            if (this.state !== 'waiting-choice') return false;
            const node = this.plan.nodes[this.nodeId];
            const choice = node && node.type === 'choice' ? node.options.find((x) => x.id === String(id)) : null;
            if (!choice) return false;
            this.choices.push(choice.id);
            this.nodeId = choice.next;
            this.state = 'playing';
            this._clearCard();
            this._paintBar();
            busEmit(this.bus, 'playground:choice', { storyId: this.plan.id, choice: choice.id });
            Promise.resolve().then(() => this._run(this._generation));
            return true;
        }

        end(why = 'user') {
            if (this.state === 'complete' || this.state === 'restoring') return false;
            this._generation += 1;
            this.state = 'ending';
            busEmit(this.bus, 'playground:story-state', { state: this.state, storyId: this.plan.id, why });
            this._finish(why);
            return true;
        }

        detach() {
            this._generation += 1;
            if (this.timer) clearInterval(this.timer);
            this.timer = null;
            this.audioFocus.restore();
            this._stopSoundtrack();
            if (this.hud && this.hud.parentNode) this.hud.parentNode.removeChild(this.hud);
            this.hud = null;
            this.card = null;
        }

        async _run(generation) {
            if (generation !== this._generation || this.state === 'complete' || this.state === 'restoring') return;
            await this._waitIfPaused();
            if (generation !== this._generation) return;
            const node = this.plan.nodes[this.nodeId];
            if (!node) return this._error('Story node is missing');
            if (node.type === 'choice') {
                this.state = 'waiting-choice';
                this._paintChoice(node);
                this._paintBar();
                busEmit(this.bus, 'playground:story-state', { state: this.state, storyId: this.plan.id, nodeId: this.nodeId });
                return;
            }
            if (node.type === 'end') {
                if (node.text) await this._narrate(node.text, generation);
                if (generation === this._generation) this._finish('complete');
                return;
            }
            this.state = 'playing';
            this._paintCaption(node.text);
            this._paintBar();
            await this._narrate(node.text, generation);
            if (generation !== this._generation) return;
            await this._waitIfPaused();
            if (generation !== this._generation) return;
            const pause = Math.max(0, Number(node.pauseAfterMs) || 0) * this.timingScale;
            if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
            if (generation !== this._generation) return;
            this.nodeId = node.next;
            this._clearCard();
            return this._run(generation);
        }

        async _narrate(text, generation) {
            this.audioFocus.duck();
            let unsubscribe = null;
            try {
                const words = cleanText(text, 1000).split(/\s+/).filter(Boolean).length;
                const estimate = Math.max(1200, (words / 2.65) * 1000) * this.timingScale;
                const waits = [];
                if (this.bus && typeof this.bus.on === 'function') {
                    waits.push(new Promise((resolve) => {
                        let done = false;
                        try {
                            unsubscribe = this.bus.on('tts:end', () => {
                                if (done) return;
                                done = true;
                                resolve();
                            });
                        } catch (_) {
                            resolve();
                        }
                    }));
                }
                if (typeof this.say === 'function') {
                    try {
                        const out = this.say(text);
                        if (out && typeof out.then === 'function' && !waits.length) waits.push(Promise.resolve(out).catch(() => null));
                    } catch (_) {}
                }
                waits.push(new Promise((resolve) => setTimeout(resolve, estimate)));
                await Promise.race(waits);
            } finally {
                if (typeof unsubscribe === 'function') unsubscribe();
                if (generation === this._generation) this.audioFocus.restore();
            }
        }

        _waitIfPaused() {
            if (this.state !== 'paused') return Promise.resolve();
            return new Promise((resolve) => this._waiters.push(resolve));
        }

        _mount() {
            ensureStoryStyles(this.doc);
            const old = this.doc.getElementById('nexus-scene-tale-hud');
            if (old && old.parentNode) old.parentNode.removeChild(old);
            this.hud = addEl(this.doc, this.doc.body, 'div', '', '');
            this.hud.id = 'nexus-scene-tale-hud';
            this.hud.setAttribute('aria-live', 'polite');
            this.card = addEl(this.doc, this.hud, 'div', 'nexus-story-card');
            this.card.hidden = true;
            const bar = addEl(this.doc, this.hud, 'div', 'nexus-story-bar');
            this._titleEl = addEl(this.doc, bar, 'span', 'nexus-story-title', this.plan.title);
            this._timeEl = addEl(this.doc, bar, 'span', 'nexus-story-time', '0:00');
            this._pauseBtn = button(this.doc, bar, 'Pause', 'nexus-story-btn', () => {
                if (this.state === 'paused') this.resume();
                else this.pause();
            });
            button(this.doc, bar, 'End', 'nexus-story-btn is-end', () => this.end('user'));
        }

        _paintBar() {
            if (this._pauseBtn) this._pauseBtn.textContent = this.state === 'paused' ? 'Resume' : 'Pause';
        }

        _ticker() {
            if (this.timer) clearInterval(this.timer);
            const paint = () => {
                if (!this._timeEl || !this.startedAt) return;
                const now = this.state === 'paused' && this.pausedAt ? this.pausedAt : Date.now();
                const sec = Math.max(0, Math.floor((now - this.startedAt - this.elapsedBeforePause) / 1000));
                this._timeEl.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
            };
            paint();
            this.timer = setInterval(paint, 1000);
        }

        _paintCaption(text) {
            if (!this.card) return;
            this.card.textContent = '';
            this.card.hidden = false;
            addEl(this.doc, this.card, 'div', 'nexus-story-caption', text);
        }

        _paintChoice(node) {
            if (!this.card) return;
            this.card.textContent = '';
            this.card.hidden = false;
            addEl(this.doc, this.card, 'div', 'nexus-story-choice-title', node.prompt);
            const list = addEl(this.doc, this.card, 'div', 'nexus-story-options');
            for (const option of node.options) {
                const b = button(this.doc, list, option.label, 'nexus-story-option', () => this.choose(option.id));
                b.dataset.choice = option.id;
            }
        }

        _paintComplete() {
            if (!this.card) return;
            this.card.textContent = '';
            this.card.hidden = false;
            addEl(this.doc, this.card, 'div', 'nexus-story-complete-title', this.plan.title);
            addEl(this.doc, this.card, 'div', 'nexus-story-complete-note', 'Story complete · Fictional story inspired by this scene');
            const actions = addEl(this.doc, this.card, 'div', 'nexus-story-complete-actions');
            const save = button(this.doc, actions, 'Save to Histories', 'nexus-story-btn', () => {
                const ok = this.history.save(this.plan, this.choices);
                save.textContent = ok ? 'Saved' : 'Could not save';
                save.disabled = ok;
            });
            button(this.doc, actions, 'Another version', 'nexus-story-btn', () => {
                this.detach();
                if (this.onReplay) this.onReplay();
            });
            button(this.doc, actions, 'Back to Together', 'nexus-story-btn', () => {
                if (this.win && this.win.NEXUS_BD && this.win.NEXUS_BD.togetherPanel) {
                    const panel = this.win.NEXUS_BD.togetherPanel;
                    this.detach();
                    if (panel.active === 'playground' || panel.activeActivity === 'playground') panel.stopActivity('complete');
                    if (typeof panel.open === 'function') panel.open();
                }
            });
        }

        _clearCard() {
            if (!this.card) return;
            this.card.textContent = '';
            this.card.hidden = true;
        }

        _startSoundtrack() {
            if (!this.soundtrack || !this.plan.music || !this.plan.music.enabled || !this.win) return;
            const publisher = this.win.NEXUS_CONVERSATION_PUBLISHER;
            const session = this.win.NEXUS_MEDIA_SESSION;
            try {
                if (session && typeof session.requestPlay === 'function') session.requestPlay(this.soundtrack, { source: 'scene-tale' });
                if (publisher && typeof publisher.publish === 'function') {
                    publisher.publish(this.soundtrack, { doc: this.doc, win: this.win, play: true });
                    this._mediaStarted = true;
                }
            } catch (_) {}
        }

        _stopSoundtrack() {
            if (!this._mediaStarted || !this.win) return;
            const session = this.win.NEXUS_MEDIA_SESSION;
            try {
                if (session && typeof session.stop === 'function') session.stop('scene-tale');
            } catch (_) {}
            this._mediaStarted = false;
        }

        _finish(why) {
            this.state = 'restoring';
            this.audioFocus.restore();
            this._stopSoundtrack();
            if (this.timer) clearInterval(this.timer);
            this.timer = null;
            this.state = 'complete';
            this._paintBar();
            this._paintComplete();
            busEmit(this.bus, 'playground:complete', { storyId: this.plan.id, why, choices: this.choices.slice() });
            if (this.onComplete) this.onComplete({ why, choices: this.choices.slice(), plan: this.plan });
        }

        _error(why) {
            this.state = 'error';
            this.audioFocus.restore();
            busEmit(this.bus, 'playground:error', { storyId: this.plan && this.plan.id, why });
            if (this.card) {
                this.card.hidden = false;
                this.card.textContent = '';
                addEl(this.doc, this.card, 'div', 'nexus-story-complete-title', 'Scene Tale paused');
                addEl(this.doc, this.card, 'div', 'nexus-story-complete-note', why);
            }
        }
    }

    function privatePreferenceOn(spicy) {
        if (!spicy) return false;
        if (typeof spicy.isRequested === 'function') return spicy.isRequested() === true;
        return typeof spicy.isEnabled === 'function' && spicy.isEnabled() === true;
    }

    function privateTileVisibility(spicy) {
        if (!privatePreferenceOn(spicy)) {
            return { ok: false, why: 'Private Mode is disabled in Settings' };
        }
        return { ok: true, why: '' };
    }

    function intimateEligibility(director, spicy) {
        if (!privatePreferenceOn(spicy)) {
            return { ok: false, why: 'Private Mode is disabled in Settings' };
        }
        if (!spicy || typeof spicy.isEnabled !== 'function' || !spicy.isEnabled()) {
            return { ok: false, why: 'trusted adult verification is not ready yet' };
        }
        if (!director || !director.blackboard || director.blackboard.adultVerified !== true) {
            return { ok: false, why: 'trusted adult verification is not ready yet' };
        }
        if (!director.adult || typeof director.adult.enter !== 'function') {
            return { ok: false, why: 'Private consent flow is still loading' };
        }
        return { ok: true, why: '' };
    }

    function requestAdultVerification(director) {
        const session = director && director.session;
        if (!session || typeof session.send !== 'function') return false;
        try {
            return session.send({ v: 1, type: 'adult_verify_request' }) === true;
        } catch (_) {
            return false;
        }
    }

    function ensureAdultFlow(director) {
        if (!director) return null;
        if (director.adult && typeof director.adult.enter === 'function') return director.adult;
        if (!director.blackboard || director.blackboard.adultVerified !== true) return null;
        const win = globalObject();
        const factory = win && win.NEXUS_BD_CONSENT_FLOW;
        const profile = win && win.NEXUS_BD_PROFILE_ADULT;
        if (!factory || typeof factory.attach !== 'function' || !profile) return null;
        try {
            const flow = factory.attach({
                bus: director.bus,
                blackboard: director.blackboard,
                modes: director.modes,
                profile,
                recorder: director.clips,
                say: win.NEXUS_BD_SAY || null,
            });
            if (!flow || typeof flow.enter !== 'function') return null;
            director.adult = flow;
            if (Array.isArray(director.adapters) && !director.adapters.includes(flow)) director.adapters.push(flow);
            return flow;
        } catch (error) {
            console.warn('[BD] Private consent flow could not attach', error);
            return null;
        }
    }

    function lockedPrompt(gate) {
        const why = String((gate && gate.why) || 'trusted adult verification is not ready yet');
        if (/verification/i.test(why)) {
            return 'Private Mode is on. Finishing trusted adult verification…';
        }
        if (/consent flow/i.test(why)) return 'Trusted verification arrived. Preparing Private Mode…';
        return why;
    }

    class Intimate {
        constructor({ bus, adult, capability } = {}) {
            this.__contract = true;
            this.id = 'intimate';
            this.title = 'Private';
            this.icon = '🔐';
            this.order = 85;
            this.bus = bus || null;
            this.adult = adult || null;
            this.capability = typeof capability === 'function' ? capability : () => ({ ok: false, why: 'unavailable' });
            this.active = false;
            this.preset = null;
            this.startedAt = null;
            this._adultMaxDescriptor = null;
        }
        get name() { return 'Private'; }
        get prompt() {
            const gate = this.availability();
            return gate && gate.ok ? 'Choose a private experience.' : lockedPrompt(gate);
        }
        inputs() {
            const gate = this.availability();
            if (!gate || gate.ok === false) return [];
            return INTIMATE_PRESETS.map((preset) => ({ ...preset }));
        }
        availability() { return this.capability(); }
        async start({ input = {} } = {}) {
            if (this.active) return { ok: false, why: 'Private is already running' };
            const gate = this.availability();
            if (!gate || gate.ok === false) return gate || { ok: false, why: 'Private is unavailable' };
            const preset = INTIMATE_PRESETS.find((candidate) => candidate.id === String(input.id || ''));
            if (!preset) return { ok: false, why: `unknown Private preset: ${String(input.id || '')}` };
            if (!this.adult || typeof this.adult.enter !== 'function') return { ok: false, why: 'Private consent flow is unavailable' };
            this._installCeiling(preset.maxLevel);
            const entered = this.adult.enter();
            if (!entered || entered.ok === false) {
                this._restoreCeiling();
                return entered || { ok: false, why: 'adult consent flow refused to enter' };
            }
            this.active = true;
            this.preset = preset.id;
            this.startedAt = Date.now();
            busEmit(this.bus, 'intimate:start', { preset: preset.id, maxLevel: preset.maxLevel, startedAt: this.startedAt });
            return { ok: true, why: preset.id, preset: preset.id, maxLevel: preset.maxLevel };
        }
        stop(why = 'user') {
            const wasActive = this.active || Boolean(this.adult && this.adult.active);
            const preset = this.preset;
            this.active = false;
            this.preset = null;
            this.startedAt = null;
            if (this.adult && this.adult.active && typeof this.adult.exit === 'function') this.adult.exit('hard');
            this._restoreCeiling();
            if (wasActive) busEmit(this.bus, 'intimate:stop', { preset, why });
            return wasActive;
        }
        status() {
            if (!this.active) return null;
            const preset = INTIMATE_PRESETS.find((candidate) => candidate.id === this.preset);
            return { label: preset ? preset.label : 'Private', detail: 'Private' };
        }
        detach() { this.stop('detached'); }
        _installCeiling(maxLevel) {
            if (!this.adult) return;
            if (this._adultMaxDescriptor === null) this._adultMaxDescriptor = Object.getOwnPropertyDescriptor(this.adult, 'maxLevel') || false;
            const profileMax = Number(this.adult.profile && this.adult.profile.escalation && this.adult.profile.escalation.levels) || 4;
            Object.defineProperty(this.adult, 'maxLevel', {
                configurable: true,
                enumerable: false,
                get: () => Math.max(1, Math.min(profileMax, Number(maxLevel) || 1)),
            });
        }
        _restoreCeiling() {
            if (!this.adult || this._adultMaxDescriptor === null) return;
            try {
                delete this.adult.maxLevel;
                if (this._adultMaxDescriptor && this._adultMaxDescriptor !== false) Object.defineProperty(this.adult, 'maxLevel', this._adultMaxDescriptor);
            } catch (_) {}
            this._adultMaxDescriptor = null;
        }
        get stats() { return { active: this.active, preset: this.preset, startedAt: this.startedAt }; }
    }

    function installIntimateBridge({ bus } = {}) {
        if (typeof window === 'undefined') return null;
        let director = null;
        let activity = null;
        let stopped = false;
        let retryTimer = null;
        let verifyTimer = null;
        let unsubscribeSpicy = null;
        let unsubscribePanel = null;
        let unsubscribeAdultExit = null;
        let lastVerified = null;
        let lastVerifyRequestAt = 0;

        const repaint = () => {
            if (director && director.togetherPanel && typeof director.togetherPanel.setContext === 'function') director.togetherPanel.setContext({});
        };
        const mirrorPreference = (requested) => {
            if (director && director.blackboard) director.blackboard.nsfwAllowed = Boolean(requested);
        };
        const maybeRequestVerification = (force = false) => {
            if (!director || !director.blackboard || director.blackboard.adultVerified === true) return false;
            const now = Date.now();
            if (!force && lastVerifyRequestAt && now - lastVerifyRequestAt < VERIFY_RETRY_MS) return false;
            const sent = requestAdultVerification(director);
            if (sent) lastVerifyRequestAt = now;
            return sent;
        };
        const unregister = (why = 'Private Mode disabled') => {
            if (!director || !director.togetherPanel) return;
            const panel = director.togetherPanel;
            const current = panel.activities && panel.activities.get('intimate');
            if (!current) return;
            if ((panel.active === 'intimate' || panel.activeActivity === 'intimate') && typeof panel.stopActivity === 'function') panel.stopActivity(why);
            else if (typeof current.detach === 'function') current.detach();
            if (panel.activities) panel.activities.delete('intimate');
            if (panel.adapted) panel.adapted.delete('intimate');
            if (director.intimate === current) director.intimate = null;
            activity = null;
            repaint();
        };
        const sync = () => {
            if (stopped) return false;
            if (!director) director = window.NEXUS_BD || null;
            if (!director || !director.togetherPanel || !window.NEXUS_SPICY) return false;
            const visible = privateTileVisibility(window.NEXUS_SPICY);
            mirrorPreference(visible.ok);
            if (visible.ok) {
                if (!director.blackboard || director.blackboard.adultVerified !== true) maybeRequestVerification();
                else ensureAdultFlow(director);
                const existing = director.togetherPanel.activities && director.togetherPanel.activities.get('intimate');
                if (!existing) {
                    activity = new Intimate({
                        bus: bus || director.bus,
                        adult: director.adult,
                        capability: () => intimateEligibility(director, window.NEXUS_SPICY),
                    });
                    director.intimate = activity;
                    director.togetherPanel.register(activity);
                    repaint();
                } else {
                    activity = existing;
                    activity.adult = director.adult || activity.adult;
                    director.intimate = existing;
                }
                const gate = intimateEligibility(director, window.NEXUS_SPICY);
                if (!gate.ok && (director.togetherPanel.active === 'intimate' || director.togetherPanel.activeActivity === 'intimate')) {
                    director.togetherPanel.stopActivity(gate.why || 'Private eligibility changed');
                    // Starting an activity closes Together. If trust disappears while it is
                    // running, reopen the chooser so the still-enabled Private preference is
                    // represented by its locked tile rather than by an apparently vanished
                    // destination.
                    if (typeof director.togetherPanel.open === 'function') director.togetherPanel.open();
                }
            } else unregister(visible.why);
            return visible.ok;
        };
        const wire = () => {
            if (stopped) return;
            director = window.NEXUS_BD || null;
            if (!director || !director.togetherPanel || !window.NEXUS_SPICY) {
                retryTimer = setTimeout(wire, 100);
                return;
            }
            lastVerified = Boolean(director.blackboard && director.blackboard.adultVerified);
            sync();
            const preferenceSubscribe =
                typeof window.NEXUS_SPICY.onPreferenceChange === 'function'
                    ? window.NEXUS_SPICY.onPreferenceChange
                    : window.NEXUS_SPICY.onChange;
            if (typeof preferenceSubscribe === 'function') {
                unsubscribeSpicy = preferenceSubscribe((requested) => {
                    mirrorPreference(requested);
                    lastVerifyRequestAt = 0;
                    sync();
                    if (requested) maybeRequestVerification(true);
                });
            }
            if (director.togetherPanel && typeof director.togetherPanel.onChange === 'function') {
                unsubscribePanel = director.togetherPanel.onChange((snapshot) => {
                    if (snapshot && snapshot.open) {
                        sync();
                        if (privatePreferenceOn(window.NEXUS_SPICY)) maybeRequestVerification();
                    }
                });
            }
            const eventBus = bus || director.bus;
            if (eventBus && typeof eventBus.on === 'function') {
                unsubscribeAdultExit = eventBus.on('adult:exit', (event) => {
                    if (event && event.kind === 'hard' && (director.togetherPanel.active === 'intimate' || director.togetherPanel.activeActivity === 'intimate')) {
                        director.togetherPanel.stopActivity('adult exit');
                    }
                });
            }
            verifyTimer = setInterval(() => {
                if (stopped || !director) return;
                const verified = Boolean(director.blackboard && director.blackboard.adultVerified);
                if (verified !== lastVerified) {
                    lastVerified = verified;
                    if (verified) ensureAdultFlow(director);
                    sync();
                    repaint();
                } else if (!verified && window.NEXUS_SPICY && privatePreferenceOn(window.NEXUS_SPICY)) {
                    maybeRequestVerification();
                }
            }, 1000);
        };
        wire();
        return {
            sync,
            detach() {
                stopped = true;
                if (retryTimer) clearTimeout(retryTimer);
                if (verifyTimer) clearInterval(verifyTimer);
                if (unsubscribeSpicy) unsubscribeSpicy();
                if (unsubscribePanel) unsubscribePanel();
                if (unsubscribeAdultExit) unsubscribeAdultExit();
                unregister('detached');
            },
        };
    }

    function installPlaygroundPanelBridge() {
        const win = globalObject();
        const together = win && win.NEXUS_BD_TOGETHER_PANEL;
        const Panel = together && together.Panel;
        if (!Panel || !Panel.prototype || Panel.prototype.__sceneTaleSetupPatched) return false;
        const original = Panel.prototype._paintSetup;
        if (typeof original !== 'function') return false;
        Panel.prototype._paintSetup = function () {
            if (this.pending === 'playground') {
                const activity = this.activities && this.activities.get('playground');
                if (activity && typeof activity.paintSetup === 'function') return activity.paintSetup(this);
            }
            return original.call(this);
        };
        Object.defineProperty(Panel.prototype, '__sceneTaleSetupPatched', { configurable: true, value: true });
        return true;
    }

    class Playground {
        constructor({ bus, planner, playerFactory, win, doc, say, timingScale } = {}) {
            this.__contract = true;
            this.id = 'playground';
            this.title = 'Playground';
            this.icon = '✨';
            this.order = 45;
            this.prompt = 'A little story inspired by this place.';
            this.bus = bus || null;
            this.win = win || globalObject();
            this.doc = doc || (this.win && this.win.document) || null;
            this.say = say || (this.win && this.win.NEXUS_BD_SAY) || null;
            this.planner = planner || new StoryPlanner({ win: this.win, bus: this.bus });
            this.playerFactory = typeof playerFactory === 'function' ? playerFactory : (deps) => new StoryPlayer(deps);
            this.timingScale = timingScale;
            this.history = new HistoryStore({ win: this.win });
            this.active = false;
            this.mode = null;
            this.startedAt = null;
            this.sessionState = 'configure';
            this.idea = '';
            this.musicChoice = 'auto';
            this.preparedPlan = null;
            this.preparedSoundtrack = null;
            this.prepareProgress = new Set();
            this.prepareError = '';
            this.player = null;
            this._prepareToken = 0;
            this._panel = null;
            installPlaygroundPanelBridge();
            this._intimateBridge = installIntimateBridge({ bus: this.bus });
        }

        get name() { return 'Playground'; }
        inputs() { return [{ ...SCENE_TALE }]; }
        availability() { return { ok: true, why: '' }; }

        paintSetup(panel) {
            if (!panel || !panel.root || !panel.doc) return;
            this._panel = panel;
            if (this.sessionState === 'preparing') return this._paintPreparing(panel);
            if (this.sessionState === 'ready') return this._paintReady(panel);
            if (this.sessionState === 'error') return this._paintPrepareError(panel);
            return this._paintConfigure(panel);
        }

        async prepare({ idea = '', music = 'auto' } = {}) {
            const token = ++this._prepareToken;
            this.idea = safeIdea(idea);
            this.musicChoice = music === 'none' ? 'none' : 'auto';
            this.preparedPlan = null;
            this.preparedSoundtrack = null;
            this.prepareProgress = new Set();
            this.prepareError = '';
            this.sessionState = 'preparing';
            this._repaint();
            const scene = currentScene(this.win);
            busEmit(this.bus, 'playground:prepare', { sceneId: scene.id, idea: this.idea, music: this.musicChoice });
            try {
                const result = await this.planner.prepare({
                    scene,
                    idea: this.idea,
                    music: this.musicChoice,
                    onProgress: (step) => {
                        if (token !== this._prepareToken) return;
                        this.prepareProgress.add(step);
                        this._repaint();
                    },
                });
                if (token !== this._prepareToken) return { ok: false, why: 'cancelled' };
                const checked = validateStoryPlan(result && result.plan, {
                    sceneId: scene.id,
                    sceneLabel: scene.label,
                    musicEnabled: this.musicChoice !== 'none',
                    musicQuery: result && result.plan && result.plan.music && result.plan.music.query,
                });
                if (!checked.ok) throw new Error(checked.why);
                this.preparedPlan = checked.plan;
                this.preparedSoundtrack = result && result.soundtrack ? result.soundtrack : null;
                this.sessionState = 'ready';
                this._repaint();
                busEmit(this.bus, 'playground:ready', { storyId: checked.plan.id, title: checked.plan.title });
                return { ok: true, plan: checked.plan };
            } catch (error) {
                if (token !== this._prepareToken) return { ok: false, why: 'cancelled' };
                this.prepareError = cleanText((error && error.message) || error, 240) || 'The story could not be prepared.';
                this.sessionState = 'error';
                this._repaint();
                return { ok: false, why: this.prepareError };
            }
        }

        cancelPrepare() {
            this._prepareToken += 1;
            this.prepareProgress = new Set();
            this.preparedPlan = null;
            this.preparedSoundtrack = null;
            this.prepareError = '';
            this.sessionState = 'configure';
            this._repaint();
            return true;
        }

        async start({ input = {} } = {}) {
            if (this.active) return { ok: false, why: 'Playground is already running' };
            if (String(input.id || '') !== SCENE_TALE.id) return { ok: false, why: `unknown Playground mode: ${String(input.id || '')}` };
            const plan = input.preparedPlan || this.preparedPlan;
            const checked = validateStoryPlan(plan, {
                sceneId: plan && plan.sceneId,
                sceneLabel: plan && plan.sceneLabel,
                musicEnabled: this.musicChoice !== 'none',
                musicQuery: plan && plan.music && plan.music.query,
            });
            if (!checked.ok) return { ok: false, why: 'Create the story before starting it' };
            this._leavePrivateIfNeeded();
            const player = this.playerFactory({
                plan: checked.plan,
                soundtrack: input.soundtrack !== undefined ? input.soundtrack : this.preparedSoundtrack,
                bus: this.bus,
                win: this.win,
                doc: this.doc,
                say: this.say,
                timingScale: this.timingScale,
                history: this.history,
                onComplete: () => {
                    this.sessionState = 'complete';
                },
                onReplay: () => this._anotherVersion(),
            });
            if (!player || typeof player.start !== 'function') return { ok: false, why: 'Scene Tale player is unavailable' };
            const started = player.start();
            if (!started || started.ok === false) return started || { ok: false, why: 'Scene Tale player refused to start' };
            this.player = player;
            this.active = true;
            this.mode = SCENE_TALE.id;
            this.startedAt = Date.now();
            this.sessionState = 'playing';
            busEmit(this.bus, 'playground:start', {
                mode: this.mode,
                audience: 'family',
                storyId: checked.plan.id,
                startedAt: this.startedAt,
            });
            return { ok: true, why: this.mode, mode: this.mode, storyId: checked.plan.id };
        }

        stop(why = 'user') {
            const wasActive = this.active || Boolean(this.player);
            if (this.player) {
                try {
                    if (this.player.state !== 'complete') this.player.end(why);
                    if (why !== 'complete') this.player.detach();
                } catch (_) {}
            }
            this.player = null;
            this.active = false;
            const mode = this.mode;
            this.mode = null;
            this.startedAt = null;
            if (why !== 'complete') this.sessionState = 'configure';
            if (wasActive) busEmit(this.bus, 'playground:stop', { mode, why });
            return wasActive;
        }

        status() {
            if (!this.active) return null;
            const state = this.player && this.player.state ? this.player.state : this.sessionState;
            return { label: 'Scene Tale', detail: state === 'waiting-choice' ? 'Your choice' : state === 'paused' ? 'Paused' : 'Playing' };
        }

        detach() {
            this.cancelPrepare();
            this.stop('detached');
            if (this._intimateBridge) this._intimateBridge.detach();
            this._intimateBridge = null;
        }

        _paintConfigure(panel) {
            const doc = panel.doc;
            const scene = currentScene(this.win);
            addEl(doc, panel.root, 'p', 'nexus-bd-together-subtitle', 'SCENE TALE');
            addEl(doc, panel.root, 'p', 'nexus-bd-together-prompt', 'A little story inspired by this place.');
            addEl(doc, panel.root, 'span', 'nexus-story-setup-label', 'Current place');
            addEl(doc, panel.root, 'p', 'nexus-bd-together-note', scene.label);
            const label = addEl(doc, panel.root, 'label', 'nexus-story-setup-label', 'Give me an idea · optional');
            const area = addEl(doc, panel.root, 'textarea', 'nexus-story-setup-input');
            area.value = this.idea;
            area.maxLength = 180;
            area.placeholder = 'A letter somebody never delivered';
            label.htmlFor = 'nexus-scene-tale-idea';
            area.id = 'nexus-scene-tale-idea';
            addEl(doc, panel.root, 'span', 'nexus-story-setup-label', 'Soundtrack');
            const auto = addEl(doc, panel.root, 'label', 'nexus-story-radio');
            const autoRadio = addEl(doc, auto, 'input');
            autoRadio.type = 'radio';
            autoRadio.name = 'nexus-scene-tale-music';
            autoRadio.value = 'auto';
            autoRadio.checked = this.musicChoice !== 'none';
            addEl(doc, auto, 'span', '', 'Let her choose');
            const none = addEl(doc, panel.root, 'label', 'nexus-story-radio');
            const noneRadio = addEl(doc, none, 'input');
            noneRadio.type = 'radio';
            noneRadio.name = 'nexus-scene-tale-music';
            noneRadio.value = 'none';
            noneRadio.checked = this.musicChoice === 'none';
            addEl(doc, none, 'span', '', 'No music');
            const list = addEl(doc, panel.root, 'div', 'nexus-bd-together-options');
            const create = button(doc, list, 'Create story', 'nexus-bd-together-option', () => {
                create.disabled = true;
                this.prepare({ idea: area.value, music: noneRadio.checked ? 'none' : 'auto' });
            });
            create.dataset.action = 'create-story';
        }

        _paintPreparing(panel) {
            const doc = panel.doc;
            addEl(doc, panel.root, 'p', 'nexus-bd-together-subtitle', 'Creating our story…');
            addEl(doc, panel.root, 'p', 'nexus-bd-together-prompt', 'The scene stays with us while I prepare the whole story before playback.');
            const progress = addEl(doc, panel.root, 'div', 'nexus-story-progress');
            const steps = [
                ['scene', 'Understanding this place'],
                ['story', 'Writing the story'],
                ['choices', 'Preparing your choices'],
                ['music', 'Finding a soundtrack'],
            ];
            for (const [id, label] of steps) {
                const done = this.prepareProgress.has(id);
                addEl(doc, progress, 'div', `nexus-story-progress-row${done ? ' is-done' : ''}`, `${done ? '✓' : '○'} ${label}`);
            }
            const list = addEl(doc, panel.root, 'div', 'nexus-bd-together-options');
            button(doc, list, 'Cancel', 'nexus-bd-together-option is-stop', () => {
                this.cancelPrepare();
                if (typeof panel.open === 'function') panel.open();
            }).dataset.action = 'cancel-story';
        }

        _paintReady(panel) {
            const doc = panel.doc;
            const plan = this.preparedPlan;
            addEl(doc, panel.root, 'p', 'nexus-bd-together-subtitle', plan ? plan.title.toUpperCase() : 'SCENE TALE');
            addEl(doc, panel.root, 'p', 'nexus-bd-together-prompt', 'Fictional story inspired by this scene');
            const soundtrack = this.musicChoice === 'none' ? 'No soundtrack' : this.preparedSoundtrack ? 'Soundtrack ready' : 'No soundtrack found — story will still play';
            addEl(doc, panel.root, 'div', 'nexus-story-ready-meta', `About 5 minutes · 2 choices\n✓ Story ready · ✓ Scene ready · ${soundtrack}`);
            const list = addEl(doc, panel.root, 'div', 'nexus-bd-together-options');
            const start = button(doc, list, 'Start story', 'nexus-bd-together-option', () => {
                start.disabled = true;
                panel.startActivity('playground', {
                    id: SCENE_TALE.id,
                    permission: null,
                    preparedPlan: this.preparedPlan,
                    soundtrack: this.preparedSoundtrack,
                });
            });
            start.dataset.action = 'start-story';
            button(doc, list, 'Create another version', 'nexus-bd-together-option', () => {
                this.sessionState = 'configure';
                this.preparedPlan = null;
                this.preparedSoundtrack = null;
                this._repaint();
            }).dataset.action = 'another-version';
        }

        _paintPrepareError(panel) {
            const doc = panel.doc;
            addEl(doc, panel.root, 'p', 'nexus-bd-together-subtitle', 'Story not ready');
            addEl(doc, panel.root, 'p', 'nexus-bd-together-prompt', this.prepareError || 'The story could not be prepared.');
            const list = addEl(doc, panel.root, 'div', 'nexus-bd-together-options');
            button(doc, list, 'Try again', 'nexus-bd-together-option', () => this.prepare({ idea: this.idea, music: this.musicChoice }));
            button(doc, list, 'Change idea', 'nexus-bd-together-option', () => {
                this.sessionState = 'configure';
                this._repaint();
            });
        }

        _repaint() {
            const panel = this._panel;
            if (panel && panel.pending === 'playground' && panel.open_ !== false && typeof panel._paint === 'function') {
                panel._paint();
                if (typeof panel._announce === 'function') panel._announce();
            }
        }

        _leavePrivateIfNeeded() {
            const director = this.win && this.win.NEXUS_BD;
            if (!director) return;
            try {
                if (director.adult && director.adult.active && typeof director.adult.exit === 'function') director.adult.exit('hard');
            } catch (_) {}
            if (director.blackboard) {
                director.blackboard.activity = 'playground';
                director.blackboard.escalationLevel = 1;
            }
        }

        _anotherVersion() {
            this.stop('complete');
            this.sessionState = 'configure';
            this.preparedPlan = null;
            this.preparedSoundtrack = null;
            const director = this.win && this.win.NEXUS_BD;
            const panel = director && director.togetherPanel;
            if (panel) {
                panel.active = null;
                panel.activeActivity = null;
                panel.pending = 'playground';
                panel.view = 'setup';
                if (typeof panel.open === 'function') panel.open();
                else if (typeof panel._paint === 'function') panel._paint();
            }
        }

        get stats() {
            return {
                active: this.active,
                mode: this.mode,
                startedAt: this.startedAt,
                sessionState: this.sessionState,
                storyId: this.preparedPlan && this.preparedPlan.id,
                playerState: this.player && this.player.state,
            };
        }
    }

    function attach(deps) {
        return new Playground(deps);
    }

    const IntimateActivity = {
        Intimate,
        presets: INTIMATE_PRESETS,
        eligibility: intimateEligibility,
        visibility: privateTileVisibility,
    };

    return {
        attach,
        Playground,
        SCENE_TALE,
        StoryPlanner,
        StoryPlayer,
        HistoryStore,
        AudioFocusManager,
        validateStoryPlan,
        fallbackStory,
        humanizeScene,
        IntimateActivity,
        installIntimateBridge,
        installPlaygroundPanelBridge,
        HISTORY_KEY,
    };
})();

if (typeof window !== 'undefined') {
    window.NEXUS_BD_PLAYGROUND = PlaygroundActivity;
    window.NEXUS_BD_INTIMATE = PlaygroundActivity.IntimateActivity;
    PlaygroundActivity.installPlaygroundPanelBridge();
}
if (typeof module !== 'undefined' && module.exports) module.exports = PlaygroundActivity;
