/**
 * ik-solver.worker.js — Off-main-thread CCD-IK solver
 * =====================================================
 * Runs the CCD-IK solver in a Web Worker to keep the main thread free
 * for rendering at a stable 72fps on Quest 3.
 *
 * Architecture (Surma pattern):
 *   Main thread:  Three.js render loop + WebXR input → posts bone positions
 *   This worker:  Receives bone chain + target → solves IK → returns quaternions
 *
 * Communication protocol:
 *   Main → Worker:  { type: 'solve', id, chain, target, options }
 *   Worker → Main:  { type: 'result', id, quaternions }
 *
 * The solver operates on plain arrays (no THREE.js dependency in worker).
 * Quaternions and positions are transferred as Float32Arrays.
 *
 * @see https://surma.dev/things/omt-for-three-xr/
 */

// =========================================================================
// PURE-MATH IK SOLVER (no Three.js dependency)
// =========================================================================

/**
 * Quaternion operations (minimal inline implementation).
 * Avoids importing Three.js into the worker for maximum performance.
 */
const Q = {
    identity: () => new Float32Array([0, 0, 0, 1]),

    multiply: (a, b) => {
        const [ax, ay, az, aw] = a;
        const [bx, by, bz, bw] = b;
        return new Float32Array([
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        ]);
    },

    invert: (q) => {
        const lenSq = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
        if (lenSq === 0) return Q.identity();
        const inv = 1 / lenSq;
        return new Float32Array([-q[0] * inv, -q[1] * inv, -q[2] * inv, q[3] * inv]);
    },

    fromAxisAngle: (ax, ay, az, angle) => {
        const half = angle * 0.5;
        const s = Math.sin(half);
        return new Float32Array([ax * s, ay * s, az * s, Math.cos(half)]);
    },

    normalize: (q) => {
        const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
        if (len === 0) return Q.identity();
        const inv = 1 / len;
        return new Float32Array([q[0] * inv, q[1] * inv, q[2] * inv, q[3] * inv]);
    },
};

/**
 * Rotate a vector by a quaternion: v' = q * v * q^-1
 */
function rotateVec3(v, q) {
    const [qx, qy, qz, qw] = q;
    const [vx, vy, vz] = v;

    // Optimized q*v*q^-1
    const ix = qw * vx + qy * vz - qz * vy;
    const iy = qw * vy + qz * vx - qx * vz;
    const iz = qw * vz + qx * vy - qy * vx;
    const iw = -qx * vx - qy * vy - qz * vz;

    return new Float32Array([
        ix * qw + iw * -qx + iy * -qz - iz * -qy,
        iy * qw + iw * -qy + iz * -qx - ix * -qz,
        iz * qw + iw * -qz + ix * -qy - iy * -qx,
    ]);
}

/**
 * Compute world-space position and quaternion for each bone in a chain.
 * Input: array of { localQuat, localPos, parentIndex }.
 * Output: array of { worldPos, worldQuat }.
 */
function computeWorldTransforms(bones) {
    const result = [];

    for (let i = 0; i < bones.length; i++) {
        const bone = bones[i];

        if (bone.parentIndex < 0) {
            // Root bone — world = local
            result.push({
                worldPos: new Float32Array(bone.localPos),
                worldQuat: new Float32Array(bone.localQuat),
            });
        } else {
            const parent = result[bone.parentIndex];

            // World quaternion = parent.worldQuat * bone.localQuat
            const wq = Q.multiply(parent.worldQuat, bone.localQuat);

            // World position = parent.worldPos + rotate(bone.localPos, parent.worldQuat)
            const rotatedPos = rotateVec3(bone.localPos, parent.worldQuat);
            const wp = new Float32Array([
                parent.worldPos[0] + rotatedPos[0],
                parent.worldPos[1] + rotatedPos[1],
                parent.worldPos[2] + rotatedPos[2],
            ]);

            result.push({ worldPos: wp, worldQuat: wq });
        }
    }

    return result;
}

/**
 * CCD-IK solver (pure math, no Three.js).
 *
 * @param {Array} bones - Array of bone data objects
 * @param {Float32Array} targetPos - [x, y, z] world-space target
 * @param {object} opts
 * @returns {Array<Float32Array>} Updated local quaternions for each bone
 */
function solveCCDIK(bones, targetPos, opts = {}) {
    const { iterations = 12, tolerance = 0.01, maxAnglePerStep = 0.3 } = opts;

    // Work on copies of local quaternions
    const localQuats = bones.map((b) => new Float32Array(b.localQuat));
    const effectorIdx = bones.length - 1;

    for (let iter = 0; iter < iterations; iter++) {
        // Recompute world transforms with current local quats
        const worldBones = bones.map((b, i) => ({
            localQuat: localQuats[i],
            localPos: b.localPos,
            parentIndex: b.parentIndex,
        }));
        const world = computeWorldTransforms(worldBones);

        // Check convergence
        const ep = world[effectorIdx].worldPos;
        const dx = ep[0] - targetPos[0];
        const dy = ep[1] - targetPos[1];
        const dz = ep[2] - targetPos[2];
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < tolerance) {
            break;
        }

        // Iterate from end-effector parent back to root
        for (let i = effectorIdx - 1; i >= 0; i--) {
            // Recompute (positions may have changed)
            const freshBones = bones.map((b, j) => ({
                localQuat: localQuats[j],
                localPos: b.localPos,
                parentIndex: b.parentIndex,
            }));
            const freshWorld = computeWorldTransforms(freshBones);

            const bonePos = freshWorld[i].worldPos;
            const effPos = freshWorld[effectorIdx].worldPos;

            // Vector from bone to effector
            let ex = effPos[0] - bonePos[0];
            let ey = effPos[1] - bonePos[1];
            let ez = effPos[2] - bonePos[2];
            const eLen = Math.sqrt(ex * ex + ey * ey + ez * ez);
            if (eLen < 1e-8) continue;
            ex /= eLen;
            ey /= eLen;
            ez /= eLen;

            // Vector from bone to target
            let tx = targetPos[0] - bonePos[0];
            let ty = targetPos[1] - bonePos[1];
            let tz = targetPos[2] - bonePos[2];
            const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);
            if (tLen < 1e-8) continue;
            tx /= tLen;
            ty /= tLen;
            tz /= tLen;

            // Cross product (rotation axis)
            let cx = ey * tz - ez * ty;
            let cy = ez * tx - ex * tz;
            let cz = ex * ty - ey * tx;
            const cLen = Math.sqrt(cx * cx + cy * cy + cz * cz);
            if (cLen < 1e-6) continue;
            cx /= cLen;
            cy /= cLen;
            cz /= cLen;

            // Angle (clamped)
            const dot = Math.min(1, Math.max(-1, ex * tx + ey * ty + ez * tz));
            const angle = Math.min(Math.acos(dot), maxAnglePerStep);
            if (angle < 0.001) continue;

            // Convert world-space rotation to local space
            const parentQuat = i > 0 ? freshWorld[bones[i].parentIndex]?.worldQuat : Q.identity();
            const invParent = Q.invert(parentQuat || Q.identity());
            const localAxis = rotateVec3(new Float32Array([cx, cy, cz]), invParent);

            // Apply delta rotation
            const delta = Q.fromAxisAngle(localAxis[0], localAxis[1], localAxis[2], angle);
            localQuats[i] = Q.normalize(Q.multiply(delta, localQuats[i]));
        }
    }

    return localQuats;
}

// =========================================================================
// WORKER MESSAGE HANDLER
// =========================================================================

self.onmessage = function (e) {
    const msg = e.data;

    if (msg.type === 'solve') {
        const { id, chain, target, options } = msg;

        try {
            const result = solveCCDIK(chain, target, options || {});

            // Send result back — array of Float32Array quaternions
            self.postMessage({
                type: 'result',
                id,
                quaternions: result.map((q) => Array.from(q)),
            });
        } catch (err) {
            self.postMessage({
                type: 'error',
                id,
                message: err.message,
            });
        }
    } else if (msg.type === 'ping') {
        self.postMessage({ type: 'pong' });
    }
};

// Signal ready
self.postMessage({ type: 'ready' });
