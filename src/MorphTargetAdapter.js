/**
 * MorphTargetAdapter — Phase 3 GLB Expression Support
 *
 * Scans a loaded GLB scene graph for morph targets, normalizes names
 * from ARKit / Oculus Viseme / Blender conventions into VRM-compatible
 * expression names, and exposes the same API as VRM expressionManager:
 *
 *   adapter.setValue(name, value)   — set expression 0..1
 *
 * This allows BehaviorEngine, LipSyncEngine, and EmotionEngine to
 * drive GLB morph targets through the same vrmLoader.setExpression()
 * path used for VRM models — zero changes needed in Phase 3 engines.
 *
 * Falls back to jaw bone rotation when no morph targets are found.
 */
(function (global) {
    'use strict';

    const THREE = global.THREE;

    // =========================================================================
    // NAME MAPPING: various conventions → VRM expression names
    // =========================================================================

    const NAME_MAP = {
        // ── Visemes (lip-sync) ──
        // ARKit
        jawOpen: 'aa',
        mouthOpen: 'aa',
        // Oculus Viseme
        viseme_aa: 'aa',
        viseme_E: 'ee',
        viseme_I: 'ee',
        viseme_O: 'oh',
        viseme_U: 'oh',
        viseme_CH: 'oh',
        viseme_FF: 'ih',
        viseme_TH: 'oh',
        viseme_PP: 'aa', // bilabial — maps to closed-mouth
        viseme_SS: 'ee',
        viseme_nn: 'aa',
        viseme_RR: 'oh',
        viseme_DD: 'aa',
        viseme_kk: 'aa',
        viseme_sil: null, // silence

        // Blender / custom
        mouth_open: 'aa',
        mouth_smile: 'happy',
        mouthSmile: 'happy',
        mouthSmileLeft: 'happy',
        mouthSmileRight: 'happy',
        mouthFrownLeft: 'sad',
        mouthFrownRight: 'sad',
        mouthFrown: 'sad',

        // ── Emotions ──
        // ARKit
        mouthSmile_L: 'happy',
        mouthSmile_R: 'happy',
        mouthFrown_L: 'sad',
        mouthFrown_R: 'sad',

        // Blender
        happy: 'happy',
        Happy: 'happy',
        sad: 'sad',
        Sad: 'sad',
        angry: 'angry',
        Angry: 'angry',
        surprised: 'surprised',
        Surprised: 'surprised',

        // RobotExpressive-style
        Angry: 'angry',
        Sad: 'sad',

        // ── Blink ──
        eyeBlink_L: 'blink',
        eyeBlink_R: 'blink',
        eyeBlinkLeft: 'blink',
        eyeBlinkRight: 'blink',
        blink: 'blink',
        Blink: 'blink',
        eye_blink: 'blink',

        // ── Gaze ──
        eyeLookUpLeft: 'lookUp',
        eyeLookUpRight: 'lookUp',
        eyeLookDownLeft: 'lookDown',
        eyeLookDownRight: 'lookDown',
        eyeLookInLeft: 'lookRight', // ARKit: "in" = toward nose
        eyeLookInRight: 'lookLeft',
        eyeLookOutLeft: 'lookLeft',
        eyeLookOutRight: 'lookRight',

        // ── Brow (map to surprised) ──
        browInnerUp: 'surprised',
        browOuterUpLeft: 'surprised',
        browOuterUpRight: 'surprised',
        browDownLeft: 'angry',
        browDownRight: 'angry',
    };

    // VRM expressions we expose
    const ALL_EXPRESSIONS = [
        'aa',
        'ee',
        'oh',
        'ih',
        'ou',
        'happy',
        'sad',
        'angry',
        'surprised',
        'neutral',
        'blink',
        'lookLeft',
        'lookRight',
        'lookUp',
        'lookDown',
    ];

    // =========================================================================
    // MORPH TARGET ADAPTER CLASS
    // =========================================================================

    class MorphTargetAdapter {
        /**
         * @param {THREE.Object3D} root - The GLB scene root
         */
        constructor(root) {
            // Map: vrmExprName → [{ mesh, morphIndex, weight }]
            this._bindings = {};
            // Jaw bone fallback
            this._jawBone = null;
            this._jawRestQuat = null;
            // Track which capabilities are available
            this.capabilities = {
                hasVisemes: false,
                hasEmotions: false,
                hasGaze: false,
                hasBlink: false,
                hasJawBone: false,
            };

            this._scan(root);
        }

        /**
         * Scan the scene graph for morph targets and jaw bone.
         */
        _scan(root) {
            if (!root) return;

            const foundExpressions = new Set();

            root.traverse((node) => {
                // Scan morph targets on meshes
                if (node.isMesh && node.morphTargetDictionary) {
                    const dict = node.morphTargetDictionary;
                    for (const [morphName, morphIndex] of Object.entries(dict)) {
                        const vrmName = NAME_MAP[morphName];
                        if (vrmName === undefined) {
                            // Try case-insensitive fallback
                            const lower = morphName.toLowerCase();
                            for (const [key, val] of Object.entries(NAME_MAP)) {
                                if (key.toLowerCase() === lower && val !== null) {
                                    this._addBinding(val, node, morphIndex, 1.0);
                                    foundExpressions.add(val);
                                    break;
                                }
                            }
                            continue;
                        }
                        if (vrmName === null) continue; // explicitly ignored (e.g. silence)

                        // Weight: paired morph targets (L+R) each contribute 0.5
                        const isPaired =
                            morphName.includes('Left') ||
                            morphName.includes('Right') ||
                            morphName.includes('_L') ||
                            morphName.includes('_R');
                        this._addBinding(vrmName, node, morphIndex, isPaired ? 0.5 : 1.0);
                        foundExpressions.add(vrmName);
                    }
                }

                // Find jaw bone for fallback
                if (node.isBone && !this._jawBone) {
                    const n = (node.name || '').toLowerCase();
                    if (
                        n === 'jaw' ||
                        n === 'jawbone' ||
                        n === 'jaw_bone' ||
                        (n.includes('jaw') && !n.includes('upper'))
                    ) {
                        this._jawBone = node;
                        this._jawRestQuat = node.quaternion.clone();
                    }
                }
            });

            // Determine capabilities
            const visemeNames = ['aa', 'ee', 'oh'];
            const emotionNames = ['happy', 'sad', 'angry', 'surprised'];
            const gazeNames = ['lookLeft', 'lookRight', 'lookUp', 'lookDown'];

            this.capabilities.hasVisemes = visemeNames.some((n) => foundExpressions.has(n));
            this.capabilities.hasEmotions = emotionNames.some((n) => foundExpressions.has(n));
            this.capabilities.hasGaze = gazeNames.some((n) => foundExpressions.has(n));
            this.capabilities.hasBlink = foundExpressions.has('blink');
            this.capabilities.hasJawBone = !!this._jawBone;

            const total = Object.keys(this._bindings).length;
            console.log(
                `[MorphTargetAdapter] Found ${total} expression bindings. ` +
                    `Capabilities: visemes=${this.capabilities.hasVisemes}, ` +
                    `emotions=${this.capabilities.hasEmotions}, ` +
                    `gaze=${this.capabilities.hasGaze}, blink=${this.capabilities.hasBlink}, ` +
                    `jawBone=${this.capabilities.hasJawBone}`
            );
        }

        _addBinding(vrmName, mesh, morphIndex, weight) {
            if (!this._bindings[vrmName]) {
                this._bindings[vrmName] = [];
            }
            this._bindings[vrmName].push({ mesh, morphIndex, weight });
        }

        /**
         * Check if this adapter has any useful bindings.
         */
        get hasBindings() {
            return Object.keys(this._bindings).length > 0 || !!this._jawBone;
        }

        /**
         * Set expression value — same API as VRM expressionManager.
         * @param {string} name - VRM expression name (aa, happy, blink, etc.)
         * @param {number} value - 0..1
         */
        setValue(name, value) {
            const bindings = this._bindings[name];
            if (bindings) {
                for (const b of bindings) {
                    if (b.mesh.morphTargetInfluences) {
                        b.mesh.morphTargetInfluences[b.morphIndex] = value * b.weight;
                    }
                }
                return;
            }

            // Jaw bone fallback for 'aa' viseme (mouth open)
            if (name === 'aa' && this._jawBone && this._jawRestQuat) {
                const openAngle = value * 0.3; // max ~17 degrees
                const qRest = this._jawRestQuat;
                const qOpen = new THREE.Quaternion().setFromEuler(new THREE.Euler(openAngle, 0, 0));
                this._jawBone.quaternion.copy(qRest).multiply(qOpen);
            }
        }

        /**
         * Get current value of an expression (read from first binding).
         * @param {string} name
         * @returns {number}
         */
        getValue(name) {
            const bindings = this._bindings[name];
            if (bindings && bindings.length > 0) {
                const b = bindings[0];
                if (b.mesh.morphTargetInfluences) {
                    return b.mesh.morphTargetInfluences[b.morphIndex] / b.weight;
                }
            }
            return 0;
        }
    }

    // =========================================================================
    // EXPOSE
    // =========================================================================
    global.MorphTargetAdapter = MorphTargetAdapter;

    console.log('[MorphTargetAdapter] Loaded');
})(window);
