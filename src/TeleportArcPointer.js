'use strict';

/**
 * TeleportArcPointer — Parabolic arc "point-and-walk" system.
 * =============================================================
 * ADDITIVE / NON-DESTRUCTIVE: This file is 100% standalone.
 *
 * Industry-standard VR locomotion pattern (Half-Life: Alyx, VRChat, Rec Room):
 *   1. User pushes RIGHT thumbstick forward → parabolic arc appears from controller
 *   2. Arc hits ground plane (Y=0) → glowing disc marker appears at landing point
 *   3. User releases thumbstick → avatar walks to that point using locomotion system
 *
 * Uses the RIGHT controller's thumbstick (forward axis) to trigger.
 * LEFT thumbstick remains for standard player-rig movement.
 *
 * Integration:
 *   - VRControllers.js: small hook in pollGamepadInput to call our update
 *   - AvatarLocomotionSystem.js: walkToPoint() method accepts the target
 *
 * To remove entirely:
 *   1. Delete this file
 *   2. Remove <script> tag from index.html
 *   3. Remove ARC_POINTER_HOOK lines from VRControllers.js and AvatarLocomotionSystem.js
 *
 * Exposes: window.NEXUS_ARC_POINTER
 */
(function () {
    var THREE = window.THREE;
    if (!THREE) {
        console.warn('[TeleportArcPointer] THREE not found');
        return;
    }

    // ── Configuration ──
    var CONFIG = {
        // Physics
        gravity: -9.8, // m/s² — gravity for parabola simulation
        initialSpeed: 6.0, // m/s — launch speed of the arc
        stepSize: 0.08, // seconds — simulation step (smaller = smoother arc)
        maxSteps: 80, // Maximum simulation steps (caps arc length)
        maxDistance: 12.0, // Maximum horizontal distance (metres)

        // Ground detection
        groundY: 0.0, // Ground plane Y coordinate
        groundTolerance: 0.05, // How close to groundY counts as "hit"

        // Visuals — Arc line
        arcColor: 0x00e5ff, // Cyan arc (matches existing ray colour)
        arcColorInvalid: 0xff4444, // Red when no valid landing
        arcLineWidth: 3, // Line width (note: may be 1px on some GPUs)
        arcOpacity: 0.85,

        // Visuals — Ground marker (disc)
        markerRadius: 0.25, // metres
        markerColor: 0x00e5ff,
        markerPulseSpeed: 3.0, // Pulse animation speed (Hz)
        markerOpacity: 0.7,

        // Input — activated by LEFT thumbstick click (L3, buttons[3])
        // Meta Quest standard: left stick = locomotion/teleport
        // Hold L3 to show arc, release to confirm target
        buttonIndex: 3, // gamepad.buttons[3] = thumbstick click

        // Haptics
        hapticPulse: 0.15, // Haptic intensity on confirm (0-1)
        hapticDuration: 80, // ms
    };

    // ── State ──
    var active = false; // Is the arc currently showing?
    var validTarget = false; // Does the arc hit valid ground?
    var targetPoint = new THREE.Vector3(); // Where the arc lands
    var arcPoints = []; // Array of Vector3 for the arc line
    var scene = null;
    var renderer = null;

    // ── Three.js objects ──
    var arcLine = null; // THREE.Line for the parabolic arc
    var arcGeometry = null; // BufferGeometry (updated each frame)
    var arcMaterial = null;
    var groundMarker = null; // THREE.Mesh (disc on ground)
    var markerRing = null; // Outer ring for visual punch

    // ── Temp vectors ──
    var _tmpPos = new THREE.Vector3();
    var _tmpVel = new THREE.Vector3();
    var _tmpDir = new THREE.Vector3();
    var _tmpMat = new THREE.Matrix4();

    // ── Initialization ──
    function init(sceneRef, rendererRef) {
        scene = sceneRef;
        renderer = rendererRef;
        _createVisuals();
        console.log('[TeleportArcPointer] Initialized');
    }

    // ── Create arc line + ground marker meshes ──
    function _createVisuals() {
        // Arc line — pre-allocate max points
        var maxPts = CONFIG.maxSteps;
        var positions = new Float32Array(maxPts * 3);
        arcGeometry = new THREE.BufferGeometry();
        arcGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        arcGeometry.setDrawRange(0, 0); // Hidden until activated

        arcMaterial = new THREE.LineBasicMaterial({
            color: CONFIG.arcColor,
            opacity: CONFIG.arcOpacity,
            transparent: true,
            depthTest: true,
            depthWrite: false,
        });

        arcLine = new THREE.Line(arcGeometry, arcMaterial);
        arcLine.frustumCulled = false;
        arcLine.visible = false;
        arcLine.renderOrder = 999;
        scene.add(arcLine);

        // Ground marker — flat disc
        var discGeo = new THREE.CircleGeometry(CONFIG.markerRadius, 32);
        var discMat = new THREE.MeshBasicMaterial({
            color: CONFIG.markerColor,
            opacity: CONFIG.markerOpacity,
            transparent: true,
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: false,
        });
        groundMarker = new THREE.Mesh(discGeo, discMat);
        groundMarker.rotation.x = -Math.PI / 2; // Lay flat on ground
        groundMarker.visible = false;
        groundMarker.renderOrder = 998;
        scene.add(groundMarker);

        // Outer ring for visual punch
        var ringGeo = new THREE.RingGeometry(CONFIG.markerRadius * 0.85, CONFIG.markerRadius, 32);
        var ringMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            opacity: 0.4,
            transparent: true,
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: false,
        });
        markerRing = new THREE.Mesh(ringGeo, ringMat);
        markerRing.rotation.x = -Math.PI / 2;
        markerRing.visible = false;
        markerRing.renderOrder = 998;
        scene.add(markerRing);
    }

    // ── Compute parabolic arc points from controller ──
    // Uses projectile motion: p(t) = p0 + v0*t + 0.5*g*t²
    function _computeArc(controllerObj) {
        arcPoints.length = 0;
        validTarget = false;

        if (!controllerObj) return;

        // Get controller world position and direction
        controllerObj.updateMatrixWorld(true);
        _tmpMat.copy(controllerObj.matrixWorld);

        // Origin = controller position
        _tmpPos.setFromMatrixPosition(_tmpMat);

        // Direction = controller's -Z axis (where it points)
        _tmpDir.set(0, 0, -1).applyMatrix4(_tmpMat).sub(_tmpPos).normalize();

        // Initial velocity = direction * speed
        _tmpVel.copy(_tmpDir).multiplyScalar(CONFIG.initialSpeed);

        // Simulate projectile motion
        var pos = _tmpPos.clone();
        var vel = _tmpVel.clone();
        var dt = CONFIG.stepSize;
        var startX = pos.x;
        var startZ = pos.z;

        for (var i = 0; i < CONFIG.maxSteps; i++) {
            arcPoints.push(pos.clone());

            // Check ground intersection
            var nextY = pos.y + vel.y * dt + 0.5 * CONFIG.gravity * dt * dt;
            if (nextY <= CONFIG.groundY + CONFIG.groundTolerance && pos.y > CONFIG.groundY) {
                // Interpolate exact ground hit point
                var tHit = (pos.y - CONFIG.groundY) / (pos.y - nextY);
                tHit = Math.max(0, Math.min(1, tHit));
                var hitPoint = new THREE.Vector3(pos.x + vel.x * dt * tHit, CONFIG.groundY, pos.z + vel.z * dt * tHit);

                // Check max distance
                var hDist = Math.sqrt(
                    (hitPoint.x - startX) * (hitPoint.x - startX) + (hitPoint.z - startZ) * (hitPoint.z - startZ)
                );
                if (hDist <= CONFIG.maxDistance) {
                    arcPoints.push(hitPoint);
                    targetPoint.copy(hitPoint);
                    validTarget = true;
                }
                break;
            }

            // Below ground with no crossing? Stop.
            if (pos.y < CONFIG.groundY - 1.0) break;

            // Euler integration step
            pos.x += vel.x * dt;
            pos.z += vel.z * dt;
            pos.y += vel.y * dt + 0.5 * CONFIG.gravity * dt * dt;
            vel.y += CONFIG.gravity * dt;
        }
    }

    // ── Update arc visual geometry ──
    function _updateArcVisual() {
        if (!arcLine || !arcGeometry) return;

        var posAttr = arcGeometry.getAttribute('position');
        var count = Math.min(arcPoints.length, CONFIG.maxSteps);

        for (var i = 0; i < count; i++) {
            posAttr.setXYZ(i, arcPoints[i].x, arcPoints[i].y, arcPoints[i].z);
        }
        posAttr.needsUpdate = true;
        arcGeometry.setDrawRange(0, count);

        // Colour: cyan if valid, red if not
        arcMaterial.color.setHex(validTarget ? CONFIG.arcColor : CONFIG.arcColorInvalid);

        arcLine.visible = true;
    }

    // ── Update ground marker ──
    function _updateMarker(timeSec) {
        if (!groundMarker) return;

        if (validTarget) {
            groundMarker.position.set(targetPoint.x, CONFIG.groundY + 0.005, targetPoint.z);
            groundMarker.visible = true;

            // Pulse animation
            var pulse = 0.9 + 0.1 * Math.sin(timeSec * CONFIG.markerPulseSpeed * Math.PI * 2);
            groundMarker.scale.set(pulse, pulse, 1);

            // Ring
            if (markerRing) {
                markerRing.position.copy(groundMarker.position);
                markerRing.visible = true;
                var ringPulse = 0.95 + 0.15 * Math.sin(timeSec * CONFIG.markerPulseSpeed * Math.PI * 2 + 1.0);
                markerRing.scale.set(ringPulse, ringPulse, 1);
            }
        } else {
            groundMarker.visible = false;
            if (markerRing) markerRing.visible = false;
        }
    }

    // ── Hide all visuals ──
    function _hideVisuals() {
        if (arcLine) arcLine.visible = false;
        if (groundMarker) groundMarker.visible = false;
        if (markerRing) markerRing.visible = false;
    }

    // ── Fire haptic pulse on confirm ──
    function _hapticConfirm(controllerObj) {
        try {
            var xrInputSource = controllerObj?.userData?.xrInputSource;
            if (!xrInputSource) {
                // Try to get from XR session
                var session = renderer?.xr?.getSession?.();
                if (session) {
                    var sources = session.inputSources;
                    for (var i = 0; i < sources.length; i++) {
                        if (sources[i].handedness === 'right') {
                            xrInputSource = sources[i];
                            break;
                        }
                    }
                }
            }
            if (xrInputSource?.gamepad?.hapticActuators?.[0]) {
                xrInputSource.gamepad.hapticActuators[0].pulse(CONFIG.hapticPulse, CONFIG.hapticDuration);
            }
        } catch (_) {
            // Haptics not available — no-op
        }
    }

    // ── Main update (called each frame from VRControllers hook) ──
    // controllerObj: the LEFT controller THREE.Group (targetRay space)
    // buttonPressed: boolean — is L3 (thumbstick click) held down?
    // timeSec: clock elapsed time
    function update(controllerObj, buttonPressed, timeSec) {
        if (!scene || !arcLine) return;

        // Check locomotion config — arc pointer only works when walk feature is enabled
        var cfg = window.NEXUS_LOCOMOTION_CONFIG;
        if (!cfg || !cfg.isEnabled()) {
            if (active) {
                active = false;
                _hideVisuals();
            }
            return;
        }

        var wasActive = active;

        if (buttonPressed) {
            // L3 held — show arc
            active = true;
        } else if (wasActive) {
            // L3 released — confirm walk target
            if (validTarget) {
                _confirmWalkTarget(controllerObj);
            }
            active = false;
            _hideVisuals();
            return;
        }

        if (!active) {
            _hideVisuals();
            return;
        }

        // Compute arc from controller
        _computeArc(controllerObj);

        // Update visuals
        _updateArcVisual();
        _updateMarker(timeSec);
    }

    // ── Confirm: send walk target to locomotion system ──
    function _confirmWalkTarget(controllerObj) {
        var loco = window.NEXUS_LOCOMOTION;
        if (!loco) {
            console.warn('[TeleportArcPointer] NEXUS_LOCOMOTION not available');
            return;
        }

        if (typeof loco.walkToPoint === 'function') {
            loco.walkToPoint(targetPoint.x, targetPoint.z);
            console.log(
                '[TeleportArcPointer] Walk target confirmed:',
                targetPoint.x.toFixed(2),
                targetPoint.z.toFixed(2)
            );
            _hapticConfirm(controllerObj);
        } else {
            console.warn('[TeleportArcPointer] NEXUS_LOCOMOTION.walkToPoint not available');
        }
    }

    // ── Check if arc is currently active (for other systems to query) ──
    function isActive() {
        return active;
    }

    function hasValidTarget() {
        return active && validTarget;
    }

    function getTargetPoint() {
        return targetPoint.clone();
    }

    // ── Cleanup ──
    function dispose() {
        if (arcLine && scene) scene.remove(arcLine);
        if (groundMarker && scene) scene.remove(groundMarker);
        if (markerRing && scene) scene.remove(markerRing);
        if (arcGeometry) arcGeometry.dispose();
        if (arcMaterial) arcMaterial.dispose();
        arcLine = null;
        groundMarker = null;
        markerRing = null;
        active = false;
    }

    // ── Expose ──
    window.NEXUS_ARC_POINTER = {
        init: init,
        update: update,
        isActive: isActive,
        hasValidTarget: hasValidTarget,
        getTargetPoint: getTargetPoint,
        dispose: dispose,
        CONFIG: CONFIG, // Allow runtime tuning
    };

    console.log('[TeleportArcPointer] Loaded — parabolic arc pointer ready');
})();
