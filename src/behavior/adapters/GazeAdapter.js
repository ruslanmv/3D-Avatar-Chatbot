/**
 * GazeAdapter — is the user looking at her (spec v1.1 §6.3, optional hook 5).
 *
 * `gaze:user-look-avatar` held for more than 1.5 s is one of Together mode's commentary
 * openings (§6.7) — the beat where she notices you looking and says *"what?"*. So the event
 * carries how long the look has lasted, and repeats while it continues; a single edge
 * event would make that rule impossible to write.
 *
 * `FaceTracker` already runs MediaPipe and knows where the head is pointing. This reads it;
 * it does not start a camera, and with no tracker running it simply never fires. That is
 * why §7's hook 5 stayed optional: nothing in `FaceTracker.js` needed changing.
 *
 * Exposes: window.NEXUS_BD_GAZE_ADAPTER
 */
const GazeAdapter = (() => {
    'use strict';

    /** Below this the head is pointing at the screen rather than past it. */
    const LOOK_THRESHOLD = 0.35;

    /** Do not re-announce a continuing look more often than this. */
    const REPEAT_MS = 500;

    function attach({ bus, blackboard, tracker, now = () => Date.now() } = {}) {
        const source = tracker || (typeof window !== 'undefined' ? window.NEXUS_FACE_TRACKER : null);
        let looking = false;
        let since = 0;
        let lastAnnounced = 0;

        /** Read the tracker. Returns null when there is nothing to read. */
        function sample() {
            if (!source) return null;
            try {
                if (typeof source.isLookingAtAvatar === 'function') return Boolean(source.isLookingAtAvatar());
                const yaw = Number(source.headYaw ?? source.yaw);
                const pitch = Number(source.headPitch ?? source.pitch);
                if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
                return Math.abs(yaw) < LOOK_THRESHOLD && Math.abs(pitch) < LOOK_THRESHOLD;
            } catch {
                return null;
            }
        }

        /** Called from the render loop; also directly by tests. */
        function tick() {
            const isLooking = sample();
            if (isLooking === null) return null;
            const t = now();

            if (isLooking !== looking) {
                looking = isLooking;
                since = t;
                lastAnnounced = t;
                blackboard?.setFlag('lookingAtAvatar', isLooking);
                const event = isLooking ? 'gaze:user-look-avatar' : 'gaze:user-look-away';
                bus.emit(event, { ms: 0 });
                return event;
            }

            // A held look keeps reporting, so "> 1.5 s" is a rule an opening can test.
            if (looking && t - lastAnnounced >= REPEAT_MS) {
                lastAnnounced = t;
                bus.emit('gaze:user-look-avatar', { ms: t - since });
                return 'gaze:user-look-avatar';
            }
            return null;
        }

        return {
            name: 'GazeAdapter',
            tick,
            get isLooking() {
                return looking;
            },
            detach() {
                looking = false;
            },
        };
    }

    return { attach, LOOK_THRESHOLD, REPEAT_MS };
})();

if (typeof window !== 'undefined') window.NEXUS_BD_GAZE_ADAPTER = GazeAdapter;
if (typeof module !== 'undefined' && module.exports) module.exports = GazeAdapter;
