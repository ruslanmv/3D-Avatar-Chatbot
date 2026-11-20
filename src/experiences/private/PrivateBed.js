/**
 * BS1. Positions done on a bed are done on the bed.
 *
 * The evening audit (tools/qa/evening-stages.mjs) photographed every position of the Window Room's
 * evening on the rug in front of the bed — lying back, on all fours, riding, even "sitting back on
 * the bed" — because a position is only her bones, at her own spot, and the room never knew. Here,
 * when she holds one of the bed positions in a room whose bed was measured
 * (tools/vr/measure-bed.mjs), the room is moved under her (VRWorlds `nestle`) so the mattress is
 * where she lies; any other position, standing, or the end of the evening puts the room back
 * exactly where it was.
 *
 * Her own position is never moved: the avatar's root is read by the camera, VR, AR and the pose
 * system, and moving the world is the one change none of them can see. A room without a measured
 * bed, or a position that is not a bed position, changes nothing.
 */
(function (global) {
    'use strict';

    /** Her positions that belong on a bed (PrivatePoseController.POSES keys). */
    const BED_POSES = Object.freeze([
        'knees-up',
        'lie-back',
        'lie-front',
        'lie-side',
        'all-fours',
        'straddle',
        'lounge',
        // UN38. Bent over and kneeling in front stay on the floor: she stands or kneels there.
        'face-down',
        'legs-up',
        'spoon',
        'reverse',
    ]);

    function isBedPose(pose) {
        return BED_POSES.includes(String(pose || ''));
    }

    /** Her hips on the floor (x, z), from the rendered skeleton; null when she is not loaded. */
    function hipsOf(win) {
        try {
            const am = win.NEXUS_VIEWER && win.NEXUS_VIEWER.avatarManager;
            const vrm = am && (am._currentVRM || (am.vrmLoader && am.vrmLoader.currentVRM));
            const h = vrm && vrm.humanoid;
            const bone = h && (h.getNormalizedBoneNode ? h.getNormalizedBoneNode('hips') : h.getBoneNode('hips'));
            if (!bone || !win.THREE) return null;
            const p = bone.getWorldPosition(new win.THREE.Vector3());
            return { x: p.x, z: p.z };
        } catch (_) {
            return null;
        }
    }

    /**
     * Bring the room in line with the position she holds: on the bed for a bed position in a room
     * with a bed, back where it was otherwise. Fails soft: a page without worlds or a room without
     * a bed answers `{ ok: false }` and nothing moves.
     */
    async function sync(win, pose, options) {
        const runtime = win && win.NEXUS_VIEWER && win.NEXUS_VIEWER.vrWorlds;
        if (!runtime || typeof runtime.nestle !== 'function') return { ok: false, why: 'no-world-runtime' };
        try {
            if (isBedPose(pose) && runtime.bed) {
                const hips = hipsOf(win);
                if (!hips) return { ok: false, why: 'no-avatar' };
                return await runtime.nestle(hips, options);
            }
            return runtime.onBed ? await runtime.nestle(null, options) : { ok: true, moved: false };
        } catch (error) {
            console.warn('[PrivateBed] the room could not be moved', error);
            return { ok: false, why: 'threw' };
        }
    }

    const api = { BED_POSES, isBedPose, sync };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_PRIVATE_BED = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
