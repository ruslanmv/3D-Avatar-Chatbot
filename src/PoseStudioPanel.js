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
        // Standing
        { name: 'standingRelaxed', label: 'Relaxed', category: 'Standing' },
        { name: 'standingFriendly', label: 'Friendly', category: 'Standing' },
        { name: 'standingHandsClasped', label: 'Hands Clasped', category: 'Standing' },
        { name: 'standingBendForward', label: 'Bent Over', category: 'Standing' },
        // Sitting
        { name: 'sitting', label: 'Sitting', category: 'Sitting' },
        { name: 'sittingCrossed', label: 'Crossed', category: 'Sitting' },
        { name: 'sittingDesk', label: 'Desk', category: 'Sitting' },
        { name: 'sittingLegsUp', label: 'Lounging', category: 'Sitting' },
        // Kneeling
        { name: 'kneeling', label: 'Kneeling', category: 'Kneeling' },
        { name: 'kneelingUp', label: 'Kneeling (Up)', category: 'Kneeling' },
        { name: 'kneelingPresent', label: 'Present', category: 'Kneeling' },
        // Lying
        { name: 'lyingBack', label: 'Back', category: 'Lying' },
        { name: 'lyingBackRelaxed', label: 'Relaxed', category: 'Lying' },
        { name: 'lyingBackOpen', label: 'Open', category: 'Lying' },
        { name: 'lyingFront', label: 'Front', category: 'Lying' },
        { name: 'lyingFrontArched', label: 'Arched', category: 'Lying' },
        { name: 'lyingSide', label: 'Side', category: 'Lying' },
        { name: 'lyingSideSeductive', label: 'Side Pose', category: 'Lying' },
        // Ground
        { name: 'allFours', label: 'All Fours', category: 'Ground' },
        { name: 'allFoursArched', label: 'All Fours (Arched)', category: 'Ground' },
        // Technical
        { name: 'standing', label: 'T-Pose (Reset)', category: 'Reset' },
    ];

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
            '    <button id="poseStudioCloseBtn" class="secondary-btn small-btn">Close</button>' +
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
            // Section 3: Bone selector + bipolar sliders
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
            // Section 4: Save pose
            '  <div class="pose-studio-section">' +
            '    <label class="pose-studio-label">Save current pose</label>' +
            '    <input id="poseSaveName" class="pose-studio-input" type="text" placeholder="Pose name..." />' +
            '    <div class="pose-studio-actions">' +
            '      <button id="poseSaveBtn" class="primary-btn small-btn">Save Pose</button>' +
            '      <button id="poseUndoBtn" class="secondary-btn small-btn">Undo</button>' +
            '      <button id="poseRedoBtn" class="secondary-btn small-btn">Redo</button>' +
            '    </div>' +
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
        const len = NAV_PRESETS.length;
        this._navIndex = (((this._navIndex + direction) % len) + len) % len;

        const preset = NAV_PRESETS[this._navIndex];
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
        const preset = NAV_PRESETS[this._navIndex];
        if (this._navLabel) {
            this._navLabel.textContent = preset.label;
        }
        if (this._navCounter) {
            this._navCounter.textContent = `${this._navIndex + 1} / ${NAV_PRESETS.length}`;
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

        // VRPoseSystem presets (single source of truth)
        for (let i = 0; i < NAV_PRESETS.length; i++) {
            const p = NAV_PRESETS[i];
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
        const currentPreset = NAV_PRESETS[this._navIndex];
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
    };

    PoseStudioPanel.prototype.show = function () {
        this.rootEl.classList.remove('hidden');
        this.refresh();
    };

    window.NEXUS_POSE_STUDIO_PANEL = PoseStudioPanel;
})();
