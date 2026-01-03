#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# patch_animation.sh — NEXUS "LIFE ENGINE" PATCHER
# ------------------------------------------------------------------------------
# What it does (idempotent):
#  1) Creates/updates:  src/ProceduralAnimator.js   (global script, no module deps)
#  2) Patches:          index.html                  (loads ProceduralAnimator BEFORE src/main.js)
#  3) Patches:          src/main.js                 (register avatar + update loop + viewer-engine hook)
#  4) Patches:          src/gltf-viewer/ViewerEngine.js (register avatar + update loop in module viewer)
#
# Run from project root:
#   chmod +x patch_animation.sh
#   ./patch_animation.sh
# ==============================================================================

ROOT="$(pwd)"
TS="$(date +"%Y%m%d-%H%M%S")"

say() { printf "%b\n" "$*"; }
backup_file() {
  local f="$1"
  if [[ -f "$f" ]]; then
    cp -f "$f" "${f}.bak.${TS}"
  fi
}

need_file() {
  local f="$1"
  if [[ ! -f "$f" ]]; then
    say "❌ Missing required file: $f"
    exit 1
  fi
}

need_dir() {
  local d="$1"
  if [[ ! -d "$d" ]]; then
    say "❌ Missing required directory: $d"
    exit 1
  fi
}

# --- Checks (match this repo structure) ---
need_dir "src"
need_file "index.html"
need_file "src/main.js"
need_file "src/gltf-viewer/ViewerEngine.js"

say "🔵 NEXUS Life Engine Patch — starting..."
say "📁 Root: ${ROOT}"

# ==============================================================================
# 1) Write src/ProceduralAnimator.js
# ==============================================================================
say "🔹 Writing src/ProceduralAnimator.js ..."
backup_file "src/ProceduralAnimator.js"

cat > "src/ProceduralAnimator.js" <<'EOF'
'use strict';

/**
 * NEXUS ProceduralAnimator (GLOBAL script)
 * ---------------------------------------
 * Purpose: add "life" to static/idle rigs:
 * - Fixes T-pose-ish rest by applying a gentle arm-down rest offset (only when no baked clips)
 * - Breathing sway (spine/chest)
 * - Subtle head look to mouse (idle)
 * - Simple "modes" for UI quick actions: idle | happy | thinking | dance | talk
 *
 * Safe-by-default:
 * - Does NOT fight baked animations unless you explicitly call setAllowWithMixer(true)
 * - Stores rest pose and applies offsets relative to rest
 *
 * Exposes:
 *   window.NEXUS_PROCEDURAL_ANIMATOR = { registerAvatar, update, setMode, setAllowWithMixer }
 */
(function () {
  const THREE = window.THREE;
  if (!THREE) {
    console.warn('[ProceduralAnimator] THREE not found on window. (vendor globals missing)');
    return;
  }

  // ---------------------------
  // Internal state
  // ---------------------------
  let avatarRoot = null;
  let bones = null;

  // If model has baked clips (AnimationMixer driven), default is to NOT modify bones.
  let hasBakedAnimations = false;

  // If true, we still allow subtle head look/breath even with mixer.
  // Default false for safety.
  let allowWithMixer = false;

  // Mouse input (normalized -1..1)
  const mouse = { x: 0, y: 0 };
  let inputInit = false;

  // Rest pose cache
  const rest = new Map(); // bone.uuid -> { pos: Vector3, quat: Quaternion }

  // Mode system
  let mode = 'idle';
  let modeUntilMs = 0;

  // Small per-bone smoothed targets stored in userData
  function damp(current, target, lambda, dt) {
    // THREE.MathUtils.damp exists in newer versions. Fallback to exp smoothing.
    if (THREE.MathUtils && typeof THREE.MathUtils.damp === 'function') {
      return THREE.MathUtils.damp(current, target, lambda, dt);
    }
    const t = 1 - Math.exp(-lambda * (dt || 0.016));
    return current + (target - current) * t;
  }

  function ensureInput() {
    if (inputInit) return;
    window.addEventListener('mousemove', (e) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });
    inputInit = true;
  }

  // ---------------------------
  // Bone discovery (heuristics)
  // ---------------------------
  function findBones(root) {
    const map = {
      head: null,
      neck: null,
      spine: null,
      chest: null,
      hips: null,
      leftUpperArm: null,
      rightUpperArm: null,
    };

    root.traverse((o) => {
      if (!o || !o.isBone) return;
      const n = (o.name || '').toLowerCase();

      // core
      if (!map.head && n.includes('head')) map.head = o;
      else if (!map.neck && (n.includes('neck') || n.includes('cervical'))) map.neck = o;

      else if (!map.hips && (n.includes('hip') || n.includes('pelvis') || n === 'hips' || n.includes('root')))
        map.hips = o;

      else if (!map.spine && (n.includes('spine') || n.includes('abdomen') || n.includes('body'))) map.spine = o;

      else if (!map.chest && (n.includes('chest') || n.includes('thorax') || n.includes('upperchest')))
        map.chest = o;

      // arms
      else if (
        !map.leftUpperArm &&
        n.includes('left') &&
        (n.includes('upperarm') || (n.includes('arm') && !n.includes('fore') && !n.includes('lower')))
      ) {
        map.leftUpperArm = o;
      } else if (
        !map.rightUpperArm &&
        n.includes('right') &&
        (n.includes('upperarm') || (n.includes('arm') && !n.includes('fore') && !n.includes('lower')))
      ) {
        map.rightUpperArm = o;
      }
    });

    // fallback preference
    if (!map.chest && map.spine) map.chest = map.spine;

    return map;
  }

  function captureRestPose(root) {
    rest.clear();
    root.traverse((o) => {
      if (!o || !o.isBone) return;
      rest.set(o.uuid, {
        pos: o.position.clone(),
        quat: o.quaternion.clone(),
      });
    });
  }

  function restoreToRest(bone) {
    const r = rest.get(bone.uuid);
    if (!r) return;
    bone.position.copy(r.pos);
    bone.quaternion.copy(r.quat);
  }

  function applyOffsetEuler(bone, euler) {
    const r = rest.get(bone.uuid);
    if (!r) return;
    const qOff = new THREE.Quaternion().setFromEuler(euler);
    bone.quaternion.copy(r.quat).multiply(qOff);
  }

  // ---------------------------
  // Public API
  // ---------------------------
  function registerAvatar(root, hasClips) {
    ensureInput();

    avatarRoot = root || null;
    hasBakedAnimations = !!hasClips;

    if (!avatarRoot) {
      bones = null;
      rest.clear();
      return;
    }

    bones = findBones(avatarRoot);
    captureRestPose(avatarRoot);

    // If no baked animations, nudge to a more natural rest pose (arms down a bit).
    if (!hasBakedAnimations) {
      // NOTE: different rigs vary; we apply a modest Z rotation offset relative to rest.
      // We do it by actually modifying rest pose (so future offsets remain stable).
      const armDown = 0.9; // radians (~52°)
      if (bones.leftUpperArm) {
        // common: +Z raises arm out; so we push it down by adding +armDown to rest rotation around Z
        bones.leftUpperArm.rotation.z += armDown;
      }
      if (bones.rightUpperArm) {
        bones.rightUpperArm.rotation.z -= armDown;
      }
      // Re-capture to treat this as new rest pose:
      captureRestPose(avatarRoot);
    }

    mode = 'idle';
    modeUntilMs = 0;

    console.log('[ProceduralAnimator] Registered avatar. bakedClips=', hasBakedAnimations, 'bones=', {
      head: !!bones.head,
      spine: !!bones.spine,
      hips: !!bones.hips,
      leftUpperArm: !!bones.leftUpperArm,
      rightUpperArm: !!bones.rightUpperArm,
    });
  }

  function setAllowWithMixer(v) {
    allowWithMixer = !!v;
  }

  function setMode(nextMode, durationMs) {
    mode = (nextMode || 'idle').toLowerCase();
    const dur = Number.isFinite(durationMs) ? durationMs : 1200;
    modeUntilMs = performance.now() + Math.max(0, dur);
  }

  function update(timeSec, dtSec) {
    if (!avatarRoot || !bones) return;

    // expire mode
    if (mode !== 'idle' && performance.now() > modeUntilMs) mode = 'idle';

    // If mixer is active and we are not allowed, bail (do not fight baked clips)
    if (hasBakedAnimations && !allowWithMixer) return;

    // Reset touched bones each frame to avoid drift
    const touched = [bones.hips, bones.spine, bones.chest, bones.neck, bones.head, bones.leftUpperArm, bones.rightUpperArm];
    touched.forEach((b) => b && restoreToRest(b));

    // ---------------------------
    // Base idle life
    // ---------------------------
    // Breathing
    if (bones.spine) {
      const breath = Math.sin(timeSec * 2.0) * 0.04;
      applyOffsetEuler(bones.spine, new THREE.Euler(breath, 0, 0));
    }
    if (bones.chest && bones.chest !== bones.spine) {
      const breath2 = Math.sin(timeSec * 2.0 + 0.7) * 0.03;
      applyOffsetEuler(bones.chest, new THREE.Euler(breath2, 0, 0));
    }

    // Head look (mouse)
    if (bones.head) {
      const yawT = THREE.MathUtils.clamp(mouse.x * 0.55, -0.7, 0.7);
      const pitchT = THREE.MathUtils.clamp(mouse.y * 0.25, -0.45, 0.45);

      const ud = (bones.head.userData.__nexus_proc ||= { yaw: 0, pitch: 0 });
      ud.yaw = damp(ud.yaw, yawT, 10, dtSec || 0.016);
      ud.pitch = damp(ud.pitch, pitchT, 10, dtSec || 0.016);

      applyOffsetEuler(bones.head, new THREE.Euler(ud.pitch, ud.yaw, 0));
    }

    // ---------------------------
    // Mode overlays (simple)
    // ---------------------------
    if (mode === 'thinking') {
      // slight head tilt + slow sway
      if (bones.head) {
        const tilt = Math.sin(timeSec * 1.4) * 0.12;
        applyOffsetEuler(bones.head, new THREE.Euler(0.10, 0.0, tilt));
      }
      if (bones.hips) {
        const sway = Math.sin(timeSec * 1.2) * 0.08;
        applyOffsetEuler(bones.hips, new THREE.Euler(0, sway, 0));
      }
    } else if (mode === 'happy') {
      // chest up + tiny bounce
      if (bones.chest) {
        const up = Math.sin(timeSec * 3.2) * 0.06;
        applyOffsetEuler(bones.chest, new THREE.Euler(-0.10 + up, 0, 0));
      }
      if (bones.hips) {
        const bounce = Math.sin(timeSec * 3.2) * 0.04;
        applyOffsetEuler(bones.hips, new THREE.Euler(bounce, 0, 0));
      }
    } else if (mode === 'dance') {
      if (bones.hips) {
        const sway = Math.sin(timeSec * 5.0) * 0.18;
        applyOffsetEuler(bones.hips, new THREE.Euler(0, sway, 0));
      }
      if (bones.chest) {
        const twist = Math.sin(timeSec * 6.0) * 0.12;
        applyOffsetEuler(bones.chest, new THREE.Euler(0, twist, 0));
      }
    } else if (mode === 'talk') {
      // small nod
      if (bones.head) {
        const nod = Math.sin(timeSec * 10.0) * 0.06;
        applyOffsetEuler(bones.head, new THREE.Euler(nod, 0, 0));
      }
      if (bones.chest) {
        const breathTalk = Math.sin(timeSec * 6.0) * 0.03;
        applyOffsetEuler(bones.chest, new THREE.Euler(breathTalk, 0, 0));
      }
    }
  }

  // expose
  window.NEXUS_PROCEDURAL_ANIMATOR = {
    registerAvatar,
    update,
    setMode,
    setAllowWithMixer,
  };
})();
EOF

say "✅ Wrote src/ProceduralAnimator.js"

# ==============================================================================
# 2) Patch index.html (load ProceduralAnimator before src/main.js)
# ==============================================================================
say "🔹 Patching index.html ..."
backup_file "index.html"

if grep -q "src/ProceduralAnimator.js" "index.html"; then
  say "🔸 index.html already patched (ProceduralAnimator.js found)."
else
  # Insert immediately before the script tag that loads src/main.js
  perl -0777 -i -pe '
    if ($_ !~ /src\/ProceduralAnimator\.js/) {
      s@(\<script\b[^>]*\bsrc="src/main\.js"[^>]*\>\s*\<\/script\>)@<script defer src="src/ProceduralAnimator.js"></script>\n        $1@
      or die "Could not find <script ... src=\"src/main.js\"> in index.html\n";
    }
  ' "index.html"
  say "✅ index.html patched"
fi

# ==============================================================================
# 3) Patch src/main.js
#    - Register avatar after it loads (legacy GLTFLoader path)
#    - Register avatar after viewer-engine loadAvatar (module ViewerEngine path)
#    - Call ProceduralAnimator.update in animate loop (legacy path)
#    - Trigger mode on quick actions (emotion buttons) + talk while speaking (safe)
# ==============================================================================
say "🔹 Patching src/main.js ..."
backup_file "src/main.js"

# 3A) Legacy GLTFLoader path: after scene.add(currentAvatar);
if grep -q "NEXUS_PATCH_LIFE_ENGINE_REGISTER_LEGACY" "src/main.js"; then
  say "🔸 main.js legacy register hook already present."
else
  perl -0777 -i -pe '
    my $marker = "/* NEXUS_PATCH_LIFE_ENGINE_REGISTER_LEGACY */";
    if ($_ !~ /\Q$marker\E/) {
      s@(scene\.add\(currentAvatar\);\s*)@$1\n            $marker\n            try {\n                window.NEXUS_PROCEDURAL_ANIMATOR?.registerAvatar?.(currentAvatar, Array.isArray(gltf.animations) && gltf.animations.length > 0);\n            } catch (_) {}\n@
      or warn "WARN: Could not inject legacy register hook after scene.add(currentAvatar);\n";
    }
  ' "src/main.js"
  say "✅ main.js legacy register hook injected"
fi

# 3B) ViewerEngine path: after await window.NEXUS_VIEWER.loadAvatar(url);
if grep -q "NEXUS_PATCH_LIFE_ENGINE_REGISTER_VIEWER" "src/main.js"; then
  say "🔸 main.js viewer register hook already present."
else
  perl -0777 -i -pe '
    my $marker = "/* NEXUS_PATCH_LIFE_ENGINE_REGISTER_VIEWER */";
    if ($_ !~ /\Q$marker\E/) {
      s@(await\s+window\.NEXUS_VIEWER\.loadAvatar\(url\);\s*)@$1\n                $marker\n                try {\n                    const root = window.NEXUS_VIEWER?.currentRoot || null;\n                    const hasClips = Array.isArray(window.NEXUS_VIEWER?.clips) && window.NEXUS_VIEWER.clips.length > 0;\n                    window.NEXUS_PROCEDURAL_ANIMATOR?.registerAvatar?.(root, hasClips);\n                } catch (_) {}\n@
      or warn "WARN: Could not inject viewer register hook after await window.NEXUS_VIEWER.loadAvatar(url);\n";
    }
  ' "src/main.js"
  say "✅ main.js viewer register hook injected"
fi

# 3C) animate() loop: call update after mixer.update(delta) (legacy renderer loop)
if grep -q "NEXUS_PATCH_LIFE_ENGINE_UPDATE_LOOP" "src/main.js"; then
  say "🔸 main.js update loop hook already present."
else
  perl -0777 -i -pe '
    my $marker = "/* NEXUS_PATCH_LIFE_ENGINE_UPDATE_LOOP */";
    if ($_ !~ /\Q$marker\E/) {
      s@(if\s*\(mixer\)\s*mixer\.update\(delta\);\s*)@$1\n    $marker\n    try {\n        // clock exists only in legacy ThreeJS path; guard it.\n        const t = (typeof clock !== \"undefined\" && clock) ? clock.getElapsedTime() : (performance.now() * 0.001);\n        window.NEXUS_PROCEDURAL_ANIMATOR?.update?.(t, delta);\n    } catch (_) {}\n@
      or warn "WARN: Could not inject update-loop hook after mixer.update(delta);\n";
    }
  ' "src/main.js"
  say "✅ main.js update loop hook injected"
fi

# 3D) Emotion buttons: setMode when user clicks quick actions (in addition to baked animations)
# Insert in the .emotion-btn click handler after emotion computed.
if grep -q "NEXUS_PATCH_LIFE_ENGINE_EMOTION_MODE" "src/main.js"; then
  say "🔸 main.js emotion setMode hook already present."
else
  perl -0777 -i -pe '
    my $marker = "/* NEXUS_PATCH_LIFE_ENGINE_EMOTION_MODE */";
    if ($_ !~ /\Q$marker\E/) {
      s@(const\s+emotion\s*=\s*\(btn\.dataset\.emotion\s*\|\|\s*\x27\x27\)\.toLowerCase\(\);\s*)@$1\n            $marker\n            try {\n                // Match your UI labels: IDLE/HAPPY/THINKING/DANCE/TALK\n                window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.(emotion, 1600);\n            } catch (_) {}\n@
      or warn "WARN: Could not inject setMode hook in emotion button handler.\n";
    }
  ' "src/main.js"
  say "✅ main.js emotion setMode hook injected"
fi

# 3E) speakText(): switch to talk mode while speaking; go back to idle on end/error
if grep -q "NEXUS_PATCH_LIFE_ENGINE_TALK_MODE" "src/main.js"; then
  say "🔸 main.js talk-mode hook already present."
else
  perl -0777 -i -pe '
    my $marker = "/* NEXUS_PATCH_LIFE_ENGINE_TALK_MODE */";
    if ($_ !~ /\Q$marker\E/) {
      s@(function\s+speakText\s*\(text\)\s*\{\s*\n\s*setStatus\(\x27speaking\x27,\s*\x27SPEAKING\.\.\.\x27\);\s*)@$&\n    $marker\n    try {\n        window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.(\"talk\", 30000);\n    } catch (_) {}\n@
      or warn "WARN: Could not inject talk-mode hook at start of speakText().\n";
    }
  ' "src/main.js"

  # Ensure onend/onerror set mode back to idle (near utterance.onend / utterance.onerror)
  perl -0777 -i -pe '
    if ($_ !~ /NEXUS_PATCH_LIFE_ENGINE_TALK_END/) {
      s@(utterance\.onend\s*=\s*\(\)\s*=>\s*\{\s*\n)@$1        /* NEXUS_PATCH_LIFE_ENGINE_TALK_END */\n        try { window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.(\"idle\", 1); } catch (_) {}\n@;
      s@(utterance\.onerror\s*=\s*\(\)\s*=>\s*\{\s*\n)@$1        /* NEXUS_PATCH_LIFE_ENGINE_TALK_ERR */\n        try { window.NEXUS_PROCEDURAL_ANIMATOR?.setMode?.(\"idle\", 1); } catch (_) {}\n@;
    }
  ' "src/main.js"

  say "✅ main.js talk-mode hooks injected"
fi

say "✅ src/main.js patched"

# ==============================================================================
# 4) Patch src/gltf-viewer/ViewerEngine.js (module loop)
#    - After loading: registerAvatar(currentRoot, clips.length>0)
#    - Each frame: call update(elapsed, dt)
# ==============================================================================
say "🔹 Patching src/gltf-viewer/ViewerEngine.js ..."
backup_file "src/gltf-viewer/ViewerEngine.js"

# 4A) After "this.currentRoot = gltf.scene; this.scene.add(this.currentRoot);" register.
if grep -q "NEXUS_PATCH_LIFE_ENGINE_VIEWERENGINE_REGISTER" "src/gltf-viewer/ViewerEngine.js"; then
  say "🔸 ViewerEngine.js register hook already present."
else
  perl -0777 -i -pe '
    my $marker = "/* NEXUS_PATCH_LIFE_ENGINE_VIEWERENGINE_REGISTER */";
    if ($_ !~ /\Q$marker\E/) {
      s@(this\.scene\.add\(this\.currentRoot\);\s*)@$1\n\n        $marker\n        try {\n            // ProceduralAnimator is a GLOBAL script (index.html loads it).\n            // In module context we still can call window.*.\n            window.NEXUS_PROCEDURAL_ANIMATOR?.registerAvatar?.(this.currentRoot, Array.isArray(this.clips) && this.clips.length > 0);\n        } catch (_) {}\n@
      or warn "WARN: Could not inject ViewerEngine register hook.\n";
    }
  ' "src/gltf-viewer/ViewerEngine.js"
  say "✅ ViewerEngine.js register hook injected"
fi

# 4B) In animate(): after dt computed, call procedural update with elapsed time
if grep -q "NEXUS_PATCH_LIFE_ENGINE_VIEWERENGINE_UPDATE" "src/gltf-viewer/ViewerEngine.js"; then
  say "🔸 ViewerEngine.js update hook already present."
else
  perl -0777 -i -pe '
    my $marker = "/* NEXUS_PATCH_LIFE_ENGINE_VIEWERENGINE_UPDATE */";
    if ($_ !~ /\Q$marker\E/) {
      s@(const\s+dt\s*=\s*this\.clock\.getDelta\(\);\s*)@$&\n\n        $marker\n        try {\n            const t = this.clock.getElapsedTime();\n            window.NEXUS_PROCEDURAL_ANIMATOR?.update?.(t, dt);\n        } catch (_) {}\n@
      or warn "WARN: Could not inject ViewerEngine update hook.\n";
    }
  ' "src/gltf-viewer/ViewerEngine.js"
  say "✅ ViewerEngine.js update hook injected"
fi

say "✅ ViewerEngine.js patched"

# ==============================================================================
# Done
# ==============================================================================
say ""
say "🎉 Patch complete."
say "🧾 Backups created with suffix: .bak.${TS}"
say "➡️ Reload the app. Static rigs should now breathe + head-look + react to quick actions."
