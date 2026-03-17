'use strict';

/**
 * PoseStudioInit — Bootstraps the Pose Studio system.
 * Wires PoseEditor + PoseStudioPanel to the existing Nexus architecture.
 *
 * Load order: After PoseRigMap, PoseState, PoseLibrary, PoseApplier,
 *             PoseStudioNormalizer, PoseEditor, PoseStudioPanel.
 */
(function () {
    let poseEditor = null;
    let poseStudioPanel = null;

    function getAvatarRoot() {
        // Primary: ViewerEngine's AvatarManager
        const viewer = window.NEXUS_VIEWER;
        if (viewer && viewer.avatarManager && viewer.avatarManager.currentRoot) {
            return viewer.avatarManager.currentRoot;
        }
        // Fallback: legacy VRMLoader instance
        if (window.vrmLoader && window.vrmLoader.getCurrentAvatarRoot) {
            return window.vrmLoader.getCurrentAvatarRoot();
        }
        return null;
    }

    function getHumanoid() {
        // Primary: stored on avatar root by AvatarManager
        const root = getAvatarRoot();
        if (root && root.userData && root.userData.vrmHumanoid) {
            return root.userData.vrmHumanoid;
        }
        // Fallback: legacy VRMLoader
        if (window.vrmLoader && window.vrmLoader.getCurrentHumanoid) {
            return window.vrmLoader.getCurrentHumanoid();
        }
        return null;
    }

    function initPoseStudio() {
        const poseRoot = document.getElementById('poseStudioRoot');
        if (!poseRoot) {
            console.warn('[PoseStudioInit] #poseStudioRoot element not found');
            return;
        }

        const PoseEditor = window.NEXUS_POSE_EDITOR;
        const PoseStudioPanel = window.NEXUS_POSE_STUDIO_PANEL;

        if (!PoseEditor || !PoseStudioPanel) {
            console.warn('[PoseStudioInit] PoseEditor or PoseStudioPanel not loaded');
            return;
        }

        poseEditor = new PoseEditor({
            getAvatarRoot,
            getHumanoid,
            proceduralAnimator: window.NEXUS_PROCEDURAL_ANIMATOR || null,
            onChange() {
                if (poseStudioPanel) {
                    poseStudioPanel.refresh();
                }
            },
        });

        poseStudioPanel = new PoseStudioPanel({
            editor: poseEditor,
            rootEl: poseRoot,
        });

        poseStudioPanel.init();

        // Initialize desktop mouse pose editing (PoseGizmoOverlay)
        const gizmo = window.NEXUS_POSE_GIZMO_OVERLAY;
        if (gizmo && gizmo.init) {
            gizmo.init();
        }

        // Initialize skeleton line overlay
        const skeletonOverlay = window.NEXUS_SKELETON_LINE_OVERLAY;
        if (skeletonOverlay && skeletonOverlay.init) {
            skeletonOverlay.init();
        }

        // Wire up the open button
        const openBtn = document.getElementById('openPoseStudioBtn');
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                const ok = poseEditor.enter();
                if (!ok) {
                    console.warn('[PoseStudio] No avatar available — load an avatar first');
                    return;
                }
                poseStudioPanel.show();

                // Mouse bone editing is OFF by default — user enables via toggle
                // Gizmo is initialized but only enabled when the toggle is checked
            });
        }

        // Wire close button to also disable gizmo and skeleton overlay
        const origExit = PoseEditor.prototype.exit;
        PoseEditor.prototype.exit = function () {
            origExit.call(this);
            if (gizmo && gizmo.disable) {
                gizmo.disable();
            }
            if (skeletonOverlay && skeletonOverlay.disable) {
                skeletonOverlay.disable();
            }
        };

        // Expose for debugging / thumbnail integration
        window.poseEditor = poseEditor;
        window.poseStudioPanel = poseStudioPanel;

        console.log('[PoseStudioInit] Pose Studio initialized (mouse bone editing off by default)');
    }

    // Wait for DOM + other scripts to be ready
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', () => {
            setTimeout(initPoseStudio, 100);
        });
    } else {
        setTimeout(initPoseStudio, 100);
    }
})();
