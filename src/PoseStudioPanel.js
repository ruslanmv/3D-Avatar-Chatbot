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
        // PS2. The pose 'Crossed' used to be: both thighs apart. Kept under its own name.
        { name: 'sittingWide', label: 'Wide', category: 'Sitting' },
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
        { name: 'handsKnees', label: 'Hands and Knees (Candidate)', category: 'Ground', adult: true },
        // Adult — MMORPG-inspired (Spicy Mode only)
        { name: 'lyingKiss', label: 'Kiss Me', category: 'Adult', adult: true },
        { name: 'standingSeductive', label: 'Seductive', category: 'Adult', adult: true },
        { name: 'wallLean', label: 'Wall Lean', category: 'Adult', adult: true },
        { name: 'lapSitting', label: 'Lap Sitting', category: 'Adult', adult: true },
        { name: 'embraceStanding', label: 'Embrace', category: 'Adult', adult: true },
        { name: 'kneelSubmissive', label: 'Submissive', category: 'Adult', adult: true },
        { name: 'lyingSprawl', label: 'Sprawl', category: 'Adult', adult: true },
        // UN24. Seated and kneeling with the knees apart (VRPoseSystem has the measured signs).
        { name: 'sittingOpen', label: 'Sitting Open', category: 'Adult', adult: true },
        { name: 'kneelingWide', label: 'Kneeling Wide', category: 'Adult', adult: true },
        { name: 'seatedChair', label: 'Seated (Chair)', category: 'Adult', adult: true },
        { name: 'lyingKneesUp', label: 'Knees Up', category: 'Adult', adult: true }, // UN26
        { name: 'straddle', label: 'Straddling', category: 'Adult', adult: true },
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
        // UI3. Advanced only: out of the navigator's cycle and the Poses list (Advanced ▸ Start
        // from T-pose), still in catalogue(), so asking for a T-pose in words keeps working.
        { name: 'standing', label: 'T-Pose (Reset)', category: 'Reset', advanced: true },
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

    /**
     * UI3. What the navigator steps through and the Poses list offers: the presets for this mode,
     * minus the advanced ones. Someone pressing › through presets used to land on a T-pose as the
     * 26th "pose", which reads as the avatar breaking.
     */
    function getNavPresets() {
        return getFilteredPresets().filter(function (p) {
            return !p.advanced;
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
            // Bottom-sheet drag affordance (mobile only — hidden by CSS elsewhere).
            '  <div class="pose-sheet-grabber" aria-hidden="true"></div>' +
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
            // UN25. How fast she moves from one pose to the next (PoseTransition's multiplier).
            '    <label class="pose-studio-label" for="poseTransitionSpeed">Transition speed</label>' +
            '    <select id="poseTransitionSpeed" class="pose-studio-select">' +
            '      <option value="slow">Slow</option>' +
            '      <option value="normal" selected>Normal</option>' +
            '      <option value="fast">Fast</option>' +
            '    </select>' +
            '  </div>' +
            // Section 1b: T-Pose Correction — intensity slider + natural pose preset
            // UI3. The everyday control — how her arms rest — stays in view. The T-pose and the
            // correction strength move into a closed "Advanced" section (below): a T-pose is a
            // rig's neutral, which to anyone else looks like a broken avatar, and the strength
            // reaches every surface, not only this panel.
            '  <div class="pose-studio-section">' +
            '    <label class="pose-studio-label">Natural Pose Style</label>' +
            '    <select id="poseTposePresetSelect" class="pose-studio-select">' +
            '      <option value="relaxedStanding">Relaxed Standing (40\u00B0 arms)</option>' +
            '      <option value="naturalIdle" selected>Natural Idle (55\u00B0 arms)</option>' +
            '      <option value="portrait">Portrait / Thumbnail (65\u00B0 arms)</option>' +
            '      <option value="presentation">Presentation (30\u00B0 arms)</option>' +
            '    </select>' +
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
            // UI3/UI4. Advanced, closed by default: the tools for building a pose by hand — the
            // T-pose and correction strength, bone editing (mouse, Puppet IK, per-bone sliders, reset,
            // mirror) and saving with undo. Hard to use well from a panel, and the everyday path (pick
            // a pose, Apply, Reset All, a Behavior chip) needs none of it, so it stays out of sight
            // until someone opens it.
            '  <details id="poseAdvanced" class="pose-studio-section pose-studio-advanced">' +
            '    <summary class="pose-studio-label" style="cursor:pointer;user-select:none;">Advanced</summary>' +
            '    <div style="padding-top:8px;">' +
            '      <div class="pose-toggle-hint" style="margin-bottom:8px;">For building a pose by hand. Pick a pose above for everyday use.</div>' +
            '      <label class="pose-studio-label">T-Pose Correction</label>' +
            '      <div class="pose-slider-row">' +
            '        <div class="pose-slider-head">' +
            '          <span class="pose-slider-label">Intensity</span>' +
            '          <span id="poseTposeIntensityValue" class="pose-slider-value">1.00</span>' +
            '        </div>' +
            '        <input id="poseTposeIntensitySlider" class="pose-slider pose-slider--tpose" type="range" min="0" max="150" value="100" step="1" />' +
            '        <div class="pose-slider-scale"><span>0</span><span>0.5</span><span>1.0</span><span>1.5</span></div>' +
            '      </div>' +
            '      <div class="pose-toggle-hint">1.0 = natural standing (recommended). Below 0.5 she is near a T-pose; that applies for this visit only and is not remembered.</div>' +
            '      <div class="pose-studio-actions">' +
            '        <button id="poseTposeRestoreBtn" class="secondary-btn small-btn">Restore recommended (1.0)</button>' +
            '        <button id="poseTposeStartBtn" class="secondary-btn small-btn" title="The rig\u2019s neutral pose, to build a pose from zero">Start from T-pose</button>' +
            '      </div>' +
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
            '    <div class="pose-toggle-row" style="margin-top:8px;">' +
            '      <label class="pose-studio-label" style="margin-bottom:0;">Puppet Mode</label>' +
            '      <label class="pose-toggle">' +
            '        <input type="checkbox" id="posePuppetToggle" checked />' +
            '        <span class="pose-toggle-track"><span class="pose-toggle-thumb"></span></span>' +
            '      </label>' +
            '    </div>' +
            '    <div class="pose-toggle-hint">Drag moves the whole body naturally (IK). Off = rotate single bones</div>' +
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
            /* NEXUS_BD (UC-11) — publish a saved pose to the animation KB. Rendered
               only when behaviorEngine.enabled put the engine on the page. */
            (window.NEXUS_BD_ENABLED
                ? '      <button id="posePublishKbBtn" class="small-btn" title="Make this pose selectable by the Behavior Director">Publish to KB</button>'
                : '') +
            '      <button id="poseUndoBtn" class="secondary-btn small-btn">Undo</button>' +
            '      <button id="poseRedoBtn" class="secondary-btn small-btn">Redo</button>' +
            '    </div>' +
            '  </div>' +
            '    </div>' +
            '  </details>' +
            // Section 6: Animations — organized into Behavior / Motion / Talk
            '  <div class="pose-studio-section">' +
            '    <label class="pose-studio-label">\uD83C\uDFAD Behavior (Live)</label>' +
            '    <div class="pose-anim-hint">Procedural modes — avatar reacts in real-time</div>' +
            '    <div id="poseAnimGridEmotes" class="pose-anim-grid"></div>' +
            // Spicy emotes (gated)
            '    <div class="spicy-gated" style="display:none;">' +
            '      <div class="pose-anim-category pose-anim-category--spicy">Spicy</div>' +
            '      <div id="poseAnimGridSpicy" class="pose-anim-grid"></div>' +
            '    </div>' +
            '  </div>' +
            // Section 7: VRMA Studio Animations (default)
            '  <div class="pose-studio-section">' +
            '    <label class="pose-studio-label">\u2728 VRMA Animations</label>' +
            '    <div class="pose-anim-hint">VRM Animation clips \u2014 retargetable to any avatar</div>' +
            '    <select id="poseVrmaSelect" class="pose-studio-select"></select>' +
            '    <div class="pose-playback" style="margin-top:8px;">' +
            '      <button id="poseVrmaPlayBtn" class="pose-playback-btn pose-playback-btn--play" title="Play">' +
            '        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>' +
            '      </button>' +
            '      <button id="poseVrmaStopBtn" class="pose-playback-btn" title="Stop" style="display:none;">' +
            '        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="14" height="16" rx="2"/></svg>' +
            '      </button>' +
            '    </div>' +
            '  </div>' +
            // Section 8: BVH Library (experimental) — collapsed by default
            '  <details class="pose-studio-section" style="margin:0;padding:0;">' +
            '    <summary class="pose-studio-label" style="cursor:pointer;user-select:none;list-style:none;display:flex;align-items:center;gap:6px;">' +
            '      <span style="font-size:0.7rem;opacity:0.6;transition:transform 0.2s;" id="poseBvhArrow">\u25B6</span>' +
            '      \uD83E\uDDEA BVH Library <span style="font-size:0.65rem;opacity:0.5;font-weight:normal;">(experimental)</span>' +
            '    </summary>' +
            '    <div style="padding:8px 0 0;">' +
            '      <div class="pose-anim-hint">Motion capture clips \u2014 may need retarget tuning per avatar</div>' +
            '      <label class="pose-studio-sublabel">Category</label>' +
            '      <select id="poseBvhCategory" class="pose-studio-select"></select>' +
            '      <label class="pose-studio-sublabel" style="margin-top:6px;">Animation</label>' +
            '      <select id="poseBvhSelect" class="pose-studio-select"></select>' +
            '      <div class="pose-playback" style="margin-top:8px;">' +
            '        <button id="poseBvhPlayBtn" class="pose-playback-btn pose-playback-btn--play" title="Play">' +
            '          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>' +
            '        </button>' +
            '        <button id="poseBvhStopBtn" class="pose-playback-btn" title="Stop" style="display:none;">' +
            '          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="14" height="16" rx="2"/></svg>' +
            '        </button>' +
            '      </div>' +
            '    </div>' +
            '  </details>' +
            // Section 8: Talk Mode
            '  <div class="pose-studio-section">' +
            '    <label class="pose-studio-label">\uD83D\uDCAC Talk Mode</label>' +
            '    <div class="pose-anim-hint">How the avatar gestures while speaking</div>' +
            '    <select id="poseTalkStyleSelect" class="pose-studio-select"></select>' +
            '  </div>' +
            // Section 9: Base Pose
            '  <div class="pose-studio-section">' +
            '    <label class="pose-studio-label">\uD83E\uDDCD Base Pose</label>' +
            '    <div class="pose-anim-hint">Standing posture foundation for all modes</div>' +
            '    <select id="poseBasePoseSelect" class="pose-studio-select"></select>' +
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
        // UN25. Transition speed: shown as stored, saved on change. Without PoseTransition (the
        // module failed to load) the control is hidden rather than offered and ignored.
        const speedSelect = this.rootEl.querySelector('#poseTransitionSpeed');
        if (speedSelect) {
            const PT = window.NEXUS_POSE_TRANSITION;
            if (PT && typeof PT.getSpeed === 'function') {
                speedSelect.value = PT.getSpeed();
                speedSelect.addEventListener('change', () => {
                    speedSelect.value = PT.setSpeed(speedSelect.value);
                });
            } else {
                speedSelect.hidden = true;
                const label = this.rootEl.querySelector('label[for="poseTransitionSpeed"]');
                if (label) label.hidden = true;
            }
        }
        const self = this;

        // --- Close ---
        // Closing the panel exits pose mode and restores normal procedural
        // animations (breathing, head tracking, base pose). The avatar
        // smoothly returns to its default idle state.
        const closeBtn = this.rootEl.querySelector('#poseStudioCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                self.hide();
                self.editor.exit();
                self._returnFocus();

                // Cancel any VRPoseSystem blending so it doesn't fight
                try {
                    var vps = window.vrPoseSystem;
                    if (vps) {
                        vps._isBlending = false;
                    }
                } catch (_) {}

                // Re-register avatar so ProceduralAnimator recaptures rest
                // pose from the clean T-pose-corrected state, then immediately
                // apply default idle so procedural animations resume.
                var animator = window.NEXUS_PROCEDURAL_ANIMATOR;
                if (animator) {
                    try {
                        var viewer = window.NEXUS_VIEWER;
                        var root = viewer?.avatarManager?.currentRoot;
                        var vrm = viewer?.avatarManager?._currentVRM;
                        if (root) {
                            animator.registerAvatar(root, vrm);
                        }
                    } catch (_) {}
                    try {
                        animator.setBasePose?.('lecturerNeutral');
                        animator.setMode?.('idle', 0);
                        animator.update?.(0, 0);
                    } catch (_) {}
                }
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
        // Full viewport reset: stop ALL animations and systems, clear ALL
        // modified bone state, return avatar to clean default procedural pose.
        // After this, closing the panel resumes normal procedural animations.
        const resetBtn = this.rootEl.querySelector('#poseResetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                // 1. Stop ALL animation systems
                try {
                    window.NEXUS_CLIP_LOADER?.stopClip?.({ fadeOut: 0.2 });
                } catch (_) {}
                try {
                    window.NEXUS_ANIMATION_RESOLVER?.stop?.();
                } catch (_) {}
                // Stop locomotion (walking/running state machine + blend controller)
                try {
                    window.NEXUS_ANIMATION_BLEND?.fadeOutAll?.(0.2);
                } catch (_) {}
                try {
                    window.NEXUS_LOCOMOTION?.forceStop?.();
                } catch (_) {}

                // 2. Exit pose mode — poseMode=false, editMode=false,
                //    autoUpdateHumanBones=false
                self._exitPoseMode();

                // 3. Cancel any active VRPoseSystem blending
                try {
                    var vps = window.vrPoseSystem;
                    if (vps) {
                        vps._isBlending = false;
                        vps._blendTime = 0;
                    }
                } catch (_) {}

                // 4. Reset all normalized bones to identity AND restore
                //    hips position so avatar doesn't float or sink
                try {
                    var vrm = window.NEXUS_VIEWER?.avatarManager?._currentVRM;
                    if (vrm && vrm.humanoid && vrm.humanoid.getNormalizedBoneNode) {
                        var boneNames = [
                            'hips',
                            'spine',
                            'chest',
                            'upperChest',
                            'neck',
                            'head',
                            'leftShoulder',
                            'rightShoulder',
                            'leftUpperArm',
                            'rightUpperArm',
                            'leftLowerArm',
                            'rightLowerArm',
                            'leftHand',
                            'rightHand',
                            'leftUpperLeg',
                            'rightUpperLeg',
                            'leftLowerLeg',
                            'rightLowerLeg',
                            'leftFoot',
                            'rightFoot',
                        ];
                        for (var bi = 0; bi < boneNames.length; bi++) {
                            try {
                                var nb = vrm.humanoid.getNormalizedBoneNode(boneNames[bi]);
                                if (nb) nb.quaternion.set(0, 0, 0, 1);
                            } catch (_) {}
                        }
                        // Restore hips position from VRPoseSystem rest
                        // (prevents avatar staying lowered after sitting/lying poses)
                        var vpsRef = window.vrPoseSystem;
                        if (vpsRef && vpsRef._hipsRestPosition) {
                            var hipsBone = vpsRef._bones?.get?.('hips');
                            if (hipsBone) {
                                hipsBone.position.copy(vpsRef._hipsRestPosition);
                            }
                        }
                    }
                } catch (_) {}

                // 5. Reset pose editor state and sliders
                self.editor.resetAll();
                self._resetSliders();

                // 6. Re-register avatar with ProceduralAnimator for clean baseline.
                //    registerAvatar re-runs fixTPose + captureRestPose, giving
                //    ProceduralAnimator a clean T-pose-corrected rest state.
                var animator = window.NEXUS_PROCEDURAL_ANIMATOR;
                if (animator) {
                    try {
                        var viewer = window.NEXUS_VIEWER;
                        var root = viewer?.avatarManager?.currentRoot;
                        var avrm = viewer?.avatarManager?._currentVRM;
                        if (root) {
                            animator.registerAvatar(root, avrm);
                        }
                    } catch (_) {}

                    // Set default base pose + idle mode and force immediate update
                    try {
                        animator.setBasePose?.('lecturerNeutral');
                        animator.setMode?.('idle', 0);
                        animator.update?.(0, 0);
                    } catch (_) {}
                }

                // 7. Reset navigator to first preset
                self._navIndex = 0;
                self._updateNavDisplay();
                self._hasAppliedInitialPose = false;

                // 8. Clear any active animation chip
                self.rootEl.querySelectorAll('.pose-anim-chip').forEach(function (chip) {
                    chip.classList.remove('pose-anim-chip--active');
                });
                self._isPlaying = false;
                self._playingAnimId = null;

                // 9. Re-frame camera on avatar so viewport reflects the reset
                try {
                    if (window.NEXUS_CAMERA_PRESETS?.transitionToFullBody) {
                        window.NEXUS_CAMERA_PRESETS.transitionToFullBody(600);
                    } else if (window.NEXUS_VIEWER?.frameObject && window.NEXUS_VIEWER?.avatarManager?.currentRoot) {
                        window.NEXUS_VIEWER.frameObject(window.NEXUS_VIEWER.avatarManager.currentRoot, 1.35);
                    }
                } catch (_) {}

                console.log('[PoseStudio] Reset All — avatar restored to default');
            });
        }

        // --- Reset Selected ---
        const resetSelectedBtn = this.rootEl.querySelector('#poseResetSelectedBtn');
        if (resetSelectedBtn) {
            resetSelectedBtn.addEventListener('click', () => {
                self._bindToStage();
                self.editor.resetSelected();
                self._resetSliders();
            });
        }

        // --- Mirror Arms ---
        const mirrorBtn = this.rootEl.querySelector('#poseMirrorBtn');
        if (mirrorBtn) {
            mirrorBtn.addEventListener('click', () => {
                self._bindToStage();
                self.editor.mirrorArms('left');
                self._syncSlidersFromBone();
            });
        }

        // --- Save Pose ---
        const saveBtn = this.rootEl.querySelector('#poseSaveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                self._bindToStage();
                const name = self.saveInput.value.trim() || 'Custom Pose';
                self.editor.saveCurrentPose(name);
                self.saveInput.value = '';
                self.refresh();
            });
        }

        /* NEXUS_BD (UC-11) — Publish to KB. Additive: absent unless behaviorEngine.enabled
           loaded the engine, and it only ever writes the engine's own storage. */
        const publishBtn = this.rootEl.querySelector('#posePublishKbBtn');
        if (publishBtn) {
            publishBtn.addEventListener('click', () => {
                if (!window.NEXUS_BD_ENABLED) return;
                const pose = self.editor?.getCurrentPoseRecord?.() || self._selectedPose;
                const result = window.NEXUS_BD_POSE_PUBLISHER?.publish(pose);
                if (result && result.ok) console.log('[BD] published pose to the KB:', result.record.id);
                else console.warn('[BD] could not publish this pose:', result && result.why);
            });
        }

        // --- Undo / Redo ---
        const undoBtn = this.rootEl.querySelector('#poseUndoBtn');
        if (undoBtn) {
            undoBtn.addEventListener('click', () => {
                self._bindToStage();
                self.editor.undo();
                self._syncSlidersFromBone();
            });
        }

        const redoBtn = this.rootEl.querySelector('#poseRedoBtn');
        if (redoBtn) {
            redoBtn.addEventListener('click', () => {
                self._bindToStage();
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
                // UI2. An index into the list the navigator shows (filtered when Private is off).
                const idx = getNavPresets().findIndex((p) => p.name === e.detail.preset);
                if (idx !== -1) {
                    self._navIndex = idx;
                    self._updateNavDisplay();
                } else if (e.detail.preset === 'standing') {
                    self._navIndex = -1; // UI3. the rig's neutral: shown, not in the cycle
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
                self._bindToStage();
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
                self._bindToStage();
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
            mouseToggle.checked = false; // disabled by default; show() restores the saved preference
            mouseToggle.addEventListener('change', () => {
                const gizmo = window.NEXUS_POSE_GIZMO_OVERLAY;
                let on = mouseToggle.checked;
                if (gizmo) {
                    if (on) {
                        // enable() can fail (viewer not ready) — reflect reality
                        // in the checkbox instead of desyncing UI and gizmo.
                        on = gizmo.enable() !== false;
                        mouseToggle.checked = on;
                    } else {
                        gizmo.disable();
                    }
                }
                self._mouseEditEnabled = on;
                try {
                    localStorage.setItem('nexus-pose-mouse-edit', on ? '1' : '0');
                } catch (_) {}
            });
        }

        // --- Puppet Mode toggle (natural whole-body IK dragging) ---
        const puppetToggle = this.rootEl.querySelector('#posePuppetToggle');
        if (puppetToggle) {
            const puppet = window.NEXUS_POSE_PUPPET_IK;
            puppetToggle.checked = puppet ? puppet.isEnabled() : true;
            puppetToggle.addEventListener('change', () => {
                const p = window.NEXUS_POSE_PUPPET_IK;
                if (p && p.setEnabled) p.setEnabled(puppetToggle.checked);
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

        // --- Helper: wire play/stop for a clip dropdown ---
        function wireClipPlayStop(playId, stopId, selectId) {
            const playBtn = self.rootEl.querySelector('#' + playId);
            const stopBtn = self.rootEl.querySelector('#' + stopId);
            if (playBtn) {
                playBtn.addEventListener('click', () => {
                    const sel = self.rootEl.querySelector('#' + selectId);
                    if (!sel || !sel.value) return;
                    if (window.NEXUS_CLIP_LOADER?.playClip) {
                        window.NEXUS_CLIP_LOADER.playClip(sel.value, true);
                        try {
                            window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.('idle', 1);
                            window.NEXUS_PROCEDURAL_ANIMATOR?.setAllowWithMixer?.(true);
                        } catch (_) {}
                    }
                    playBtn.style.display = 'none';
                    if (stopBtn) stopBtn.style.display = '';
                });
            }
            if (stopBtn) {
                stopBtn.addEventListener('click', () => {
                    try {
                        window.NEXUS_CLIP_LOADER?.stopClip?.();
                        window.NEXUS_ANIMATION_RESOLVER?.stop?.();
                        window.NEXUS_PROCEDURAL_ANIMATOR?.setAllowWithMixer?.(false);
                        window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.('waiting', 0);
                        window.NEXUS_PROCEDURAL_ANIMATOR?.update?.(0, 0);
                    } catch (_) {}
                    stopBtn.style.display = 'none';
                    if (playBtn) playBtn.style.display = '';
                });
            }
        }

        // --- VRMA play/stop ---
        wireClipPlayStop('poseVrmaPlayBtn', 'poseVrmaStopBtn', 'poseVrmaSelect');

        // --- BVH details arrow rotation ---
        const bvhDetails = this.rootEl.querySelector('#poseBvhArrow')?.closest('details');
        const bvhArrow = this.rootEl.querySelector('#poseBvhArrow');
        if (bvhDetails && bvhArrow) {
            bvhDetails.addEventListener('toggle', () => {
                bvhArrow.style.transform = bvhDetails.open ? 'rotate(90deg)' : '';
            });
        }

        // --- BVH category dropdown ---
        const bvhCatSelect = this.rootEl.querySelector('#poseBvhCategory');
        if (bvhCatSelect) {
            bvhCatSelect.addEventListener('change', () => {
                self._updateBvhSelect();
            });
        }

        // --- BVH play/stop ---
        wireClipPlayStop('poseBvhPlayBtn', 'poseBvhStopBtn', 'poseBvhSelect');

        // --- T-Pose Intensity slider ---
        const tposeSlider = this.rootEl.querySelector('#poseTposeIntensitySlider');
        const tposeValue = this.rootEl.querySelector('#poseTposeIntensityValue');
        if (tposeSlider && tposeValue) {
            // Initialize from current PoseNormalizer settings
            const pn = window.NEXUS_POSE_NORMALIZER;
            if (pn && pn.getSettings) {
                const s = pn.getSettings();
                if (s.intensity != null) {
                    tposeSlider.value = String(Math.round(s.intensity * 100));
                    tposeValue.textContent = s.intensity.toFixed(2);
                }
            }

            tposeSlider.addEventListener('input', () => {
                const val = Number(tposeSlider.value) / 100;
                tposeValue.textContent = val.toFixed(2);

                // Update PoseNormalizer settings (persists to localStorage)
                const pnorm = window.NEXUS_POSE_NORMALIZER;
                if (pnorm && pnorm.updateSettings) {
                    pnorm.updateSettings({ intensity: val });
                }

                // Re-apply natural pose with new intensity
                self._reapplyNaturalPose();
            });
        }

        // --- UI4. Bone editing follows the Advanced section: closing it puts the joint handles
        // away (the switch keeps its setting), opening it brings them back if the switch is on.
        const advancedEl = this.rootEl.querySelector('#poseAdvanced');
        if (advancedEl) {
            advancedEl.addEventListener('toggle', () => {
                const gizmo = window.NEXUS_POSE_GIZMO_OVERLAY;
                const sw = self.rootEl.querySelector('#poseMouseEditToggle');
                if (!gizmo || !sw) return;
                if (!advancedEl.open) {
                    if (gizmo.isEnabled && gizmo.isEnabled()) gizmo.disable();
                    self._mouseEditEnabled = false;
                } else if (sw.checked && gizmo.enable) {
                    self._mouseEditEnabled = gizmo.enable() !== false;
                    sw.checked = self._mouseEditEnabled;
                }
            });
        }

        // --- UI3. Advanced: restore the recommended correction ---
        const tposeRestoreBtn = this.rootEl.querySelector('#poseTposeRestoreBtn');
        if (tposeRestoreBtn) {
            tposeRestoreBtn.addEventListener('click', () => {
                const pnorm = window.NEXUS_POSE_NORMALIZER;
                if (pnorm && pnorm.updateSettings) pnorm.updateSettings({ intensity: 1 });
                const sl = self.rootEl.querySelector('#poseTposeIntensitySlider');
                const lab = self.rootEl.querySelector('#poseTposeIntensityValue');
                if (sl) sl.value = '100';
                if (lab) lab.textContent = '1.00';
                self._reapplyNaturalPose();
            });
        }

        // --- UI3. Advanced: start from the rig's T-pose ---
        // The neutral every bone's rotation is measured from: arms straight out, no correction.
        // One undo step, so Undo returns to the pose she was in.
        const tposeStartBtn = this.rootEl.querySelector('#poseTposeStartBtn');
        if (tposeStartBtn) {
            tposeStartBtn.addEventListener('click', () => {
                self._bindToStage();
                self._enterPoseMode();
                // The undo step is the pose she is in now, taken before anything moves (UI3).
                if (self.editor._pushUndoSnapshot) self.editor._pushUndoSnapshot();
                try {
                    window.vrPoseSystem?.applyPreset?.('standing', 0);
                } catch (_) {}
                if (self.editor.applier) {
                    self.editor.applier.resetAll();
                    if (self.editor._emitChange) self.editor._emitChange();
                }
                self._navIndex = -1;
                self._updateNavDisplay();
                self._syncSlidersFromBone();
            });
        }

        // --- Natural Pose Style selector ---
        const tposePresetSelect = this.rootEl.querySelector('#poseTposePresetSelect');
        if (tposePresetSelect) {
            // Initialize from current NaturalPosePlugin state
            const np = window.NEXUS_NATURAL_POSE;
            if (np && np.getActivePreset) {
                tposePresetSelect.value = np.getActivePreset();
            }

            tposePresetSelect.addEventListener('change', () => {
                const presetName = tposePresetSelect.value;

                // Update PoseNormalizer settings
                const pnorm = window.NEXUS_POSE_NORMALIZER;
                if (pnorm && pnorm.updateSettings) {
                    pnorm.updateSettings({ preset: presetName });
                }

                // Apply via NaturalPosePlugin
                const np2 = window.NEXUS_NATURAL_POSE;
                if (np2 && np2.setPreset) {
                    np2.setPreset(presetName);
                }

                // Re-apply to update the character
                self._reapplyNaturalPose();
            });
        }

        // Animation Library UI removed — only emotes + model clips shown

        // --- Cross-sync: listen for external settings changes (e.g. from Settings panel) ---
        this._settingsChangedHandler = () => {
            const pnSync = window.NEXUS_POSE_NORMALIZER;
            if (!pnSync || !pnSync.getSettings) return;
            const sSync = pnSync.getSettings();

            // Sync intensity slider
            const tSlider = self.rootEl.querySelector('#poseTposeIntensitySlider');
            const tValue = self.rootEl.querySelector('#poseTposeIntensityValue');
            if (tSlider && sSync.intensity != null) {
                tSlider.value = String(Math.round(sSync.intensity * 100));
                if (tValue) tValue.textContent = sSync.intensity.toFixed(2);
            }

            // Sync preset dropdown
            const tPreset = self.rootEl.querySelector('#poseTposePresetSelect');
            if (tPreset && sSync.preset) {
                tPreset.value = sSync.preset;
            }
        };
        window.addEventListener('pose-settings-changed', this._settingsChangedHandler);
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

        // ── Clip playback path (clip:path/to/file.bvh) ──
        if (animId.indexOf('clip:') === 0) {
            var clipPath = animId.slice(5);
            if (window.NEXUS_CLIP_LOADER?.playClip) {
                window.NEXUS_CLIP_LOADER.playClip(clipPath, true);
                // Set procedural to minimal overlay while clip plays
                try {
                    window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.('idle', 1);
                    window.NEXUS_PROCEDURAL_ANIMATOR?.setAllowWithMixer?.(true);
                } catch (_) {}
            }
            return;
        }

        // Check if this animation has a performanceIntent (clip-first via AnimationResolver)
        var AP = window.NEXUS_ANIMATION_PRESETS;
        var emotionDef = null;
        if (AP && AP.EMOTIONS) {
            emotionDef = AP.EMOTIONS.find(function (e) {
                return e.id === animId;
            });
        }
        if (!emotionDef && AP && AP.ADULT_EMOTIONS) {
            emotionDef = AP.ADULT_EMOTIONS.find(function (e) {
                return e.id === animId;
            });
        }

        if (emotionDef && emotionDef.performanceIntent && window.NEXUS_ANIMATION_RESOLVER) {
            // Clip-first path (dance, future gestures)
            window.NEXUS_ANIMATION_RESOLVER.play(emotionDef.performanceIntent, {
                fallbackMode: emotionDef.mode || 'waiting',
                duration: emotionDef.duration || 15000,
            });
        } else if (window.NEXUS_ANIMATION_MANAGER?.play) {
            // AnimationManager path
            window.NEXUS_ANIMATION_MANAGER.play(animId, false);
        } else if (window.NEXUS_ANIMATION_MANAGER?.applyEmotion) {
            window.NEXUS_ANIMATION_MANAGER.applyEmotion(animId);
        } else {
            // Procedural fallback
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

        // Stop via ClipLoader, AnimationResolver, AnimationManager, and procedural
        try {
            window.NEXUS_CLIP_LOADER?.stopClip?.();
        } catch (_) {}
        try {
            window.NEXUS_ANIMATION_RESOLVER?.stop?.();
        } catch (_) {}
        if (window.NEXUS_ANIMATION_MANAGER?.stopAll) {
            window.NEXUS_ANIMATION_MANAGER.stopAll();
        }
        try {
            window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.('waiting', 0);
            window.NEXUS_PROCEDURAL_ANIMATOR?.update?.(0, 0);
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

        // Clip animations — populate category + clip dropdowns
        this._populateClipDropdowns();
    };

    /**
     * Populate the Motion (Clips) category and clip dropdowns.
     */
    PoseStudioPanel.prototype._populateClipDropdowns = function () {
        var allClips = [];
        if (window.NEXUS_CLIP_LOADER?.getAllAnimations) {
            allClips = window.NEXUS_CLIP_LOADER.getAllAnimations();
        }

        // Split into VRMA and BVH
        var vrmaClips = [];
        var bvhByCategory = {};
        for (var i = 0; i < allClips.length; i++) {
            var clip = allClips[i];
            if (clip.id && clip.id.toLowerCase().indexOf('.vrma') >= 0) {
                vrmaClips.push(clip);
            } else {
                var cat = clip.categoryLabel || clip.category || 'Other';
                if (!bvhByCategory[cat]) bvhByCategory[cat] = [];
                bvhByCategory[cat].push(clip);
            }
        }

        // ── VRMA dropdown ──
        var vrmaSelect = this.rootEl.querySelector('#poseVrmaSelect');
        if (vrmaSelect) {
            var vhtml = '';
            for (var v = 0; v < vrmaClips.length; v++) {
                vhtml += '<option value="' + vrmaClips[v].id + '">\u2728 ' + vrmaClips[v].label + '</option>';
            }
            vrmaSelect.innerHTML = vhtml || '<option value="">No VRMA clips available</option>';
        }

        // ── BVH category dropdown ──
        var bvhCatSelect = this.rootEl.querySelector('#poseBvhCategory');
        if (bvhCatSelect) {
            var catKeys = Object.keys(bvhByCategory);
            var catHtml = '';
            for (var c = 0; c < catKeys.length; c++) {
                catHtml +=
                    '<option value="' +
                    catKeys[c] +
                    '">' +
                    catKeys[c] +
                    ' (' +
                    bvhByCategory[catKeys[c]].length +
                    ')</option>';
            }
            bvhCatSelect.innerHTML = catHtml || '<option value="">No BVH clips available</option>';
        }

        this._bvhByCategory = bvhByCategory;
        this._updateBvhSelect();
    };

    /**
     * Update the BVH clip dropdown when category changes.
     */
    PoseStudioPanel.prototype._updateBvhSelect = function () {
        var catSelect = this.rootEl.querySelector('#poseBvhCategory');
        var clipSelect = this.rootEl.querySelector('#poseBvhSelect');
        if (!catSelect || !clipSelect || !this._bvhByCategory) return;

        var selectedCat = catSelect.value;
        var clips = this._bvhByCategory[selectedCat] || [];

        var html = '';
        for (var i = 0; i < clips.length; i++) {
            html +=
                '<option value="' +
                clips[i].id +
                '">' +
                (clips[i].icon || '\uD83C\uDFAC') +
                ' ' +
                clips[i].label +
                '</option>';
        }
        clipSelect.innerHTML = html || '<option value="">No clips in this category</option>';
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

        this._bindToStage();

        if (vrPreset) {
            // Ensure pose mode is active (stops clips, yields ProceduralAnimator)
            this._enterPoseMode();
            // Apply via VRPoseSystem — smooth blended transition on the 3D character
            const vps = window.vrPoseSystem;
            if (vps) {
                vps.applyPreset(vrPreset.name, 0.5);
            }
            // Sync navigator to this preset. UI2: its index in the list the navigator shows.
            // NAV_PRESETS also holds the adult presets, so with Private off "T-Pose (Reset)"
            // (index 43 there, 26 of 26 here) fell off the end and the navigator read "Lecturer".
            const idx = getNavPresets().findIndex((p) => p.name === vrPreset.name);
            this._navIndex = idx; // UI3. -1 for an advanced preset: shown, not in the cycle
            this._updateNavDisplay();
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
    /**
     * UI2. If the avatar was swapped while the studio stayed open, bind the editor to the one on
     * stage before acting. Only the gizmo and skeleton overlays used to rebind, and only while
     * shown, so with Mouse Bone Editing off a saved pose, a slider or Undo was written to the
     * skeleton that had been taken off the stage. Re-entering resets the new rig to its neutral,
     * which is the right start for whatever the person does next.
     */
    PoseStudioPanel.prototype._bindToStage = function () {
        try {
            if (this.editor && this.editor.rebindIfStale && this.editor.rebindIfStale()) {
                this.refresh();
            }
        } catch (err) {
            console.warn('[PoseStudio] could not bind to the avatar on stage:', err);
        }
    };

    PoseStudioPanel.prototype._navigatePose = function (direction) {
        this._bindToStage();
        const filtered = getNavPresets();
        const len = filtered.length;
        if (this._navIndex < 0) {
            // UI3. From the T-pose (off the list), › goes to the first preset and ‹ to the last.
            this._navIndex = direction > 0 ? 0 : len - 1;
        } else {
            this._navIndex = (((this._navIndex + direction) % len) + len) % len;
        }

        const preset = filtered[this._navIndex];
        this._updateNavDisplay();

        // Ensure pose mode is active (stops clips, yields ProceduralAnimator)
        this._enterPoseMode();

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
        const filtered = getNavPresets();
        if (this._navIndex < 0) {
            // UI3. The rig's neutral (Advanced ▸ Start from T-pose): named, but not counted.
            if (this._navLabel) this._navLabel.textContent = 'T-Pose';
            if (this._navCounter) this._navCounter.textContent = `\u2013 / ${filtered.length}`;
            if (this._navCategory) this._navCategory.textContent = 'Advanced';
            return;
        }
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

        // UI2. Read the bone, not a cached slider value: a preset, a drag or Undo moves it too.
        const state = editor.applier.readAxes
            ? editor.applier.readAxes(editor.selectedBone)
            : editor.applier.axisState && editor.applier.axisState[editor.selectedBone];
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
     * Re-apply the natural pose correction to the current avatar.
     * Called when intensity or preset changes in real-time.
     */
    PoseStudioPanel.prototype._reapplyNaturalPose = function () {
        // Get the current avatar root
        var avatarRoot = null;
        try {
            avatarRoot =
                window.NEXUS_VIEWER?.avatarManager?.currentRoot ||
                (this.editor.getAvatarRoot && this.editor.getAvatarRoot());
        } catch (_) {}

        if (!avatarRoot) return;

        // Re-apply via NaturalPosePlugin (handles VRM + GLB)
        var np = window.NEXUS_NATURAL_POSE;
        if (np && np.apply) {
            np.apply(avatarRoot);
        }

        // Force VRM sync so changes are visible immediately
        var vrm =
            window.NEXUS_VIEWER?.avatarManager?._currentVRM ||
            window.NEXUS_VIEWER?.avatarManager?.vrmLoader?.currentVRM;
        if (vrm && vrm.update) {
            vrm.update(0);
        }

        // Re-capture rest pose so ProceduralAnimator uses updated baseline
        if (window.NEXUS_PROCEDURAL_ANIMATOR?.captureRestPose) {
            window.NEXUS_PROCEDURAL_ANIMATOR.captureRestPose(avatarRoot);
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
        var filtered = getNavPresets();
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

        // Sync T-Pose Intensity slider with current settings
        var tposeSlider = this.rootEl.querySelector('#poseTposeIntensitySlider');
        var tposeValue = this.rootEl.querySelector('#poseTposeIntensityValue');
        var tposePresetSel = this.rootEl.querySelector('#poseTposePresetSelect');
        if (tposeSlider && tposeValue) {
            var pn = window.NEXUS_POSE_NORMALIZER;
            if (pn && pn.getSettings) {
                var s = pn.getSettings();
                if (s.intensity != null) {
                    tposeSlider.value = String(Math.round(s.intensity * 100));
                    tposeValue.textContent = s.intensity.toFixed(2);
                }
                if (s.preset && tposePresetSel) {
                    tposePresetSel.value = s.preset;
                }
            }
        }
        if (tposePresetSel) {
            var np = window.NEXUS_NATURAL_POSE;
            if (np && np.getActivePreset) {
                tposePresetSel.value = np.getActivePreset();
            }
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

    /**
     * Enter pose mode: stop any playing clips, tell ProceduralAnimator to yield
     * bone control to VRPoseSystem, and enable VRM normalized→raw bone sync.
     */
    PoseStudioPanel.prototype._enterPoseMode = function () {
        // Stop any active clip animations (graceful fadeOut)
        try {
            window.NEXUS_CLIP_LOADER?.stopClip?.({ fadeOut: 0.25 });
        } catch (_) {}
        try {
            window.NEXUS_ANIMATION_RESOLVER?.stop?.();
        } catch (_) {}

        // Enter pose mode: ProceduralAnimator yields all bone control
        try {
            window.NEXUS_PROCEDURAL_ANIMATOR?.setPoseMode?.(true);
        } catch (_) {}

        // MO12. And the chat motion stack: without this its queued idle stood her back up
        // ~1.6 s after a preset was picked, whenever she had just made a gesture.
        try {
            window.NEXUS_MOTION?.holdForPoseStudio?.(true);
        } catch (_) {}

        // VRPoseSystem writes to normalized bones (via PoseRigMap).
        // Enable autoUpdateHumanBones so vrm.update() syncs normalized → raw
        // each frame, making the pose visible on the rendered skeleton.
        try {
            var vrm = window.NEXUS_VIEWER?.avatarManager?._currentVRM;
            if (vrm && vrm.humanoid && 'autoUpdateHumanBones' in vrm.humanoid) {
                vrm.humanoid.autoUpdateHumanBones = true;
            }
        } catch (_) {}
    };

    /**
     * Exit pose mode: restore ProceduralAnimator to normal operation and
     * disable autoUpdateHumanBones so ProceduralAnimator can write raw bones.
     */
    PoseStudioPanel.prototype._exitPoseMode = function () {
        try {
            window.NEXUS_PROCEDURAL_ANIMATOR?.setPoseMode?.(false);
        } catch (_) {}
        try {
            window.NEXUS_MOTION?.holdForPoseStudio?.(false);
        } catch (_) {}

        // Restore autoUpdateHumanBones=false so ProceduralAnimator's raw bone
        // writes (breathing, base pose) aren't overwritten by vrm.humanoid.update()
        try {
            var vrm = window.NEXUS_VIEWER?.avatarManager?._currentVRM;
            if (vrm && vrm.humanoid && 'autoUpdateHumanBones' in vrm.humanoid) {
                vrm.humanoid.autoUpdateHumanBones = false;
            }
        } catch (_) {}
    };

    PoseStudioPanel.prototype.show = function () {
        // UI2. Remember what opened the studio, so Close can hand focus back to it.
        var active = document.activeElement;
        this._opener = active && active !== document.body && !this.rootEl.contains(active) ? active : null;
        this.rootEl.classList.remove('hidden');
        this.refresh();

        // Enter pose mode so VRPoseSystem has exclusive bone control
        this._enterPoseMode();

        // Re-sync Mouse Bone Editing with the real gizmo state. Closing the
        // studio (editor.exit) disables the gizmo behind the checkbox's back;
        // restore the user's saved preference so the toggle never lies.
        var mouseToggleEl = this.rootEl.querySelector('#poseMouseEditToggle');
        var gizmoRef = window.NEXUS_POSE_GIZMO_OVERLAY;
        if (mouseToggleEl && gizmoRef) {
            var wantMouseEdit = false;
            try {
                wantMouseEdit = localStorage.getItem('nexus-pose-mouse-edit') === '1';
            } catch (_) {}
            var gizmoOn = gizmoRef.isEnabled ? gizmoRef.isEnabled() : false;
            // UI4. The switch lives in the closed Advanced section: the remembered preference only
            // comes back with it, so nobody meets joint handles on her with no visible switch.
            var advancedOpen = !!(this.rootEl.querySelector('#poseAdvanced') || {}).open;
            if (wantMouseEdit && advancedOpen && !gizmoOn && gizmoRef.enable) {
                gizmoOn = gizmoRef.enable() !== false;
            }
            this._mouseEditEnabled = gizmoOn;
            mouseToggleEl.checked = gizmoOn || (wantMouseEdit && !advancedOpen);
        }
        var puppetToggleEl = this.rootEl.querySelector('#posePuppetToggle');
        if (puppetToggleEl && window.NEXUS_POSE_PUPPET_IK) {
            puppetToggleEl.checked = window.NEXUS_POSE_PUPPET_IK.isEnabled();
        }

        // Restore the mobile sheet to its last detent (a flick-dismiss clears
        // the inline height, and the topbar may have resized while we were away).
        if (window.NEXUS_POSE_SHEET && window.NEXUS_POSE_SHEET.init) {
            window.NEXUS_POSE_SHEET.init(this.rootEl);
        }

        // NL6. The navigator shows the position she is actually in. A position asked for in
        // chat ("kneel down") is held by the same pose system; opening the studio then used to
        // show "Lecturer 1 / 26" over a kneeling avatar and, on first open, replace her position
        // with it. If the pose system is holding one of the navigator's presets, that is the
        // one selected, and nothing is applied over it.
        var holding = null;
        try {
            var held = window.vrPoseSystem;
            if (held && held.isHoldingBones && held.isHoldingBones() && held.getCurrentPreset) {
                var listed = getNavPresets();
                for (var hi = 0; hi < listed.length; hi++) {
                    if (listed[hi].name === held.getCurrentPreset()) holding = hi;
                }
            }
        } catch (_) {}
        if (holding !== null) {
            this._navIndex = holding;
            this._hasAppliedInitialPose = true;
            this._updateNavDisplay();
        }

        // On first open, apply the first pose (Lecturer) to the character
        if (!this._hasAppliedInitialPose) {
            this._hasAppliedInitialPose = true;
            var filtered = getNavPresets();
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

    /**
     * UI2. Close hands keyboard focus back to the control that opened the studio, as a dialog
     * should; it used to fall to <body>, so a keyboard or switch user lost their place. When the
     * opener is inside the closed ☰ drawer (hidden now), the menu button is the visible way back.
     */
    PoseStudioPanel.prototype._returnFocus = function () {
        var visible = function (el) {
            if (!el || !el.isConnected) return false;
            var r = el.getBoundingClientRect();
            var cs = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
        };
        var drawer = document.getElementById('mobile-drawer');
        var opener = this._opener;
        var inClosedDrawer = opener && drawer && drawer.contains(opener) && !drawer.classList.contains('open');
        var candidates = [
            inClosedDrawer ? null : opener,
            document.getElementById('mobile-menu-btn'),
            document.getElementById('openPoseStudioBtn'),
        ];
        for (var i = 0; i < candidates.length; i++) {
            if (visible(candidates[i])) {
                try {
                    candidates[i].focus({ preventScroll: true });
                } catch (_) {}
                break;
            }
        }
        this._opener = null;
    };

    /**
     * Hide the panel and exit pose mode, restoring normal procedural control.
     */
    PoseStudioPanel.prototype.hide = function () {
        this.rootEl.classList.add('hidden');
        this._exitPoseMode();
    };

    /**
     * NL1. The navigator's catalogue, for whoever needs to name a pose without opening the
     * panel (src/xr/PoseCommands.js resolves spoken and typed requests against it). The same
     * list the panel shows, filtered the same way: with Spicy mode off the adult presets are
     * not in it. Copies, so a caller cannot edit the navigator's own entries.
     */
    PoseStudioPanel.catalogue = function () {
        return getFilteredPresets().map(function (p) {
            return { name: p.name, label: p.label, category: p.category, adult: Boolean(p.adult) };
        });
    };

    window.NEXUS_POSE_STUDIO_PANEL = PoseStudioPanel;
})();
