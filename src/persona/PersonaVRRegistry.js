/**
 * PersonaVRRegistry — maps persona model names to VRM avatar profiles.
 *
 * Additive module: does not modify any existing 3D-Avatar-Chatbot code.
 * The VR app uses this to look up which VRM, voice, motion profile,
 * and XR profile to use for a given persona model.
 *
 * @module PersonaVRRegistry
 */

const PersonaVRRegistry = (() => {
    'use strict';

    /**
     * Built-in VR profiles for the five superintelligent personas.
     * Each entry maps a persona model name to its full VR config.
     */
    const _builtInProfiles = {
        'persona:scarlett-secretary': {
            personaId: 'scarlett_secretary',
            displayName: 'Scarlett',
            role: 'Executive Secretary',
            vrm: '/vendor/avatars/AvatarSample_A.vrm',
            voice: 'nova',
            voiceProvider: 'openai_tts',
            motionProfile: 'professional_assistant',
            xrProfile: 'office_companion',
            contentRating: 'sfw',
            expressionStyle: 'moderate',
            gestureAmplitude: 'moderate',
            talkStyle: 'presenter',
            idleStyle: 'breathing',
            defaultPose: 'standing_formal',
            personalDistanceM: 1.5,
            spawnDistanceM: 1.8,
            followDistanceM: 1.8,
            followSide: 'right',
            locomotionStyle: 'walk',
            walkSpeedMps: 1.2,
            presenceStates: [
                'idle',
                'listening',
                'thinking',
                'speaking',
                'following',
                'waiting',
                'sitting',
                'task_active',
            ],
            interactionCommands: ['come here', 'follow me', 'stop', 'sit down', 'stand up', 'look at me', 'stay here'],
            canOfferHand: false,
            canHighFive: false,
            supportsVR: true,
            supportsAR: true,
            isOrchestrated: true,
            hasSpatialIntelligence: true,
            warmth: 0.4,
        },
        'persona:milo-friend': {
            personaId: 'milo_friend',
            displayName: 'Milo',
            role: 'Best Friend',
            vrm: '/vendor/avatars/AvatarSample_B.vrm',
            voice: 'echo',
            voiceProvider: 'openai_tts',
            motionProfile: 'casual_friend',
            xrProfile: 'social_companion',
            contentRating: 'sfw',
            expressionStyle: 'expressive',
            gestureAmplitude: 'broad',
            talkStyle: 'hand_talker',
            idleStyle: 'casual_fidget',
            defaultPose: 'casual',
            personalDistanceM: 1.0,
            spawnDistanceM: 1.2,
            followDistanceM: 1.2,
            followSide: 'adaptive',
            locomotionStyle: 'walk',
            walkSpeedMps: 1.3,
            presenceStates: [
                'idle',
                'listening',
                'thinking',
                'speaking',
                'following',
                'waiting',
                'sitting',
                'walking_beside',
            ],
            interactionCommands: [
                'come here',
                'follow me',
                'stop',
                'sit down',
                'stand up',
                'look at me',
                'walk with me',
                'stay here',
            ],
            canOfferHand: false,
            canHighFive: true,
            supportsVR: true,
            supportsAR: true,
            isOrchestrated: false,
            hasSpatialIntelligence: true,
            warmth: 0.7,
        },
        'persona:nova-collaborator': {
            personaId: 'nova_collaborator',
            displayName: 'Nova',
            role: 'Work Collaborator',
            vrm: '/vendor/avatars/fem_vroid.vrm',
            voice: 'shimmer',
            voiceProvider: 'openai_tts',
            motionProfile: 'focused_collaborator',
            xrProfile: 'office_companion',
            contentRating: 'sfw',
            expressionStyle: 'moderate',
            gestureAmplitude: 'moderate',
            talkStyle: 'presenter',
            idleStyle: 'weight_shift',
            defaultPose: 'attentive',
            personalDistanceM: 1.3,
            spawnDistanceM: 1.5,
            followDistanceM: 1.5,
            followSide: 'adaptive',
            locomotionStyle: 'walk',
            walkSpeedMps: 1.2,
            presenceStates: [
                'idle',
                'listening',
                'thinking',
                'speaking',
                'following',
                'waiting',
                'sitting',
                'task_active',
            ],
            interactionCommands: [
                'come here',
                'follow me',
                'stop',
                'sit down',
                'stand up',
                'look at me',
                'point there',
                'stay here',
            ],
            canOfferHand: false,
            canHighFive: true,
            supportsVR: true,
            supportsAR: true,
            isOrchestrated: true,
            hasSpatialIntelligence: true,
            warmth: 0.5,
        },
        'persona:luna-girlfriend': {
            personaId: 'luna_girlfriend',
            displayName: 'Luna',
            role: 'Girlfriend Companion',
            vrm: '/vendor/avatars/fem_vroid.vrm',
            voice: 'alloy',
            voiceProvider: 'openai_tts',
            motionProfile: 'intimate_companion',
            xrProfile: 'home_companion',
            contentRating: 'mature',
            expressionStyle: 'expressive',
            gestureAmplitude: 'moderate',
            talkStyle: 'subtle_nod',
            idleStyle: 'casual_fidget',
            defaultPose: 'standing_relaxed',
            personalDistanceM: 0.7,
            spawnDistanceM: 0.9,
            followDistanceM: 0.9,
            followSide: 'left',
            locomotionStyle: 'walk',
            walkSpeedMps: 1.0,
            presenceStates: [
                'idle',
                'listening',
                'thinking',
                'speaking',
                'following',
                'waiting',
                'sitting',
                'hand_offering',
                'walking_beside',
                'approaching',
            ],
            interactionCommands: [
                'come here',
                'follow me',
                'stop',
                'sit down',
                'stand up',
                'look at me',
                'take my hand',
                'walk with me',
                'stay here',
                'come closer',
            ],
            canOfferHand: true,
            canHighFive: true,
            supportsVR: true,
            supportsAR: false,
            isOrchestrated: false,
            hasSpatialIntelligence: true,
            warmth: 0.9,
        },
        'persona:velvet-companion': {
            personaId: 'velvet_companion',
            displayName: 'Velvet',
            role: 'Adult Companion',
            vrm: '/vendor/avatars/AvatarSample_A.vrm',
            voice: 'fable',
            voiceProvider: 'openai_tts',
            motionProfile: 'intimate_companion',
            xrProfile: 'home_companion',
            contentRating: 'adult',
            expressionStyle: 'dramatic',
            gestureAmplitude: 'moderate',
            talkStyle: 'subtle_nod',
            idleStyle: 'casual_fidget',
            defaultPose: 'standing_relaxed',
            personalDistanceM: 0.6,
            spawnDistanceM: 0.8,
            followDistanceM: 0.8,
            followSide: 'left',
            locomotionStyle: 'walk',
            walkSpeedMps: 0.9,
            presenceStates: [
                'idle',
                'listening',
                'thinking',
                'speaking',
                'following',
                'waiting',
                'sitting',
                'hand_offering',
                'walking_beside',
                'approaching',
                'retreating',
            ],
            interactionCommands: [
                'come here',
                'follow me',
                'stop',
                'sit down',
                'stand up',
                'look at me',
                'take my hand',
                'walk with me',
                'stay here',
                'come closer',
            ],
            canOfferHand: true,
            canHighFive: false,
            supportsVR: true,
            supportsAR: false,
            isOrchestrated: false,
            hasSpatialIntelligence: true,
            warmth: 1.0,
        },
    };

    /** @type {Object<string, Object>} Custom profiles added at runtime */
    const _customProfiles = {};

    return {
        /**
         * Get the VR profile for a persona model name.
         * @param {string} modelName - e.g. "persona:scarlett-secretary"
         * @returns {Object|null}
         */
        getProfile(modelName) {
            return _customProfiles[modelName] || _builtInProfiles[modelName] || null;
        },

        /**
         * Register a custom VR profile for a model name.
         * @param {string} modelName
         * @param {Object} profile
         */
        registerProfile(modelName, profile) {
            _customProfiles[modelName] = profile;
        },

        /**
         * List all available persona model names.
         * @returns {string[]}
         */
        listModels() {
            const all = new Set([...Object.keys(_builtInProfiles), ...Object.keys(_customProfiles)]);
            return Array.from(all);
        },

        /**
         * List all profiles with metadata (for gallery display).
         * @returns {Object[]}
         */
        listProfiles() {
            const all = { ..._builtInProfiles, ..._customProfiles };
            return Object.entries(all).map(([model, profile]) => ({
                model,
                ...profile,
            }));
        },

        /**
         * Check if a model name is a VR-ready persona.
         * @param {string} modelName
         * @returns {boolean}
         */
        isVRReady(modelName) {
            const profile = this.getProfile(modelName);
            return profile ? profile.supportsVR === true : false;
        },

        /**
         * Get the VRM file path for a persona.
         * @param {string} modelName
         * @returns {string|null}
         */
        getVRM(modelName) {
            const profile = this.getProfile(modelName);
            return profile ? profile.vrm : null;
        },

        /**
         * Get the voice config for TTS.
         * @param {string} modelName
         * @returns {{ voice: string, provider: string, warmth: number }|null}
         */
        getVoiceConfig(modelName) {
            const profile = this.getProfile(modelName);
            if (!profile) return null;
            return {
                voice: profile.voice,
                provider: profile.voiceProvider,
                warmth: profile.warmth,
            };
        },

        /**
         * Attempt to load a VR bootstrap from OllaBridge /v1/persona/vr-context.
         * Falls back to built-in profile if the endpoint is unavailable.
         * @param {string} modelName
         * @param {string} baseUrl - OllaBridge base URL
         * @returns {Promise<Object>}
         */
        async fetchRemoteProfile(modelName, baseUrl) {
            try {
                const res = await fetch(`${baseUrl}/v1/persona/vr-context?model=${encodeURIComponent(modelName)}`);
                if (res.ok) {
                    const data = await res.json();
                    return data;
                }
            } catch (_) {
                // Fallback to local profile
            }
            return this.getProfile(modelName);
        },
    };
})();

// Export for ES module consumers
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PersonaVRRegistry;
}
