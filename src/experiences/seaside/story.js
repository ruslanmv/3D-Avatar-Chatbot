/**
 * Seaside Evening — the branching evening, as data (IC3).
 *
 * Two objects and a handful of choices. Touching the shell or the lantern
 * changes the line she says next and the flags that later choices can see.
 * Choosing "watch the tide" and choosing "tell a story" do not meet again
 * until the close, and the close names which one you took.
 *
 * What is persisted is the beat id and the two flags. Not the sentences. The
 * sentences are rebuilt from the beat, so a saved evening cannot carry a
 * transcript in disguise.
 *
 * Exposes: window.NEXUS_SEASIDE_STORY
 */
const SeasideStory = (() => {
    'use strict';

    function initial() {
        return {
            beat: 'welcome',
            shellTouched: false,
            lanternLit: false,
            outcome: '',
            line: lineFor({ beat: 'welcome', shellTouched: false, lanternLit: false, outcome: '' }),
        };
    }

    function lineFor(state) {
        const shell = state.shellTouched ? ' The shell is already in your hand.' : '';
        const light = state.lanternLit ? ' The lantern is lit.' : '';
        switch (state.beat) {
            case 'welcome':
                return 'The terrace is quiet, and the tide is on its way in. We can watch it, or I can tell you about the lantern.';
            case 'tide':
                return 'We watch the water go dark at the edge.' + shell + ' The shell on the table is still warm.';
            case 'story':
                return 'The lantern used to be lit for anyone who arrived late and still found a chair.' + light;
            case 'kept-shell':
                return 'You keep the shell. It is a small thing, and it is yours if you want it remembered.';
            case 'left-shell':
                return 'The shell stays for the next tide. We stay anyway.';
            case 'lantern-lit':
                return (
                    'There. Late arrivals can see the step.' +
                    (state.shellTouched ? ' And you still have the shell.' : '')
                );
            case 'lantern-dark':
                return 'We leave it dark. The water is enough light.';
            case 'your-day':
                return 'Then tell me about today in the chat whenever you want. I am not going anywhere.';
            case 'close':
                return closeLine(state);
            default:
                return 'I am here.';
        }
    }

    function closeLine(state) {
        if (state.outcome === 'kept-shell') return 'We kept the shell and let the tide do the rest.';
        if (state.outcome === 'left-shell') return 'We left the shell and stayed for the water.';
        if (state.outcome === 'lantern-lit') return 'The lantern stays lit. That is the whole of the story tonight.';
        if (state.outcome === 'lantern-dark') return 'We left the lantern dark and listened to the water.';
        if (state.outcome === 'your-day') return 'Tonight was just the terrace, and whatever you wanted to say.';
        return 'The evening can end here, or we can sit a little longer.';
    }

    const CHOICES = {
        welcome: [
            { id: 'tide', label: 'Watch the tide', beat: 'tide', outcome: '' },
            { id: 'story', label: 'Tell me the lantern story', beat: 'story', outcome: '' },
        ],
        tide: [
            { id: 'take-shell', label: 'Keep the shell', beat: 'kept-shell', outcome: 'kept-shell' },
            { id: 'leave-shell', label: 'Leave it for the tide', beat: 'left-shell', outcome: 'left-shell' },
        ],
        story: [
            { id: 'light-lantern', label: 'Light the lantern', beat: 'lantern-lit', outcome: 'lantern-lit' },
            { id: 'your-day', label: 'I will tell you about my day', beat: 'your-day', outcome: 'your-day' },
        ],
        'kept-shell': [
            { id: 'close', label: 'End the evening', beat: 'close', outcome: 'kept-shell' },
            { id: 'light-lantern', label: 'Light the lantern too', beat: 'lantern-lit', outcome: 'lantern-lit' },
        ],
        'left-shell': [{ id: 'close', label: 'End the evening', beat: 'close', outcome: 'left-shell' }],
        'lantern-lit': [{ id: 'close', label: 'End the evening', beat: 'close', outcome: 'lantern-lit' }],
        'lantern-dark': [{ id: 'close', label: 'End the evening', beat: 'close', outcome: 'lantern-dark' }],
        'your-day': [
            { id: 'light-lantern', label: 'Light the lantern', beat: 'lantern-lit', outcome: 'lantern-lit' },
            { id: 'close', label: 'Sit quietly', beat: 'close', outcome: 'your-day' },
        ],
        close: [],
    };

    function choices(state) {
        return (CHOICES[state.beat] || []).map((choice) => ({ id: choice.id, label: choice.label }));
    }

    function choose(state, choiceId) {
        const options = CHOICES[state.beat] || [];
        const choice = options.filter((item) => item.id === choiceId)[0];
        if (!choice) return { ok: false, why: 'no-such-choice', state: state };
        const next = {
            beat: choice.beat,
            shellTouched: state.shellTouched || choice.beat === 'kept-shell',
            lanternLit: state.lanternLit || choice.beat === 'lantern-lit',
            outcome: choice.outcome || state.outcome,
        };
        if (choice.beat === 'lantern-dark') next.lanternLit = false;
        next.line = lineFor(next);
        return { ok: true, state: next };
    }

    function interact(state, objectId) {
        const next = {
            beat: state.beat,
            shellTouched: state.shellTouched,
            lanternLit: state.lanternLit,
            outcome: state.outcome,
        };
        if (objectId === 'shell') {
            next.shellTouched = true;
            next.line = 'You pick up the shell. It is warmer than the air.';
            return { ok: true, state: next, behavior: 'look_at_object', objectId: 'shell' };
        }
        if (objectId === 'lantern') {
            next.lanternLit = !state.lanternLit;
            next.line = next.lanternLit
                ? 'The lantern takes the match.'
                : 'You dim the lantern. The terrace goes blue.';
            if (!next.lanternLit && state.beat === 'story') next.beat = 'lantern-dark';
            if (next.lanternLit && (state.beat === 'story' || state.beat === 'your-day')) {
                next.beat = 'lantern-lit';
                next.outcome = 'lantern-lit';
            }
            next.line = lineFor(next);
            if (objectId === 'lantern' && next.lanternLit && state.beat === 'welcome') {
                next.line = 'You light the lantern before we have even chosen. The step is easier to see.';
            }
            return { ok: true, state: next, behavior: 'gesture_toward_object', objectId: 'lantern' };
        }
        if (objectId === 'exit-stone') {
            return { ok: true, state: state, exit: true, behavior: 'relax' };
        }
        return { ok: false, why: 'unknown-object', state: state };
    }

    function persist(state) {
        return {
            beat: state.beat,
            outcome: state.outcome || '',
            shellTouched: state.shellTouched === true,
            lanternLit: state.lanternLit === true,
        };
    }

    function restore(saved) {
        const state = {
            beat: saved && saved.beat ? saved.beat : 'welcome',
            shellTouched: saved && saved.shellTouched === true,
            lanternLit: saved && saved.lanternLit === true,
            outcome: saved && saved.outcome ? saved.outcome : '',
        };
        if (!CHOICES[state.beat] && state.beat !== 'close') state.beat = 'welcome';
        state.line = lineFor(state);
        return state;
    }

    return {
        initial: initial,
        choices: choices,
        choose: choose,
        interact: interact,
        persist: persist,
        restore: restore,
        lineFor: lineFor,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_SEASIDE_STORY = SeasideStory;
if (typeof module !== 'undefined' && module.exports) module.exports = SeasideStory;
