'use strict';

/**
 * PoseStudioPanel — UI panel for the Pose Studio.
 * Renders pose presets, bone selector, bipolar rotation sliders, save/load.
 *
 * v3: Unified pose source — VRPoseSystem is the single source of truth.
 *     Pose Navigator wired directly to 3D character via VRPoseSystem.
 *     Old PoseLibrary built-ins removed; dropdown shows VR presets + user saves.
 *     UI reordered: Navigator → Presets dropdown → Bone editor → Save.
 *
 * Exposes: window.NEXUS_POSE_STUDIO_PANEL (constructor class)
 */
(function () {
    // ─── Pose Navigator constants (VRPoseSystem PRESET_ORDER) ───
    // Single source of truth — synced with VRPoseSystem.js
    const NAV_PRESETS = [
        // Presenter / Professional (best defaults)
        { name: 'lecturerNeutral', label: 'Lecturer', category: 'Presenter' },
        { name: 'presenterOpen', label: 'Presenter', category: 'Presenter' },
        { name: 'anchorGrounded', label: 'Anchor', category: 'Presenter' },
        // Standing
        { name: 'standingRelaxed', label: 'Relaxed', category: 'Standing' },
        { name: 'standingFriendly', label: 'Friendly', category: 'Standing' },
        { name: 'standingHandsClasped', label: 'Hands Clasped', category: 'Standing' },
        { name: 'conversational', label: 'Conversational', category: 'Standing' },
        { name: 'standingBendForward', label: 'Bent Over', category: 'Standing' },
        { name: 'standingBentBackward', label: 'Bent Backward', category: 'Standing' },
        // Companion / Mature
        { name: 'confident', label: 'Confident', category: 'Companion' },
        { name: 'lounge', label: 'Lounge', category: 'Companion' },
        { name: 'shy', label: 'Shy', category: 'Companion' },
        { name: 'elegant', label: 'Elegant', category: 'Companion' },
        { name: 'intimateSafe', label: 'Intimate', category: 'Companion' },
        // Sitting
        { name: 'sitting', label: 'Sitting', category: 'Sitting' },
        { name: 'sittingCrossed', label: 'Crossed', category: 'Sitting' },
        { name: 'sittingDesk', label: 'Desk', category: 'Sitting' },
        { name: 'sittingLegsUp', label: 'Lounging', category: 'Sitting' },
        // Kneeling
        { name: 'kneeling', label: 'Kneeling', category: 'Kneeling' },
        { name: 'kneelingUp', label: 'Kneeling (Up)', category: 'Kneeling' },
        // Lying
        { name: 'lyingBack', label: 'Back', category: 'Lying' },
        { name: 'lyingBackRelaxed', label: 'Relaxed', category: 'Lying' },
        { name: 'lyingFront', label: 'Front', category: 'Lying' },
        { name: 'lyingSide', label: 'Side', category: 'Lying' },
        // Ground
        { name: 'allFoursArched', label: 'All Fours (Arched)', category: 'Ground', adult: true },
        // Adult — MMORPG-inspired (Spicy Mode only)
        { name: 'lyingKiss', label: 'Kiss Me', category: 'Adult', adult: true },
        { name: 'standingSeductive', label: 'Seductive', category: 'Adult', adult: true },
        { name: 'wallLean', label: 'Wall Lean', category: 'Adult', adult: true },
        { name: 'lapSitting', label: 'Lap Sitting', category: 'Adult', adult: true },
        { name: 'embraceStanding', label: 'Embrace', category: 'Adult', adult: true },
        { name: 'kneelSubmissive', label: 'Submissive', category: 'Adult', adult: true },
        { name: 'lyingSprawl', label: 'Sprawl', category: 'Adult', adult: true },
        // Adult — Top 5 VR Simulation (Spicy Mode only)
        { name: 'missionary', label: 'Missionary', category: 'VR Sim', adult: true },
        { name: 'doggyStyle', label: 'Doggy Style', category: 'VR Sim', adult: true },
        { name: 'cowgirl', label: 'Cowgirl', category: 'VR Sim', adult: true },
        { name: 'wallPressed', label: 'Wall Pressed', category: 'VR Sim', adult: true },
        { name: 'proneBone', label: 'Prone Bone', category: 'VR Sim', adult: true },
        // Also mark existing adult entries
        { name: 'lyingBackOpen', label: 'Open', category: 'Lying', adult: true },
        { name: 'lyingFrontArched', label: 'Arched', category: 'Lying', adult: true },
        { name: 'kneelingPresent', label: 'Present', category: 'Kneeling', adult: true },
        { name: 'lyingSideSeductive', label: 'Side Pose', category: 'Lying', adult: true },
        // Technical
        { name: 'standing', label: 'T-Pose (Reset)', category: 'Reset' },
    ];

    /**
     * Get filtered NAV_PRESETS based on spicy mode state.
     * When spicy OFF, adult poses are hidden.
     */
    function getFilteredPresets() {
        var spicy = window.NEXUS_SPICY && window.NEXUS_SPICY.isEnabled();
        if (spicy) return NAV_PRESETS;
        return NAV_PRESETS.filter(function (p) {
            return !p.adult;
        });
    }

    function PoseStudioPanel(opts) {
        this.editor = opts.editor;
        this.rootEl = opts.rootEl;
        this.poseSelect = null;
        this.boneSelect = null;
        this.saveInput = null;
        this.sliderX = null;
        this.sliderY = null;
        this.sliderZ = null;
        this.valueX = null;
        this.valueY = null;
        this.valueZ = null;

        // Pose Navigator state
        this._navIndex = 0;
        this._navLabel = null;
        this._navCounter = null;
        this._navCategory = null;

        // Mouse bone editing toggle (disabled by default)
        this._mouseEditEnabled = false;

        // Skeleton line overlay state
        this._skeletonLinesEnabled = false;
        this._jointsAlwaysVisible = false;

        // Animation playback state
        this._isPlaying = false;
        this._playingAnimId = null;
        this._animSearchQuery = '';
    }

    PoseStudioPanel.prototype.init = function () {
        if (!this.rootEl) {
            return;
        }
        this._render();
        this._bind();
        this.refresh();
    };

    PoseStudioPanel.prototype._render = function () {
        this.rootEl.innerHTML =
            '<div class="pose-studio-card">' +
            '  <div class="pose-studio-header">' +
            '    <div>' +
            '      <div class="pose-studio-title">Pose Studio</div>' +
            '      <div class="pose-studio-subtitle">Presets, editing, and saved poses</div>' +
            '    </div>' +
            '    <div style="display:flex;gap:6px;align-items:center;">' +
            '      <button id="poseSkeletonToggleBtn" class="pose-header-icon-btn" title="Toggle skeleton lines">' +
            '        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '          <line x1="12" y1="2" x2="12" y2="6"/>' +
            '          <circle cx="12" cy="8" r="2"/>' +
            '          <line x1="12" y1="10" x2="12" y2="16"/>' +
            '          <line x1="12" y1="12" x2="8" y2="9"/>' +
            '          <line x1="12" y1="12" x2="16" y2="9"/>' +
            '          <line x1="12" y1="16" x2="9" y2="21"/>' +
            '          <line x1="12" y1="16" x2="15" y2="21"/>' +
            '        </svg>' +
            '      </button>' +
            '      <button id="poseJointVisToggleBtn" class="pose-header-icon-btn" title="Toggle joint visibility (hover-only / always visible)">' +
            '        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>' +
            '          <circle cx="12" cy="12" r="3"/>' +
            '        </svg>' +
            '      </button>' +
            '      <button id="poseStudioCloseBtn" class="secondary-btn small-btn">Close</button>' +
            '    </div>' +
            '  </div>' +
            // Section 1: Pose Navigator (Next / Back) — primary control
            '  <div class="pose-studio-section">' +
            '    <label class="pose-studio-label">Pose Navigator</label>' +
            '    <div class="pose-nav">' +
            '      <button id="poseNavPrev" class="pose-nav-btn" title="Previous pose (Left arrow)">' +
            '        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
            '      </button>' +
            '      <div class="pose-nav-info">' +
            '        <span id="poseNavCategory" class="pose-nav-category">Standing</span>' +
            '        <span id="poseNavLabel" class="pose-nav-label">Relaxed</span>' +
            '        <span id="poseNavCounter" class="pose-nav-counter">1 / ' +
            NAV_PRESETS.length +
            '</span>' +
            '      </div>' +
            '      <button id="poseNavNext" class="pose-nav-btn" title="Next pose (Right arrow)">' +
            '        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
            '      </button>' +
            '    </div>' +
            '  </div>' +
            // Section 2: Pose presets dropdown + user saved poses
            '  <div class="pose-studio-section">' +
            '    <label class="pose-studio-label">Poses</label>' +
            '    <select id="posePresetSelect" class="pose-studio-select"></select>' +
            '    <div class="pose-studio-actions">' +
            '      <button id="poseApplyBtn" class="primary-btn small-btn">Apply</button>' +
            '      <button id="poseResetBtn" class="secondary-btn small-btn">Reset All</button>' +
            '    </div>' +
            '  </div>' +
            // Section 3: Mouse Bone Editing Toggle
            '  <div class="pose-studio-section">' +
            '    <div class="pose-toggle-row">' +
            '      <label class="pose-studio-label" style="margin-bottom:0;">Mouse Bone Editing</label>' +
            '      <label class="pose-toggle">' +
            '        <input type="checkbox" id="poseMouseEditToggle" />' +
            '        <span class="pose-toggle-track"><span class="pose-toggle-thumb"></span></span>' +
            '      </label>' +
            '    </div>' +
            '    <div class="pose-toggle-hint">Click &amp; drag bones in viewport (off = slider only)</div>' +
            '  </div>' +
            // Section 4: Bone selector + bipolar sliders
            '  <div class="pose-studio-section">' +
            '    <label class="pose-studio-label">Selected bone</label>' +
            '    <select id="poseBoneSelect" class="pose-studio-select">' +
            '      <option value="head">Head</option>' +
            '      <option value="neck">Neck</option>' +
            '      <option value="chest">Chest</option>' +
            '      <option value="spine">Spine</option>' +
            '      <option value="hips">Hips</option>' +
            '      <option value="leftShoulder">Left Shoulder</option>' +
            '      <option value="leftUpperArm">Left Upper Arm</option>' +
            '      <option value="leftLowerArm">Left Lower Arm</option>' +
            '      <option value="leftHand">Left Hand</option>' +
            '      <option value="rightShoulder">Right Shoulder</option>' +
            '      <option value="rightUpperArm">Right Upper Arm</option>' +
            '      <option value="rightLowerArm">Right Lower Arm</option>' +
            '      <option value="rightHand">Right Hand</option>' +
            '      <option value="leftUpperLeg">Left Upper Leg</option>' +
            '      <option value="leftLowerLeg">Left Lower Leg</option>' +
            '      <option value="leftFoot">Left Foot</option>' +
            '      <option value="rightUpperLeg">Right Upper Leg</option>' +
            '      <option value="rightLowerLeg">Right Lower Leg</option>' +
            '      <option value="rightFoot">Right Foot</option>' +
            '    </select>' +
            // Bipolar sliders — Pitch (X), Yaw (Y), Roll (Z)
            '    <div class="pose-slider-group">' +
            '      <div class="pose-slider-row">' +
            '        <div class="pose-slider-head">' +
            '          <span class="pose-slider-label">Pitch <span class="pose-axis-tag">X</span></span>' +
            '          <span id="poseValueX" class="pose-slider-value">0\u00B0</span>' +
            '        </div>' +
            '        <input id="poseSliderX" class="pose-slider" type="range" min="-45" max="45" value="0" step="1" />' +
            '        <div class="pose-slider-scale"><span>\u221245\u00B0</span><span>0</span><span>+45\u00B0</span></div>' +
            '      </div>' +
            '      <div class="pose-slider-row">' +
            '        <div class="pose-slider-head">' +
            '          <span class="pose-slider-label">Yaw <span class="pose-axis-tag">Y</span></span>' +
            '          <span id="poseValueY" class="pose-slider-value">0\u00B0</span>' +
            '        </div>' +
            '        <input id="poseSliderY" class="pose-slider" type="range" min="-45" max="45" value="0" step="1" />' +
            '        <div class="pose-slider-scale"><span>\u221245\u00B0</span><span>0</span><span>+45\u00B0</span></div>' +
            '      </div>' +
            '      <div class="pose-slider-row">' +
            '        <div class="pose-slider-head">' +
            '          <span class="pose-slider-label">Roll <span class="pose-axis-tag">Z</span></span>' +
            '          <span id="poseValueZ" class="pose-slider-value">0\u00B0</span>' +
            '        </div>' +
            '        <input id="poseSliderZ" class="pose-slider" type="range" min="-90" max="90" value="0" step="1" />' +
            '        <div class="pose-slider-scale"><span>\u221290\u00B0</span><span>0</span><span>+90\u00B0</span></div>' +
            '      </div>' +
            '    </div>' +
            // Quick actions
            '    <div class="pose-studio-actions">' +
            '      <button id="poseResetSelectedBtn" class="secondary-btn small-btn">Reset Selected</button>' +
            '      <button id="poseMirrorBtn" class="secondary-btn small-btn">Mirror Arms</button>' +
            '    </div>' +
            '  </div>' +
            // Section 5: Save pose
            '  <div class="pose-studio-section">' +
            '    <label class="pose-studio-label">Save current pose</label>' +
            '    <input id="poseSaveName" class="pose-studio-input" type="text" placeholder="Pose name..." />' +
            '    <div class="pose-studio-actions">' +
            '      <button id="poseSaveBtn" class="primary-btn small-btn">Save Pose</button>' +
            '      <button id="poseUndoBtn" class="secondary-btn small-btn">Undo</button>' +
            '      <button id="poseRedoBtn" class="secondary-btn small-btn">Redo</button>' +
            '    </div>' +
            '  </div>' +
            // Section 6: Animations — unified grid with search, categories, playback
            '  <div class="pose-studio-section">' +
            '    <label class="pose-studio-label">Animations</label>' +
            '    <div class="pose-anim-hint">Tap an emote to preview it on the avatar</div>' +
            // Emotes category
            '    <div class="pose-anim-category">Emotes</div>' +
            '    <div id="poseAnimGridEmotes" class="pose-anim-grid"></div>' +
            // Spicy emotes (gated)
            '    <div class="spicy-gated" style="display:none;">' +
            '      <div class="pose-anim-category pose-anim-category--spicy">Spicy</div>' +
            '      <div id="poseAnimGridSpicy" class="pose-anim-grid"></div>' +
            '    </div>' +
            // Clip animations (populated dynamically from loaded model)
            '    <div id="poseAnimClipSection" style="display:none;">' +
            '      <div class="pose-anim-category">Clips</div>' +
            '      <div id="poseAnimGridClips" class="pose-anim-grid"></div>' +
            '    </div>' +
            // Playback controls
            '    <div class="pose-playback">' +
            '      <button id="posePlayToggleBtn" class="pose-playback-btn pose-playback-btn--play" title="Play / Stop">' +
            '        <svg id="posePlayIcon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>' +
            '        <svg id="poseStopIcon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="display:none;"><rect x="5" y="4" width="14" height="16" rx="2"/></svg>' +
            '      </button>' +
            '      <div class="pose-playback-speed">' +
            '        <span class="pose-playback-speed-label">Speed</span>' +
            '        <div class="pose-playback-speed-btns">' +
            '          <button class="pose-speed-btn" data-speed="0.5">0.5x</button>' +
            '          <button class="pose-speed-btn pose-speed-btn--active" data-speed="1">1x</button>' +
            '          <button class="pose-speed-btn" data-speed="2">2x</button>' +
            '        </div>' +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            // Section 7: Base Pose & Talk Style
            '  <div class="pose-studio-section">' +
            '    <label class="pose-studio-label">Base Pose</label>' +
            '    <select id="poseBasePoseSelect" class="pose-studio-select"></select>' +
            '    <label class="pose-studio-label" style="margin-top:8px;">Talk Style</label>' +
            '    <select id="poseTalkStyleSelect" class="pose-studio-select"></select>' +
            '  </div>' +
            '</div>';

        this.poseSelect = this.rootEl.querySelector('#posePresetSelect');
        this.boneSelect = this.rootEl.querySelector('#poseBoneSelect');
        this.saveInput = this.rootEl.querySelector('#poseSaveName');
        this._navLabel = this.rootEl.querySelector('#poseNavLabel');
        this._navCounter = this.rootEl.querySelector('#poseNavCounter');
        this._navCategory = this.rootEl.querySelector('#poseNavCategory');
        this.sliderX = this.rootEl.querySelector('#poseSliderX');
        this.sliderY = this.rootEl.querySelector('#poseSliderY');
        this.sliderZ = this.rootEl.querySelector('#poseSliderZ');
        this.valueX = this.rootEl.querySelector('#poseValueX');
        this.valueY = this.rootEl.querySelector('#poseValueY');
        this.valueZ = this.rootEl.querySelector('#poseValueZ');
    };

    PoseStudioPanel.prototype._bind = function () {
        const self = this;

        // --- Close ---
        const closeBtn = this.rootEl.querySelector('#poseStudioCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                self.rootEl.classList.add('hidden');
                self.editor.exit();
            });
        }

        // --- Preset apply (dropdown) ---
        const applyBtn = this.rootEl.querySelector('#poseApplyBtn');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                self._applySelectedPreset();
            });
        }

        // --- Reset All ---
        const resetBtn = this.rootEl.querySelector('#poseResetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                // Reset via VRPoseSystem (smooth blend to T-pose)
                const vps = window.vrPoseSystem;
                if (vps) {
                    vps.applyPreset('standing', 0.4);
                }
                self.editor.resetAll();
                self._resetSliders();
            });
        }

        // --- Reset Selected ---
        const resetSelectedBtn = this.rootEl.querySelector('#poseResetSelectedBtn');
        if (resetSelectedBtn) {
            resetSelectedBtn.addEventListener('click', () => {
                self.editor.resetSelected();
                self._resetSliders();
            });
        }

        // --- Mirror Arms ---
        const mirrorBtn = this.rootEl.querySelector('#poseMirrorBtn');
        if (mirrorBtn) {
            mirrorBtn.addEventListener('click', () => {
                self.editor.mirrorArms('left');
                self._syncSlidersFromBone();
            });
        }

        // --- Save Pose ---
        const saveBtn = this.rootEl.querySelector('#poseSaveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const name = self.saveInput.value.trim() || 'Custom Pose';
                self.editor.saveCurrentPose(name);
                self.saveInput.value = '';
                self.refresh();
            });
        }

        // --- Undo / Redo ---
        const undoBtn = this.rootEl.querySelector('#poseUndoBtn');
        if (undoBtn) {
            undoBtn.addEventListener('click', () => {
                self.editor.undo();
                self._syncSlidersFromBone();
            });
        }

        const redoBtn = this.rootEl.querySelector('#poseRedoBtn');
        if (redoBtn) {
            redoBtn.addEventListener('click', () => {
                self.editor.redo();
                self._syncSlidersFromBone();
            });
        }

        // --- Pose Navigator (Next / Back) ---
        const prevBtn = this.rootEl.querySelector('#poseNavPrev');
        const nextBtn = this.rootEl.querySelector('#poseNavNext');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                self._navigatePose(-1);
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                self._navigatePose(1);
            });
        }

        // Keyboard: left/right arrows when panel is visible
        this._keyHandler = (e) => {
            if (self.rootEl.classList.contains('hidden')) {
                return;
            }
            // Don't capture when user is typing in an input
            const tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') {
                return;
            }
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                self._navigatePose(-1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                self._navigatePose(1);
            }
        };
        document.addEventListener('keydown', this._keyHandler);

        // Sync navigator when VR-side changes the pose
        this._vrPoseListener = (e) => {
            if (e.detail && e.detail.preset) {
                const idx = NAV_PRESETS.findIndex((p) => p.name === e.detail.preset);
                if (idx !== -1) {
                    self._navIndex = idx;
                    self._updateNavDisplay();
                }
            }
        };
        window.addEventListener('vr-pose-changed', this._vrPoseListener);

        // Also apply on dropdown change (double-click / select-then-apply)
        if (this.poseSelect) {
            this.poseSelect.addEventListener('dblclick', () => {
                self._applySelectedPreset();
            });
        }

        // --- Bone selector ---
        if (this.boneSelect) {
            this.boneSelect.addEventListener('change', () => {
                self.editor.selectBone(self.boneSelect.value);
                self._syncSlidersFromBone();
            });
        }

        // --- Bipolar sliders ---
        // Track whether user has started dragging (for undo snapshot)
        let sliderUndoPushed = false;

        const bindSlider = (slider, valueEl, axis) => {
            if (!slider || !valueEl) {
                return;
            }

            // Push undo on first drag interaction
            slider.addEventListener('mousedown', () => {
                if (!sliderUndoPushed) {
                    sliderUndoPushed = true;
                    if (self.editor._pushUndoSnapshot) {
                        self.editor._pushUndoSnapshot();
                    }
                }
            });
            slider.addEventListener(
                'touchstart',
                () => {
                    if (!sliderUndoPushed) {
                        sliderUndoPushed = true;
                        if (self.editor._pushUndoSnapshot) {
                            self.editor._pushUndoSnapshot();
                        }
                    }
                },
                { passive: true }
            );

            // Live update while dragging
            slider.addEventListener('input', () => {
                const deg = Number(slider.value || 0);
                valueEl.textContent = `${deg}\u00B0`;
                self.editor.setSelectedAxisDegrees(axis, deg);
            });

            // Reset undo flag when drag ends
            slider.addEventListener('mouseup', () => {
                sliderUndoPushed = false;
            });
            slider.addEventListener(
                'touchend',
                () => {
                    sliderUndoPushed = false;
                },
                { passive: true }
            );
        };

        bindSlider(this.sliderX, this.valueX, 'x');
        bindSlider(this.sliderY, this.valueY, 'y');
        bindSlider(this.sliderZ, this.valueZ, 'z');

        // --- Mouse bone editing toggle ---
        const mouseToggle = this.rootEl.querySelector('#poseMouseEditToggle');
        if (mouseToggle) {
            mouseToggle.checked = false; // disabled by default
            mouseToggle.addEventListener('change', () => {
                self._mouseEditEnabled = mouseToggle.checked;
                const gizmo = window.NEXUS_POSE_GIZMO_OVERLAY;
                if (gizmo) {
                    if (self._mouseEditEnabled) {
                        gizmo.enable();
                    } else {
                        gizmo.disable();
                    }
                }
            });
        }

        // --- Skeleton line overlay toggle ---
        const skeletonToggleBtn = this.rootEl.querySelector('#poseSkeletonToggleBtn');
        if (skeletonToggleBtn) {
            skeletonToggleBtn.addEventListener('click', () => {
                const overlay = window.NEXUS_SKELETON_LINE_OVERLAY;
                if (!overlay) return;

                self._skeletonLinesEnabled = !self._skeletonLinesEnabled;
                if (self._skeletonLinesEnabled) {
                    overlay.enable();
                    skeletonToggleBtn.classList.add('pose-header-icon-btn--active');
                } else {
                    overlay.disable();
                    skeletonToggleBtn.classList.remove('pose-header-icon-btn--active');
                }
            });
        }

        // --- Joint visibility toggle (hover-only vs always-visible) ---
        const jointVisToggleBtn = this.rootEl.querySelector('#poseJointVisToggleBtn');
        if (jointVisToggleBtn) {
            // Restore saved state
            const overlay = window.NEXUS_SKELETON_LINE_OVERLAY;
            if (overlay && overlay.getHandlesAlwaysVisible()) {
                self._jointsAlwaysVisible = true;
                jointVisToggleBtn.classList.add('pose-header-icon-btn--active');
            }

            jointVisToggleBtn.addEventListener('click', () => {
                const ol = window.NEXUS_SKELETON_LINE_OVERLAY;
                if (!ol) return;

                self._jointsAlwaysVisible = ol.toggleHandlesVisible();
                if (self._jointsAlwaysVisible) {
                    jointVisToggleBtn.classList.add('pose-header-icon-btn--active');
                    jointVisToggleBtn.title = 'Joints: always visible (click to toggle)';
                } else {
                    jointVisToggleBtn.classList.remove('pose-header-icon-btn--active');
                    jointVisToggleBtn.title = 'Joints: hover-only (click to toggle)';
                }
            });
        }

        // --- Animation grid buttons (emotes + clips) ---
        // Delegated handler on the animation grids
        const animGridHandler = (e) => {
            const btn = e.target.closest('.pose-anim-chip');
            if (!btn) return;
            const animId = btn.dataset.anim;
            if (!animId) return;
            self._playAnimation(animId);
        };
        ['poseAnimGridEmotes', 'poseAnimGridSpicy', 'poseAnimGridClips'].forEach((id) => {
            const grid = self.rootEl.querySelector('#' + id);
            if (grid) grid.addEventListener('click', animGridHandler);
        });

        // --- Play / Stop toggle button ---
        const playToggle = this.rootEl.querySelector('#posePlayToggleBtn');
        if (playToggle) {
            playToggle.addEventListener('click', () => {
                if (self._isPlaying) {
                    self._stopAnimation();
                } else {
                    // Play the last selected or first available
                    const activeChip = self.rootEl.querySelector('.pose-anim-chip--active');
                    const animId = activeChip ? activeChip.dataset.anim : 'idle';
                    self._playAnimation(animId);
                }
            });
        }

        // --- Speed buttons ---
        this.rootEl.querySelectorAll('.pose-speed-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const speed = parseFloat(btn.dataset.speed) || 1;
                // Update active state
                self.rootEl.querySelectorAll('.pose-speed-btn').forEach((b) => {
                    b.classList.remove('pose-speed-btn--active');
                });
                btn.classList.add('pose-speed-btn--active');
                // Apply speed to ProceduralAnimator if available
                try {
                    if (window.NEXUS_PROCEDURAL_ANIMATOR?.setSpeed) {
                        window.NEXUS_PROCEDURAL_ANIMATOR.setSpeed(speed);
                    }
                } catch (_) {}
            });
        });

        // --- Base Pose selector ---
        const basePoseSelect = this.rootEl.querySelector('#poseBasePoseSelect');
        if (basePoseSelect) {
            basePoseSelect.addEventListener('change', () => {
                window.NEXUS_PROCEDURAL_ANIMATOR?.setBasePose?.(basePoseSelect.value);
            });
        }

        // --- Talk Style selector ---
        const talkStyleSelect = this.rootEl.querySelector('#poseTalkStyleSelect');
        if (talkStyleSelect) {
            talkStyleSelect.addEventListener('change', () => {
                window.NEXUS_PROCEDURAL_ANIMATOR?.setTalkStyle?.(talkStyleSelect.value);
            });
        }

        // Animation Library UI removed — only emotes + model clips shown
    };

    /**
     * Play an animation by ID and update UI state.
     */
    PoseStudioPanel.prototype._playAnimation = function (animId) {
        if (!animId) return;

        // Stop any current animation first
        if (this._isPlaying) {
            this._stopAnimation();
        }

        this._playingAnimId = animId;
        this._isPlaying = true;

        // Update chip active state
        this.rootEl.querySelectorAll('.pose-anim-chip').forEach(function (chip) {
            chip.classList.toggle('pose-anim-chip--active', chip.dataset.anim === animId);
        });

        // Update play/stop button icon
        this._updatePlayBtn();

        // Play via AnimationManager
        if (window.NEXUS_ANIMATION_MANAGER?.play) {
            window.NEXUS_ANIMATION_MANAGER.play(animId, false);
        } else if (window.NEXUS_ANIMATION_MANAGER?.applyEmotion) {
            window.NEXUS_ANIMATION_MANAGER.applyEmotion(animId);
        } else {
            try {
                window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.(animId, animId === 'talk' ? 30000 : 5000);
            } catch (_) {}
            if (window.setEmotionIcon) window.setEmotionIcon(animId);
        }

        // Auto-return to idle after animation finishes (duration from presets)
        var AP = window.NEXUS_ANIMATION_PRESETS;
        var dur = AP && AP.getDuration ? AP.getDuration(animId) : 5000;
        if (!dur) dur = 5000;
        if (animId !== 'idle') {
            var self = this;
            this._playTimer = setTimeout(function () {
                if (self._isPlaying && self._playingAnimId === animId) {
                    self._stopAnimation();
                }
            }, dur + 200);
        }
    };

    /**
     * Stop current animation and reset UI.
     */
    PoseStudioPanel.prototype._stopAnimation = function () {
        this._isPlaying = false;
        this._playingAnimId = null;
        if (this._playTimer) {
            clearTimeout(this._playTimer);
            this._playTimer = null;
        }

        // Stop via AnimationManager
        if (window.NEXUS_ANIMATION_MANAGER?.stopAll) {
            window.NEXUS_ANIMATION_MANAGER.stopAll();
        }
        try {
            window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.('idle', 1);
        } catch (_) {}

        // Clear active chip
        this.rootEl.querySelectorAll('.pose-anim-chip').forEach(function (chip) {
            chip.classList.remove('pose-anim-chip--active');
        });

        this._updatePlayBtn();
    };

    /**
     * Update the play/stop toggle button appearance.
     */
    PoseStudioPanel.prototype._updatePlayBtn = function () {
        var playIcon = this.rootEl.querySelector('#posePlayIcon');
        var stopIcon = this.rootEl.querySelector('#poseStopIcon');
        var btn = this.rootEl.querySelector('#posePlayToggleBtn');
        if (playIcon) playIcon.style.display = this._isPlaying ? 'none' : '';
        if (stopIcon) stopIcon.style.display = this._isPlaying ? '' : 'none';
        if (btn) {
            btn.classList.toggle('pose-playback-btn--playing', this._isPlaying);
        }
    };

    /**
     * Filter the animation grid chips by search query.
     */
    PoseStudioPanel.prototype._filterAnimGrid = function () {
        var q = this._animSearchQuery || '';
        this.rootEl.querySelectorAll('.pose-anim-chip').forEach(function (chip) {
            var label = (chip.textContent || '').toLowerCase();
            var id = (chip.dataset.anim || '').toLowerCase();
            var match = !q || label.indexOf(q) !== -1 || id.indexOf(q) !== -1;
            chip.style.display = match ? '' : 'none';
        });
    };

    /**
     * Render the animation grid chips into the grid containers.
     */
    PoseStudioPanel.prototype._renderAnimGrids = function () {
        var spicy = window.NEXUS_SPICY && window.NEXUS_SPICY.isEnabled();
        var AP = window.NEXUS_ANIMATION_PRESETS;

        // SFW emotes — read from centralized presets
        var sfwEmotions = AP && AP.EMOTIONS ? AP.EMOTIONS : [];
        var emotesGrid = this.rootEl.querySelector('#poseAnimGridEmotes');
        if (emotesGrid) {
            var html = '';
            for (var i = 0; i < sfwEmotions.length; i++) {
                var e = sfwEmotions[i];
                html +=
                    '<button class="pose-anim-chip" data-anim="' +
                    e.id +
                    '">' +
                    '<span class="pose-anim-chip-icon">' +
                    e.icon +
                    '</span>' +
                    '<span class="pose-anim-chip-label">' +
                    e.label +
                    '</span>' +
                    '</button>';
            }
            emotesGrid.innerHTML = html;
        }

        // Spicy emotes — read from centralized presets
        var spicyGrid = this.rootEl.querySelector('#poseAnimGridSpicy');
        if (spicyGrid) {
            var spicyEmotions = AP && AP.ADULT_EMOTIONS ? AP.ADULT_EMOTIONS : [];
            var shtml = '';
            for (var j = 0; j < spicyEmotions.length; j++) {
                var se = spicyEmotions[j];
                shtml +=
                    '<button class="pose-anim-chip pose-anim-chip--spicy" data-anim="' +
                    se.id +
                    '">' +
                    '<span class="pose-anim-chip-icon">' +
                    se.icon +
                    '</span>' +
                    '<span class="pose-anim-chip-label">' +
                    se.label +
                    '</span>' +
                    '</button>';
            }
            spicyGrid.innerHTML = shtml;
        }

        // Clip animations (from AnimationManager)
        var clipSection = this.rootEl.querySelector('#poseAnimClipSection');
        var clipGrid = this.rootEl.querySelector('#poseAnimGridClips');
        if (clipGrid && window.NEXUS_ANIMATION_MANAGER?.getAvailableAnimations) {
            var allAnims = window.NEXUS_ANIMATION_MANAGER.getAvailableAnimations();
            var clips = allAnims.filter(function (a) {
                return a.category === 'clip';
            });
            if (clips.length > 0) {
                if (clipSection) clipSection.style.display = '';
                var chtml = '';
                for (var k = 0; k < clips.length; k++) {
                    chtml +=
                        '<button class="pose-anim-chip" data-anim="' +
                        clips[k].id +
                        '">' +
                        '<span class="pose-anim-chip-icon">\u{1F3AC}</span>' +
                        '<span class="pose-anim-chip-label">' +
                        clips[k].label.replace(/\u{1F3AC}\s*/u, '') +
                        '</span>' +
                        '</button>';
                }
                clipGrid.innerHTML = chtml;
            } else {
                if (clipSection) clipSection.style.display = 'none';
            }
        }
    };

    /**
     * Populate the Animation Library category dropdown from manifest.
     */
    PoseStudioPanel.prototype._populateAnimLibrary = function () {
        var catSelect = this.rootEl.querySelector('#poseAnimLibCategory');
        if (!catSelect) return;

        var loader = window.NEXUS_CLIP_LOADER;
        if (!loader) {
            // Retry after manifest loads
            var self = this;
            setTimeout(function () {
                self._populateAnimLibrary();
            }, 1000);
            return;
        }

        var cats = loader.getCategories();
        if (!cats || Object.keys(cats).length === 0) {
            // Manifest may not be loaded yet, retry
            var self2 = this;
            setTimeout(function () {
                self2._populateAnimLibrary();
            }, 1500);
            return;
        }

        var html = '<option value="">-- Select Category (' + Object.keys(cats).length + ') --</option>';
        var keys = Object.keys(cats);
        for (var i = 0; i < keys.length; i++) {
            var cat = cats[keys[i]];
            var fileCount = (cat.files || []).length;
            html += '<option value="' + keys[i] + '">' + cat.icon + ' ' + cat.label + ' (' + fileCount + ')</option>';
        }
        catSelect.innerHTML = html;
    };

    /**
     * Populate the Animation Library clip dropdown for a given category.
     */
    PoseStudioPanel.prototype._populateAnimLibClips = function (categoryKey) {
        var clipSelect = this.rootEl.querySelector('#poseAnimLibClip');
        var libStatus = this.rootEl.querySelector('#poseAnimLibStatus');
        if (!clipSelect) return;

        if (!categoryKey) {
            clipSelect.innerHTML = '<option value="">-- Select Animation --</option>';
            if (libStatus) libStatus.textContent = '';
            return;
        }

        var loader = window.NEXUS_CLIP_LOADER;
        if (!loader) return;

        var cats = loader.getCategories();
        var cat = cats[categoryKey];
        if (!cat || !cat.files) {
            clipSelect.innerHTML = '<option value="">No animations found</option>';
            return;
        }

        var html = '<option value="">-- Select Animation (' + cat.files.length + ') --</option>';
        for (var i = 0; i < cat.files.length; i++) {
            var file = cat.files[i];
            var name = file
                .split('/')
                .pop()
                .replace(/\.(bvh|vrma|fbx)$/i, '');
            var label = name
                .replace(/^(action_|dance_|exercise_|emotion_)/, '')
                .replace(/_/g, ' ')
                .replace(/(\d+)$/, ' $1')
                .trim();
            label = label.charAt(0).toUpperCase() + label.slice(1);
            html += '<option value="' + file + '">' + label + '</option>';
        }
        clipSelect.innerHTML = html;
        if (libStatus) libStatus.textContent = cat.files.length + ' animations available';
    };

    /**
     * Apply the currently selected preset from the dropdown.
     * Routes VRPoseSystem presets through VRPoseSystem (smooth blend),
     * user-saved poses through PoseEditor.
     */
    PoseStudioPanel.prototype._applySelectedPreset = function () {
        const selectedValue = this.poseSelect ? this.poseSelect.value : '';
        if (!selectedValue) return;

        // Check if it's a VRPoseSystem preset (matches NAV_PRESETS name)
        const vrPreset = NAV_PRESETS.find((p) => p.name === selectedValue);

        if (vrPreset) {
            // Apply via VRPoseSystem — smooth blended transition on the 3D character
            const vps = window.vrPoseSystem;
            if (vps) {
                vps.applyPreset(vrPreset.name, 0.5);
            }
            // Sync navigator to this preset
            const idx = NAV_PRESETS.indexOf(vrPreset);
            if (idx !== -1) {
                this._navIndex = idx;
                this._updateNavDisplay();
            }
        } else {
            // User-saved pose — apply via PoseEditor (delta quaternions)
            this.editor.applyPoseById(selectedValue);
        }

        this._syncSlidersFromBone();
    };

    /**
     * Navigate poses: direction = -1 (back) or +1 (next).
     * Always applies via VRPoseSystem for smooth blended transition on the 3D character.
     */
    PoseStudioPanel.prototype._navigatePose = function (direction) {
        const filtered = getFilteredPresets();
        const len = filtered.length;
        this._navIndex = (((this._navIndex + direction) % len) + len) % len;

        const preset = filtered[this._navIndex];
        this._updateNavDisplay();

        // Apply via VRPoseSystem — always (desktop + VR unified)
        const vps = window.vrPoseSystem;
        if (vps) {
            vps.applyPreset(preset.name, 0.5);
        }

        // Sync the dropdown selection
        if (this.poseSelect) {
            const options = this.poseSelect.options;
            for (let i = 0; i < options.length; i++) {
                if (options[i].value === preset.name) {
                    this.poseSelect.selectedIndex = i;
                    break;
                }
            }
        }

        this._syncSlidersFromBone();
    };

    /**
     * Update the navigator display (label, counter, category badge).
     */
    PoseStudioPanel.prototype._updateNavDisplay = function () {
        const filtered = getFilteredPresets();
        if (this._navIndex >= filtered.length) this._navIndex = 0;
        const preset = filtered[this._navIndex];
        if (this._navLabel) {
            this._navLabel.textContent = preset.label;
        }
        if (this._navCounter) {
            this._navCounter.textContent = `${this._navIndex + 1} / ${filtered.length}`;
        }
        if (this._navCategory) {
            this._navCategory.textContent = preset.category;
        }
    };

    /**
     * Reset all sliders to 0 (center position).
     */
    PoseStudioPanel.prototype._resetSliders = function () {
        const axes = ['X', 'Y', 'Z'];
        for (let i = 0; i < axes.length; i++) {
            const a = axes[i];
            const slider = this.rootEl.querySelector(`#poseSlider${a}`);
            const value = this.rootEl.querySelector(`#poseValue${a}`);
            if (slider) {
                slider.value = '0';
            }
            if (value) {
                value.textContent = '0\u00B0';
            }
        }
    };

    /**
     * Read current bone's axis state from the applier and sync sliders.
     */
    PoseStudioPanel.prototype._syncSlidersFromBone = function () {
        const editor = this.editor;
        if (!editor || !editor.applier || !editor.selectedBone) {
            this._resetSliders();
            return;
        }

        const state = editor.applier.axisState && editor.applier.axisState[editor.selectedBone];
        if (!state) {
            this._resetSliders();
            return;
        }

        // Convert radians → degrees and update sliders
        const rad2deg = 180 / Math.PI;
        const xDeg = Math.round(state.x * rad2deg);
        const yDeg = Math.round(state.y * rad2deg);
        const zDeg = Math.round(state.z * rad2deg);

        if (this.sliderX) {
            this.sliderX.value = String(Math.max(-45, Math.min(45, xDeg)));
        }
        if (this.sliderY) {
            this.sliderY.value = String(Math.max(-45, Math.min(45, yDeg)));
        }
        if (this.sliderZ) {
            this.sliderZ.value = String(Math.max(-90, Math.min(90, zDeg)));
        }
        if (this.valueX) {
            this.valueX.textContent = `${xDeg}\u00B0`;
        }
        if (this.valueY) {
            this.valueY.textContent = `${yDeg}\u00B0`;
        }
        if (this.valueZ) {
            this.valueZ.textContent = `${zDeg}\u00B0`;
        }
    };

    /**
     * Refresh the dropdown with VRPoseSystem presets + user-saved poses.
     * Single source of truth — no more duplicate built-in poses.
     */
    PoseStudioPanel.prototype.refresh = function () {
        if (!this.poseSelect) {
            return;
        }

        let html = '';

        // VRPoseSystem presets (single source of truth, filtered by spicy mode)
        var filtered = getFilteredPresets();
        for (let i = 0; i < filtered.length; i++) {
            const p = filtered[i];
            html += `<option value="${p.name}">\u2605 ${p.category} \u2014 ${p.label}</option>`;
        }

        // User-saved poses (from PoseLibrary via PoseEditor)
        const state = this.editor.getState();
        const userPoses = state.userPoses || [];
        if (userPoses.length > 0) {
            html += '<option disabled>\u2500\u2500\u2500 Saved Poses \u2500\u2500\u2500</option>';
            for (let i = 0; i < userPoses.length; i++) {
                const pose = userPoses[i];
                html += `<option value="${pose.id}">${pose.name}</option>`;
            }
        }

        this.poseSelect.innerHTML = html;

        // Sync dropdown to current navigator position
        const currentPreset = filtered[this._navIndex];
        if (currentPreset) {
            const options = this.poseSelect.options;
            for (let i = 0; i < options.length; i++) {
                if (options[i].value === currentPreset.name) {
                    this.poseSelect.selectedIndex = i;
                    break;
                }
            }
        }

        if (state.selectedBone && this.boneSelect) {
            this.boneSelect.value = state.selectedBone;
        }

        this._syncSlidersFromBone();

        // Render animation grid chips
        this._renderAnimGrids();

        // Populate base pose dropdown
        const basePoseSelect = this.rootEl.querySelector('#poseBasePoseSelect');
        if (basePoseSelect) {
            let bpHtml = '';
            if (window.NEXUS_ANIMATION_MANAGER?.getBasePoses) {
                const poses = window.NEXUS_ANIMATION_MANAGER.getBasePoses();
                for (let i = 0; i < poses.length; i++) {
                    bpHtml += `<option value="${poses[i].id}">${poses[i].label}</option>`;
                }
            }
            if (!bpHtml) {
                bpHtml =
                    '<option value="lecturerNeutral">Lecturer (Neutral)</option>' +
                    '<option value="presenterOpen">Presenter (Open)</option>' +
                    '<option value="anchorGrounded">Anchor (Grounded)</option>' +
                    '<option value="confident">Confident</option>' +
                    '<option value="lounge">Lounge</option>' +
                    '<option value="shy">Shy</option>' +
                    '<option value="elegant">Elegant</option>' +
                    '<option value="intimateSafe">Intimate</option>' +
                    '<option value="conversational">Conversational</option>';
            }
            basePoseSelect.innerHTML = bpHtml;
        }

        // Refresh talk style dropdown (includes adult styles when spicy)
        const talkSelect = this.rootEl.querySelector('#poseTalkStyleSelect');
        if (talkSelect) {
            let tsHtml = '';
            if (window.NEXUS_ANIMATION_MANAGER?.getTalkStyles) {
                const styles = window.NEXUS_ANIMATION_MANAGER.getTalkStyles();
                for (let i = 0; i < styles.length; i++) {
                    tsHtml += `<option value="${styles[i].id}">${styles[i].label}</option>`;
                }
            }
            if (!tsHtml) {
                tsHtml =
                    '<option value="explainCalm">Explain (Calm)</option>' +
                    '<option value="explainEmphasis">Explain (Emphasis)</option>' +
                    '<option value="broadcastAnchor">Broadcast (Anchor)</option>';
            }
            talkSelect.innerHTML = tsHtml;
        }

        // Update nav display for new filtered count
        this._updateNavDisplay();

        // Toggle spicy-gated sections visibility
        var spicy = window.NEXUS_SPICY && window.NEXUS_SPICY.isEnabled();
        var gated = this.rootEl.querySelectorAll('.spicy-gated');
        for (var g = 0; g < gated.length; g++) {
            gated[g].style.display = spicy ? '' : 'none';
        }
    };

    PoseStudioPanel.prototype.show = function () {
        this.rootEl.classList.remove('hidden');
        this.refresh();

        // On first open, apply the first pose (Lecturer) to the character
        if (!this._hasAppliedInitialPose) {
            this._hasAppliedInitialPose = true;
            var filtered = getFilteredPresets();
            if (filtered.length > 0) {
                this._navIndex = 0;
                var vps = window.vrPoseSystem;
                if (vps) {
                    vps.applyPreset(filtered[0].name, 0.5);
                }
                this._updateNavDisplay();
            }
        }
    };

    window.NEXUS_POSE_STUDIO_PANEL = PoseStudioPanel;
})();
