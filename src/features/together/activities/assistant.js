/**
 * assistant — embodied HomePilot (spec v1.1 §6.15, batch B21).
 *
 * The flagship beat of the whole plan, and it is almost no code, which is the point. Every
 * tool it appears to use already exists: `hp_personal_plan_day` fetches the day, the seeded
 * calendar servers know the meetings, and `daypilot_bridge` already carries a proposal to an
 * Approval Center. What was missing was a body — somebody in the room to put the day on a
 * screen, point at it, and say one short sentence.
 *
 * ## What this file does not do
 *
 * It does not speak. Not one word of a brief originates here: the spoken half arrives as a
 * `say` frame and goes through the normal TTS path, exactly as a chat reply does. A test
 * greps this file for `say` and fails if it appears, because a module that could both draw
 * the panel and narrate it would drift into narrating instead of drawing.
 *
 * It does not act, and — the stronger statement — it *cannot*. A proposal never reaches the
 * client at all. It lives in `x_directives` on the chat response, which DayPilot reads and
 * drafts behind its own Approval Center. There is no protocol frame that carries an action,
 * so there is no handler here that could run one, and a test asserts the absence of the
 * frame rather than the absence of the handler — the missing capability is upstream of this
 * file, which is a better place for it to be missing from.
 *
 * ## What it does do: attention
 *
 * A speaker puck with a face talks at you about your calendar. An assistant with a body
 * looks at the thing she just put up, gestures at it once, and then looks back at you. So
 * this module owns two variables — where her attention is, and whether she has pointed yet —
 * and it puts both back exactly as it found them, the way a scene overlay does (§6.11): it
 * snapshots on show and restores on close, rather than undoing field by field.
 *
 * Exposes: window.NEXUS_BD_ASSISTANT
 */
const AssistantActivity = (() => {
    'use strict';

    /**
     * Panels she is *presenting*. She points at these. `cards` and `share` are the user's
     * own things on her screen, and pointing at something you made and handed her is the
     * gesture of a presenter, not a companion.
     */
    const PRESENTED_KINDS = ['agenda', 'tool_result', 'stats'];

    /** Every kind she will look at, presented or not. */
    const ATTENDED_KINDS = ['agenda', 'tool_result', 'stats', 'cards', 'share'];

    /**
     * How long her attention stays on a panel before drifting back to you. A panel that
     * held her gaze until it closed would leave her staring at a screen through a
     * conversation about it — joint attention has to end somewhere, and twelve seconds is
     * about how long it takes to read an agenda.
     */
    const ATTENTION_MS = 12000;

    /** The gesture, by name. Resolved to a clip by the KB, per §6.4 — never a filename. */
    const POINT = 'point';

    /** How hard she points. Low: it is a nod towards a screen, not stage direction. */
    const POINT_INTENSITY = 0.5;

    /** Where her attention goes while a panel is up. */
    const PANEL_TARGET = 'panel';

    class Assistant {
        constructor({ bus, blackboard, panels, now = () => Date.now() } = {}) {
            this.id = 'assistant';
            this.label = 'Assistant';

            this.bus = bus || null;
            this.blackboard = blackboard || null;
            this.panels = panels || null;
            this.now = now;

            /** What `activityTarget` was before a panel took it. Restored verbatim. */
            this.snapshot = null;
            this.attending = null;
            this.pointedAt = null;
            /** The last release, for the HUD. Not an event: the bus vocabulary is closed
             *  (§6.3) and nothing subscribes, so a new entry would be one nobody reads. */
            this.released = null;
            this.shown = 0;
            this.pointed = 0;
            this.drifted = 0;

            this._onShown = (event) => this.attend(event);
            this._onClosed = () => this.release('closed');
        }

        get name() {
            return 'Assistant';
        }

        attach() {
            if (this.bus) {
                this.bus.on('panel:shown', this._onShown);
                this.bus.on('panel:closed', this._onClosed);
            }
            return this;
        }

        detach() {
            if (this.bus && typeof this.bus.off === 'function') {
                this.bus.off('panel:shown', this._onShown);
                this.bus.off('panel:closed', this._onClosed);
            }
            this.release('detached');
        }

        // ── attention ────────────────────────────────────────────────────────

        /**
         * A panel went up. Look at it, and point at it if it is one of hers.
         *
         * Snapshots before it overwrites anything, so a panel that appears while she is
         * already attending to a film hands the film back on close rather than guessing.
         */
        attend(event) {
            const kind = event && event.kind;
            if (!ATTENDED_KINDS.includes(kind)) return null;

            if (!this.attending) this.snapshot = this._takeSnapshot();
            this.attending = { kind, at: this.now() };
            this.shown++;
            if (this.blackboard) this.blackboard.activityTarget = PANEL_TARGET;

            // Once per panel. A gesture on every redraw would make her point at a stats
            // panel four times while its numbers tick.
            if (PRESENTED_KINDS.includes(kind) && this.pointedAt !== this.attending.at) {
                this.pointedAt = this.attending.at;
                this.pointed++;
                if (this.bus) {
                    this.bus.emit('intent', { name: POINT, intensity: POINT_INTENSITY, source: 'assistant' });
                }
            }
            return this.attending;
        }

        /** Put `activityTarget` back exactly as it was. */
        release(why = 'user') {
            if (!this.attending) return false;
            const kind = this.attending.kind;
            this._restoreSnapshot(this.snapshot);
            this.attending = null;
            this.snapshot = null;
            this.pointedAt = null;
            this.released = { kind, why, at: this.now() };
            return true;
        }

        /**
         * Called from the render loop. The only thing that happens on a tick is that her
         * attention drifts back to you — nothing is said, and nothing is drawn.
         */
        update(at = this.now()) {
            if (!this.attending) return null;
            if (at - this.attending.at < ATTENTION_MS) return null;
            const kind = this.attending.kind;
            this.drifted++;
            this.release('drifted');
            return { kind, why: 'drifted' };
        }

        _takeSnapshot() {
            const bb = this.blackboard || {};
            // By reference, like §6.11's overlays: restoring an equal copy passes a deep
            // equality test and is still the bug.
            return { activityTarget: bb.activityTarget };
        }

        _restoreSnapshot(snapshot) {
            if (!snapshot || !this.blackboard) return;
            this.blackboard.activityTarget = snapshot.activityTarget;
        }

        get stats() {
            return {
                attending: this.attending ? this.attending.kind : null,
                shown: this.shown,
                pointed: this.pointed,
                drifted: this.drifted,
                released: this.released && this.released.why,
            };
        }
    }

    function attach(deps) {
        return new Assistant(deps).attach();
    }

    return {
        attach,
        Assistant,
        PRESENTED_KINDS,
        ATTENDED_KINDS,
        ATTENTION_MS,
        POINT,
        POINT_INTENSITY,
        PANEL_TARGET,
    };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_ASSISTANT = AssistantActivity;
if (typeof module !== 'undefined' && module.exports) module.exports = AssistantActivity;
