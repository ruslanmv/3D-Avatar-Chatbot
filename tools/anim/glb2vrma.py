"""Retarget a MakeHuman game-engine-rig GLB animation (Innerscene CC0) to a VRMA clip.

    python3 -I glb2vrma.py <in.glb> <out.vrma> [--fps 30] [--in-place]

VA2. Reproduces the CC0 clips in addons/vrma-cc0/ (see its README for sources and hashes). Sampled at fps, rotations in the VRM normalized
(T-pose) space VRMA uses, plus the hips translation. Swing alignment from the source rest pose to a
T-pose (arms +-X, legs -Y, spine +Y, feet +Z); twist is kept from the source.
"""
import json
import struct
import sys

import numpy as np

MAP = {
    "pelvis": "hips", "spine_01": "spine", "spine_02": "chest", "spine_03": "upperChest",
    "neck_01": "neck", "head": "head",
    "clavicle_l": "leftShoulder", "upperarm_l": "leftUpperArm", "lowerarm_l": "leftLowerArm", "hand_l": "leftHand",
    "clavicle_r": "rightShoulder", "upperarm_r": "rightUpperArm", "lowerarm_r": "rightLowerArm", "hand_r": "rightHand",
    "thigh_l": "leftUpperLeg", "calf_l": "leftLowerLeg", "foot_l": "leftFoot", "ball_l": "leftToes",
    "thigh_r": "rightUpperLeg", "calf_r": "rightLowerLeg", "foot_r": "rightFoot", "ball_r": "rightToes",
}
for side, s in (("l", "left"), ("r", "right")):
    for f, F in (("index", "Index"), ("middle", "Middle"), ("ring", "Ring"), ("pinky", "Little")):
        for k, part in ((1, "Proximal"), (2, "Intermediate"), (3, "Distal")):
            MAP[f"{f}_0{k}_{side}"] = f"{s}{F}{part}"
    MAP[f"thumb_01_{side}"] = f"{s}ThumbMetacarpal"
    MAP[f"thumb_02_{side}"] = f"{s}ThumbProximal"
    MAP[f"thumb_03_{side}"] = f"{s}ThumbDistal"

# The VRM humanoid hierarchy (parent of each bone).
HPARENT = {
    "spine": "hips", "chest": "spine", "upperChest": "chest", "neck": "upperChest", "head": "neck",
    "leftShoulder": "upperChest", "leftUpperArm": "leftShoulder", "leftLowerArm": "leftUpperArm", "leftHand": "leftLowerArm",
    "rightShoulder": "upperChest", "rightUpperArm": "rightShoulder", "rightLowerArm": "rightUpperArm", "rightHand": "rightLowerArm",
    "leftUpperLeg": "hips", "leftLowerLeg": "leftUpperLeg", "leftFoot": "leftLowerLeg", "leftToes": "leftFoot",
    "rightUpperLeg": "hips", "rightLowerLeg": "rightUpperLeg", "rightFoot": "rightLowerLeg", "rightToes": "rightFoot",
}
for s in ("left", "right"):
    for F in ("Index", "Middle", "Ring", "Little"):
        HPARENT[f"{s}{F}Proximal"] = f"{s}Hand"
        HPARENT[f"{s}{F}Intermediate"] = f"{s}{F}Proximal"
        HPARENT[f"{s}{F}Distal"] = f"{s}{F}Intermediate"
    HPARENT[f"{s}ThumbMetacarpal"] = f"{s}Hand"
    HPARENT[f"{s}ThumbProximal"] = f"{s}ThumbMetacarpal"
    HPARENT[f"{s}ThumbDistal"] = f"{s}ThumbProximal"


# --- quaternion helpers (x, y, z, w) ---------------------------------------------------------------
def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz])


def qinv(q):
    return np.array([-q[0], -q[1], -q[2], q[3]]) / np.dot(q, q)


def qrot(q, v):
    return qmul(qmul(q, np.array([v[0], v[1], v[2], 0.0])), qinv(q))[:3]


def qfrom_to(a, b):
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    d = float(np.dot(a, b))
    if d > 0.999999:
        return np.array([0.0, 0, 0, 1])
    if d < -0.999999:
        axis = np.cross(a, [1, 0, 0])
        if np.linalg.norm(axis) < 1e-6:
            axis = np.cross(a, [0, 1, 0])
        axis /= np.linalg.norm(axis)
        return np.array([*axis, 0.0])
    c = np.cross(a, b)
    q = np.array([c[0], c[1], c[2], 1 + d])
    return q / np.linalg.norm(q)


def slerp(a, b, t):
    d = np.dot(a, b)
    if d < 0:
        b, d = -b, -d
    if d > 0.9995:
        r = a + t * (b - a)
        return r / np.linalg.norm(r)
    th = np.arccos(d)
    return (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / np.sin(th)


# --- GLB ------------------------------------------------------------------------------------------
def read_glb(path):
    b = open(path, "rb").read()
    n = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + n])
    off = 20 + n
    blen = struct.unpack("<I", b[off:off + 4])[0]
    bin_ = b[off + 8:off + 8 + blen]
    return j, bin_


def accessor(j, bin_, i):
    a = j["accessors"][i]
    v = j["bufferViews"][a["bufferView"]]
    comp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
    assert a["componentType"] == 5126, "float accessors only"
    start = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    arr = np.frombuffer(bin_, dtype="<f4", count=a["count"] * comp, offset=start)
    return arr.reshape(a["count"], comp) if comp > 1 else arr


def main(argv):
    src, dst = argv[0], argv[1]
    fps = float(argv[argv.index("--fps") + 1]) if "--fps" in argv else 30.0
    in_place = "--in-place" in argv
    j, bin_ = read_glb(src)
    nodes = j["nodes"]
    parent = {}
    for i, nd in enumerate(nodes):
        for c in nd.get("children", []):
            parent[c] = i
    rest_t = [np.array(nd.get("translation", [0, 0, 0]), float) for nd in nodes]
    rest_r = [np.array(nd.get("rotation", [0, 0, 0, 1]), float) for nd in nodes]
    rest_s = [np.array(nd.get("scale", [1, 1, 1]), float) for nd in nodes]
    anim = j["animations"][0]
    tracks = {}
    duration = 0.0
    for ch in anim["channels"]:
        smp = anim["samplers"][ch["sampler"]]
        t = accessor(j, bin_, smp["input"])
        out = accessor(j, bin_, smp["output"])
        cubic = smp.get("interpolation") == "CUBICSPLINE"
        tracks[(ch["target"]["node"], ch["target"]["path"])] = (np.asarray(t, float), np.asarray(out, float), cubic)
        duration = max(duration, float(t[-1]))

    def sample(node, path, time, default):
        tr = tracks.get((node, path))
        if tr is None:
            return default
        t, v, cubic = tr
        if cubic:  # glTF CUBICSPLINE: per key (in-tangent, value, out-tangent)
            val, a_in, b_out = v[1::3], v[0::3], v[2::3]
        else:
            val = v
        if time <= t[0]:
            return val[0].copy()
        if time >= t[-1]:
            return val[-1].copy()
        k = int(np.searchsorted(t, time) - 1)
        dt = t[k + 1] - t[k]
        u = (time - t[k]) / dt
        if cubic:
            u2, u3 = u * u, u * u * u
            r = ((2 * u3 - 3 * u2 + 1) * val[k] + (u3 - 2 * u2 + u) * dt * b_out[k]
                 + (-2 * u3 + 3 * u2) * val[k + 1] + (u3 - u2) * dt * a_in[k + 1])
            return r / np.linalg.norm(r) if path == "rotation" else r
        return slerp(val[k], val[k + 1], u) if path == "rotation" else val[k] + u * (val[k + 1] - val[k])

    def world(time):
        """World (rotation, position) of every node at time (None: rest)."""
        R, P = {}, {}

        def go(i):
            if i in R:
                return
            lt = rest_t[i] if time is None else sample(i, "translation", time, rest_t[i])
            lr = rest_r[i] if time is None else sample(i, "rotation", time, rest_r[i])
            ls = rest_s[i] if time is None else sample(i, "scale", time, rest_s[i])
            if i in parent:
                go(parent[i])
                pr, pp, ps = R[parent[i]], P[parent[i]], S_[parent[i]]
                R[i] = qmul(pr, lr)
                P[i] = pp + qrot(pr, lt * ps)
                S_[i] = ps * ls
            else:
                R[i], P[i], S_[i] = lr, lt, ls

        S_ = {}
        for i in range(len(nodes)):
            go(i)
        return R, P

    name_of = {i: nd.get("name") for i, nd in enumerate(nodes)}
    hum = {MAP[n]: i for i, n in name_of.items() if n in MAP}
    Rr, Pr = world(None)
    # Facing: from the ankles to the balls of the feet is forward. VRMA faces +Z.
    fwd = (Pr[hum["leftToes"]] + Pr[hum["rightToes"]] - Pr[hum["leftFoot"]] - Pr[hum["rightFoot"]])
    fwd[1] = 0
    yaw = qfrom_to(fwd, np.array([0.0, 0, 1]))
    up = np.array([0.0, 1, 0])
    child_of = {}
    for b, p in HPARENT.items():
        child_of.setdefault(p, []).append(b)
    first_child = {"hips": "spine", "upperChest": "neck", "leftHand": "leftMiddleProximal",
                   "rightHand": "rightMiddleProximal", "leftFoot": "leftToes", "rightFoot": "rightToes"}
    canon = {}
    for b in hum:
        if b in ("hips", "spine", "chest", "upperChest", "neck", "head"):
            canon[b] = up
        elif b.startswith("left") and ("Arm" in b or "Shoulder" in b or "Hand" in b or any(
                f in b for f in ("Index", "Middle", "Ring", "Little"))):
            canon[b] = np.array([1.0, 0, 0])
        elif b.startswith("right") and ("Arm" in b or "Shoulder" in b or "Hand" in b or any(
                f in b for f in ("Index", "Middle", "Ring", "Little"))):
            canon[b] = np.array([-1.0, 0, 0])
        elif "Thumb" in b:
            canon[b] = np.array([1.0 if b.startswith("left") else -1.0, 0, 1.0])
        elif "UpperLeg" in b or "LowerLeg" in b:
            canon[b] = -up
        elif "Foot" in b or "Toes" in b:
            canon[b] = np.array([0.0, 0, 1])
    # Alignment per bone: swing its rest direction (to its child joint, in faced world) onto T-pose.
    A = {}
    for b in hum:
        c = first_child.get(b) or (child_of.get(b, [None])[0])
        if c in hum and b in canon:
            d = qrot(yaw, Pr[hum[c]] - Pr[hum[b]])
            A[b] = qfrom_to(d, canon[b])
    for b in hum:  # tips (head, toes, distal fingers): their parent's alignment
        if b not in A:
            p = HPARENT.get(b)
            while p and p not in A:
                p = HPARENT.get(p)
            A[b] = A.get(p, np.array([0.0, 0, 0, 1]))
    WT = {b: qmul(A[b], qmul(yaw, Rr[hum[b]])) for b in hum}  # T-pose world rotations
    # T-pose joint positions (for the VRMA rest nodes): rest offsets swung by the parent's alignment.
    PT = {"hips": qrot(yaw, Pr[hum["hips"]])}
    order = ["hips"]
    for b in order:
        for c in child_of.get(b, []):
            if c in hum:
                off = qrot(yaw, Pr[hum[c]] - Pr[hum[b]])
                PT[c] = PT[b] + qrot(A[b], off)
                order.append(c)
    bones = [b for b in order if b in hum]
    n = int(round(duration * fps)) + 1
    times = np.linspace(0, duration, n)
    rots = {b: np.zeros((n, 4), np.float32) for b in bones}
    hips_pos = np.zeros((n, 3), np.float32)
    for k, t in enumerate(times):
        R, P = world(float(t))
        D = {b: qmul(qmul(yaw, R[hum[b]]), qinv(WT[b])) for b in bones}
        for b in bones:
            p = HPARENT.get(b)
            q = D[b] if p is None else qmul(qinv(D[p]), D[b])
            if k and np.dot(q, rots[b][k - 1]) < 0:
                q = -q
            rots[b][k] = q / np.linalg.norm(q)
        hp = qrot(yaw, P[hum["hips"]])
        hips_pos[k] = hp
    # Loop seam: ease the last `blend` seconds into the first pose, so the clip loops without a jump.
    blend = float(argv[argv.index("--loop-blend") + 1]) if "--loop-blend" in argv else 0.0
    if blend > 0:
        m = max(2, int(round(blend * fps)))
        for k in range(n - m, n):
            w = (k - (n - m)) / (m - 1)
            w = w * w * (3 - 2 * w)
            for b in bones:
                rots[b][k] = slerp(rots[b][k].astype(float), rots[b][0].astype(float), w)
            hips_pos[k] = hips_pos[k] * (1 - w) + hips_pos[0] * w
    if in_place:
        hips_pos[:, 0] = hips_pos[0, 0]
        hips_pos[:, 2] = hips_pos[0, 2]
    # --- write the VRMA ------------------------------------------------------------------------------
    blob = bytearray()
    views, accs = [], []

    def add(arr, typ, minmax=False):
        arr = np.ascontiguousarray(arr, dtype="<f4")
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(arr.tobytes())
        views.append({"buffer": 0, "byteOffset": off, "byteLength": arr.nbytes})
        a = {"bufferView": len(views) - 1, "componentType": 5126, "count": int(arr.shape[0]), "type": typ}
        if minmax:
            a["min"] = [float(arr.min())]
            a["max"] = [float(arr.max())]
        accs.append(a)
        return len(accs) - 1

    vnodes, index = [], {}
    for b in bones:
        index[b] = len(vnodes)
        p = HPARENT.get(b)
        tr = PT[b] - (PT[p] if p else 0)
        vnodes.append({"name": b, "translation": [float(x) for x in tr]})
    for b in bones:
        kids = [index[c] for c in child_of.get(b, []) if c in index]
        if kids:
            vnodes[index[b]]["children"] = kids
    tin = add(times.astype(np.float32), "SCALAR", minmax=True)
    samplers, channels = [], []
    for b in bones:
        samplers.append({"input": tin, "output": add(rots[b], "VEC4"), "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": index[b], "path": "rotation"}})
    samplers.append({"input": tin, "output": add(hips_pos, "VEC3"), "interpolation": "LINEAR"})
    channels.append({"sampler": len(samplers) - 1, "target": {"node": index["hips"], "path": "translation"}})
    gltf = {
        "asset": {"version": "2.0", "generator": "glb2vrma scratch (MakeHuman game rig to VRMA)"},
        "extensionsUsed": ["VRMC_vrm_animation"],
        "extensions": {"VRMC_vrm_animation": {"specVersion": "1.0",
                                              "humanoid": {"humanBones": {b: {"node": index[b]} for b in bones}}}},
        "scene": 0, "scenes": [{"nodes": [index["hips"]]}], "nodes": vnodes,
        "buffers": [{"byteLength": len(blob)}], "bufferViews": views, "accessors": accs,
        "animations": [{"name": src.rsplit("/", 1)[-1].rsplit(".", 1)[0], "samplers": samplers, "channels": channels}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    while len(js) % 4:
        js += b" "
    while len(blob) % 4:
        blob.append(0)
    out = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack("<I4s", len(js), b"JSON") + js + struct.pack("<I4s", len(blob), b"BIN\x00") + bytes(blob)
    open(dst, "wb").write(out)
    travel = float(np.linalg.norm(hips_pos[-1, [0, 2]] - hips_pos[0, [0, 2]]))
    print(f"{dst}: {len(bones)} bones, {n} frames at {fps:g} fps, {duration:.2f} s, {len(out) / 1024:.0f} KiB, "
          f"hips travel {travel * 100:.1f} cm, rest hips height {PT['hips'][1]:.3f} m")


if __name__ == "__main__":
    main(sys.argv[1:])
