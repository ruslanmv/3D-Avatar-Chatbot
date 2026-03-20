/**
 * VRIntimacyProfiles
 * ------------------
 * Single source of truth for close-presence / mature-safe VR interaction profiles.
 * Non-destructive and non-explicit.
 */

export const VR_INTIMACY_PROFILES = {
    idle: {
        key: 'idle',
        label: 'Idle',
        posePreset: 'standingRelaxed',
        basePose: 'lecturerNeutral',
        talkStyle: 'explainCalm',
        desiredDistance: 1.35,
        minDistance: 1.05,
        maxDistance: 1.65,
        rootFollow: 0.0,
        allowHandContact: false,
        allowRootFacing: true,
        expressionOverride: null,
    },

    awarePresence: {
        key: 'awarePresence',
        label: 'Aware Presence',
        posePreset: 'conversational',
        basePose: 'presenterOpen',
        talkStyle: 'explainCalm',
        desiredDistance: 1.15,
        minDistance: 0.95,
        maxDistance: 1.35,
        rootFollow: 0.06,
        allowHandContact: false,
        allowRootFacing: true,
        expressionOverride: { happy: 0.08 },
    },

    closeConversation: {
        key: 'closeConversation',
        label: 'Close Conversation',
        posePreset: 'intimateSafe',
        basePose: 'lecturerNeutral',
        talkStyle: 'explainCalm',
        desiredDistance: 0.92,
        minDistance: 0.74,
        maxDistance: 1.05,
        rootFollow: 0.12,
        allowHandContact: true,
        allowRootFacing: true,
        expressionOverride: { happy: 0.15 },
    },

    comfortEmbrace: {
        key: 'comfortEmbrace',
        label: 'Comfort Embrace',
        posePreset: 'standingHandsClasped',
        basePose: 'anchorGrounded',
        talkStyle: 'broadcastAnchor',
        desiredDistance: 0.78,
        minDistance: 0.62,
        maxDistance: 0.92,
        rootFollow: 0.16,
        allowHandContact: true,
        allowRootFacing: true,
        expressionOverride: { happy: 0.25, relaxed: 0.15 },
    },

    closeSeated: {
        key: 'closeSeated',
        label: 'Close Seated',
        posePreset: 'sittingDesk',
        basePose: 'anchorGrounded',
        talkStyle: 'explainCalm',
        desiredDistance: 0.86,
        minDistance: 0.68,
        maxDistance: 1.02,
        rootFollow: 0.1,
        allowHandContact: true,
        allowRootFacing: true,
        expressionOverride: { happy: 0.12, relaxed: 0.1 },
    },

    supportedStanding: {
        key: 'supportedStanding',
        label: 'Supported Standing',
        posePreset: 'standingFriendly',
        basePose: 'presenterOpen',
        talkStyle: 'explainCalm',
        desiredDistance: 0.95,
        minDistance: 0.72,
        maxDistance: 1.1,
        rootFollow: 0.08,
        allowHandContact: true,
        allowRootFacing: true,
        expressionOverride: { happy: 0.1 },
    },

    handContact: {
        key: 'handContact',
        label: 'Hand Contact',
        posePreset: 'standingFriendly',
        basePose: 'presenterOpen',
        talkStyle: 'explainCalm',
        desiredDistance: 0.88,
        minDistance: 0.7,
        maxDistance: 1.0,
        rootFollow: 0.08,
        allowHandContact: true,
        allowRootFacing: true,
        expressionOverride: { happy: 0.2 },
    },
};

/**
 * Resolve the appropriate intimacy profile based on proximity snapshot.
 *
 * Uses hysteresis to prevent profile thrashing at distance boundaries.
 * When the user is in a profile, they must move outside that profile's
 * minDistance/maxDistance band before the resolver switches — not just
 * cross the hard entry threshold.
 *
 * @param {object} snapshot - Proximity snapshot from VRProximityTracker
 * @param {string|null} currentProfileKey - Key of the currently active profile (for hysteresis)
 * @returns {object} The resolved VR_INTIMACY_PROFILES entry
 */
export function resolveVRIntimacyProfile(snapshot, currentProfileKey) {
    if (!snapshot) return VR_INTIMACY_PROFILES.idle;

    // Context overrides always take priority (checked first)
    if (snapshot.isSeated && snapshot.distance < 1.15) {
        return VR_INTIMACY_PROFILES.closeSeated;
    }

    if (snapshot.wallBehind && snapshot.distance < 1.15) {
        return VR_INTIMACY_PROFILES.supportedStanding;
    }

    // Hysteresis: if we have a current profile, stay in it while distance
    // remains within its [minDistance, maxDistance] band. Only exit when
    // the user moves clearly outside the band.
    if (currentProfileKey) {
        const current = VR_INTIMACY_PROFILES[currentProfileKey];
        if (
            current &&
            current.key !== 'idle' &&
            current.key !== 'handContact' &&
            snapshot.distance >= current.minDistance &&
            snapshot.distance <= current.maxDistance
        ) {
            return current;
        }
    }

    // Distance-based resolution (hard thresholds for initial entry)
    if (snapshot.distance < 0.72) {
        return VR_INTIMACY_PROFILES.comfortEmbrace;
    }

    if (snapshot.distance < 1.1) {
        return VR_INTIMACY_PROFILES.closeConversation;
    }

    if (snapshot.distance < 1.45) {
        return VR_INTIMACY_PROFILES.awarePresence;
    }

    return VR_INTIMACY_PROFILES.idle;
}
