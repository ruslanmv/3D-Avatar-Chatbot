/**
 * Playground templates (PG1) — what there is to do in a place, as data.
 *
 * A world in `assets/vr-worlds/worlds.json` is where you are; a template here is the four or so
 * things it makes sense to do there, shown as chips while that world is up (see
 * `PlaygroundInteractionRouter`). The two are kept apart on purpose. The world catalogue is read
 * by the engine and decides what can load where (tiers, triangles, ratings, the light stand-ins);
 * a template only ever reacts to the world the engine already chose, and has no way to choose
 * one. So nothing written here can open a room, and in particular nothing here can open a
 * private one: a private template is offered only after the engine reports a private world shown
 * at the Private experience's request (`owner: 'intimate'`), which is the VW3 rule restated at
 * this layer rather than trusted from the one below.
 *
 * Every action is an existing system, named, with no new capability behind it:
 *
 *   say          one line sent as the person's turn, through the conversation surface — the same
 *                pipeline typed text takes (prompt, provider, directives, persistence). A tapped
 *                chip is the person's choice, like a dialogue option (P13); it never carries a
 *                directive tag, which the chat would refuse anyway (a user's tags never run).
 *   clip         one of the shipped animation clips, by a short name from `CLIPS`, played through
 *                `NEXUS_CLIP_LOADER` exactly as Pose Studio plays them. A looping clip is a
 *                toggle.
 *   mood         the next light in the template's `moods` (`PlaygroundMoodPresets`).
 *   timer        a study block of `minutes`, counted in the chip itself; the place stays up.
 *                (Starting the Focus activity would have ended the place: one session at a time.)
 *   pretend-live the stream studio's on-air badge. Pretend, and says so: it draws a label and
 *                opens nothing. Allowed only on a template marked `simulated: true`.
 *
 * Exposes: window.NEXUS_PLAYGROUND_TEMPLATES
 */
(function (global) {
    'use strict';

    const KINDS = Object.freeze(['say', 'clip', 'mood', 'timer', 'pretend-live']);

    /**
     * The clips a chip may play: short name → file in `vendor/animations/manifest.json`. A test
     * checks every file is in the manifest. Nothing outside this table can be asked for.
     */
    const CLIPS = Object.freeze({
        wave: Object.freeze({ file: 'action/action_greeting.bvh', loop: false }),
        bow: Object.freeze({ file: 'action/action_greeting1.bvh', loop: false }),
        dance: Object.freeze({ file: 'dance/dance_rumba.bvh', loop: true }),
        groove: Object.freeze({ file: 'dance/dance_northern_soul_spin.bvh', loop: true }),
    });

    /**
     * Words that have no place in the learning venue. The Academy is for adults learning
     * together, and nothing in it may read as school-age or as a student/teacher scenario — not
     * its title, its card, or a line a chip sends. Checked by `validate` and by a test.
     */
    const LEARNING_BANNED =
        /\b(school ?girls?|school ?boys?|school ?uniforms?|uniforms?|teen(age|ager|s)?|minors?|pupils?|students?|teachers?|detention|headmaster|headmistress|kids?|child(ren)?|underage)\b/i;

    const PREVIEWS = 'assets/vr-worlds/previews/';

    const TEMPLATES = Object.freeze([
        Object.freeze({
            id: 'irish-pub',
            world: 'irish-pub',
            title: 'Irish pub',
            category: 'Social',
            rating: 'general',
            description: 'A warm bar with booths and pendant lamps.',
            image: PREVIEWS + 'irish-pub.webp',
            moods: Object.freeze(['pub-amber', 'cozy-warm']),
            actions: Object.freeze([
                { id: 'cheers', kind: 'say', label: '🍻 Cheers', text: 'Cheers! What shall we drink to tonight?' },
                {
                    id: 'story',
                    kind: 'say',
                    label: '📖 A story',
                    text: 'Tell me a short story, the kind you would hear by a pub fire.',
                },
                { id: 'wave', kind: 'clip', label: '👋 Wave', clip: 'wave' },
                { id: 'light', kind: 'mood', label: '💡 Light' },
            ]),
        }),
        Object.freeze({
            id: 'neon-discoteca',
            world: 'neon-discoteca',
            title: 'Neon discoteca',
            category: 'Nightlife',
            rating: 'general',
            description: 'A club with an LED dance floor and a DJ booth.',
            image: PREVIEWS + 'neon-discoteca.webp',
            moods: Object.freeze(['neon-blue-purple', 'romantic-evening', 'cozy-warm']),
            actions: Object.freeze([
                { id: 'dance', kind: 'clip', label: '💃 Dance', stopLabel: '⏹ Stop dancing', clip: 'dance' },
                { id: 'music', kind: 'say', label: '🎵 Music', text: 'Put on something we can dance to.' },
                { id: 'wave', kind: 'clip', label: '👋 Wave', clip: 'wave' },
                { id: 'light', kind: 'mood', label: '💡 Light' },
            ]),
        }),
        Object.freeze({
            id: 'private-cabaret',
            world: 'private-cabaret',
            title: 'Private cabaret',
            category: 'Private',
            rating: 'private',
            description: 'A stage with curtains and golden footlights, just for two.',
            image: PREVIEWS + 'private-cabaret.webp',
            moods: Object.freeze(['cabaret-gold', 'romantic-evening']),
            actions: Object.freeze([
                { id: 'dance', kind: 'clip', label: '💃 A dance', stopLabel: '⏹ Stop dancing', clip: 'dance' },
                { id: 'bow', kind: 'clip', label: '🎭 Take a bow', clip: 'bow' },
                { id: 'song', kind: 'say', label: '🎤 A song', text: 'Sing me something, softly, from the stage.' },
                { id: 'light', kind: 'mood', label: '💡 Light' },
            ]),
        }),
        Object.freeze({
            id: 'private-stream-studio',
            world: 'private-stream-studio',
            title: 'Private stream studio',
            category: 'Private',
            rating: 'private',
            // Pretend, and said so on the card, on the badge and in the note: this is a set, not
            // a broadcast. No camera, microphone, screen capture or upload is involved.
            simulated: true,
            description: 'A pretend streaming set. Nothing is recorded or sent.',
            image: PREVIEWS + 'private-stream-studio.webp',
            moods: Object.freeze(['studio-soft', 'neon-blue-purple', 'romantic-evening']),
            actions: Object.freeze([
                {
                    id: 'live',
                    kind: 'pretend-live',
                    label: '🔴 Pretend show',
                    stopLabel: '⏹ End pretend show',
                },
                { id: 'wave', kind: 'clip', label: '👋 Wave', clip: 'wave' },
                {
                    id: 'chat',
                    kind: 'say',
                    label: '💬 Pretend chat',
                    text: 'Read me our pretend chat: make up three friendly comments from imaginary viewers.',
                },
                { id: 'light', kind: 'mood', label: '💡 Light' },
            ]),
        }),
        Object.freeze({
            id: 'creative-academy',
            world: 'creative-academy',
            title: 'Creative academy',
            category: 'Learning',
            rating: 'general',
            description: 'A bright seminar room with whiteboards, for learning together.',
            image: PREVIEWS + 'creative-academy.webp',
            moods: Object.freeze(['classroom-day', 'cozy-warm']),
            actions: Object.freeze([
                {
                    id: 'study',
                    kind: 'timer',
                    label: '⏱️ Study 25 min',
                    stopLabel: '⏹ Stop',
                    minutes: 25,
                    text: "Let's study together for 25 minutes. Help me keep on track.",
                },
                {
                    id: 'quiz',
                    kind: 'say',
                    label: '❓ Quiz me',
                    text: 'Quiz me with three questions on what I am learning.',
                },
                {
                    id: 'explain',
                    kind: 'say',
                    label: '🧠 Explain',
                    text: 'Explain the idea I am working on as simply as you can, step by step.',
                },
                { id: 'light', kind: 'mood', label: '💡 Light' },
            ]),
        }),
    ]);

    /** Every piece of text a template shows or sends, for the checks below. Pure. */
    function textOf(template) {
        const parts = [template.title, template.description, template.category];
        for (const a of template.actions || []) parts.push(a.label, a.stopLabel, a.text);
        return parts.filter(Boolean).join(' \n ');
    }

    /**
     * What is wrong with a set of templates against the world catalogue, as sentences; [] when
     * nothing is. Pure. `worlds` is the validated catalogue's list; `moods` the preset ids.
     */
    function validate(templates, worlds, moods) {
        const problems = [];
        const list = Array.isArray(templates) ? templates : [];
        const byId = new Map((Array.isArray(worlds) ? worlds : []).map((w) => [w.id, w]));
        const moodIds = new Set(Array.isArray(moods) ? moods : []);
        const seen = new Set();
        for (const t of list) {
            const where = `template ${t && t.id}`;
            if (!t || !/^[a-z0-9-]{1,40}$/.test(String(t.id || ''))) {
                problems.push('a template has no usable id');
                continue;
            }
            if (seen.has(t.id)) problems.push(`${where}: duplicate id`);
            seen.add(t.id);
            const world = byId.get(t.world);
            if (!world) problems.push(`${where}: no world ${t.world}`);
            else {
                if (!world.place || world.lightFor) problems.push(`${where}: ${t.world} is not a place by name`);
                if (world.rating !== t.rating)
                    problems.push(`${where}: rated ${t.rating} but its world is ${world.rating}`);
            }
            if (!t.title || !t.description || !t.category)
                problems.push(`${where}: needs a title, description, category`);
            if (String(t.description || '').length > 90) problems.push(`${where}: description longer than one line`);
            const actions = Array.isArray(t.actions) ? t.actions : [];
            if (!actions.length || actions.length > 4) problems.push(`${where}: needs one to four actions`);
            for (const m of t.moods || []) if (!moodIds.has(m)) problems.push(`${where}: unknown mood ${m}`);
            for (const a of actions) {
                const at = `${where} action ${a && a.id}`;
                if (!a || !KINDS.includes(a.kind)) {
                    problems.push(`${at}: unknown kind ${a && a.kind}`);
                    continue;
                }
                if (!a.label) problems.push(`${at}: no label`);
                if (a.kind === 'say' && !(a.text && a.text.length <= 160))
                    problems.push(`${at}: say needs a short text`);
                if (/<\s*[a-z]+[^>]*>/i.test(String(a.text || ''))) problems.push(`${at}: text carries a tag`);
                if (a.kind === 'clip' && !CLIPS[a.clip]) problems.push(`${at}: unknown clip ${a.clip}`);
                if (a.kind === 'mood' && !(t.moods && t.moods.length)) problems.push(`${at}: no moods to cycle`);
                if (a.kind === 'timer' && !(a.minutes >= 1 && a.minutes <= 90)) problems.push(`${at}: timer minutes`);
                if (a.kind === 'pretend-live' && t.simulated !== true)
                    problems.push(`${at}: pretend-live only on a simulated template`);
            }
            if (t.category === 'Learning' && LEARNING_BANNED.test(textOf(t)))
                problems.push(
                    `${where}: learning text uses a word reserved against (${textOf(t).match(LEARNING_BANNED)[0]})`
                );
        }
        return problems;
    }

    /**
     * The template for a world the engine reports shown, or null. `detail` is the
     * `nexus-world-shown` event's: a light stand-in reports the world it stands in for as `base`.
     * A private template answers only for a private world shown at the Private experience's own
     * request — never for a guessed id, a general world, or a request anybody else made. Pure.
     */
    function forShown(detail, templates) {
        const d = detail || {};
        if (!d.id) return null;
        const base = String(d.base || d.id);
        const t = (templates || TEMPLATES).find((x) => x.world === base) || null;
        if (!t) return null;
        if (t.rating === 'private' && !(d.rating === 'private' && d.owner === 'intimate')) return null;
        if (t.rating !== 'private' && d.rating === 'private') return null;
        return t;
    }

    /** The venue card for a place's list (Experiences ▸ Visit a place), or null. Pure. */
    function cardFor(worldId, templates) {
        const t = (templates || TEMPLATES).find((x) => x.world === worldId);
        return t ? { image: t.image, category: t.category, description: t.description } : null;
    }

    const api = { TEMPLATES, KINDS, CLIPS, LEARNING_BANNED, validate, forShown, cardFor, textOf };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PLAYGROUND_TEMPLATES = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
