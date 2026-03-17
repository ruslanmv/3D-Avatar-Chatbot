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
    },
};

export function resolveVRIntimacyProfile(snapshot) {
    if (!snapshot) return VR_INTIMACY_PROFILES.idle;

    if (snapshot.isSeated && snapshot.distance < 1.15) {
        return VR_INTIMACY_PROFILES.closeSeated;
    }

    if (snapshot.wallBehind && snapshot.distance < 1.15) {
        return VR_INTIMACY_PROFILES.supportedStanding;
    }

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
