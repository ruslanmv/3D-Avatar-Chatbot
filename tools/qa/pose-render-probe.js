/**
 * UN6. Page-side measuring for tools/qa/private-pose-render-audit.mjs, injected into the real app.
 *
 * "Rendered" means what the GPU draws: the raw humanoid bones (the ones that skin her mesh, not
 * the normalized proxy the pose system writes) and skinned vertex positions computed with
 * SkinnedMesh.boneTransform. A reported preset name is never taken as proof of a posture.
 *
 *   standRef()  claims her in the T-pose `standing` preset for one frame and records the plane
 *               her soles rest on (lowest foot/toe skin) and her facing. Then hands her back.
 *   measure()   trunk/limb directions relative to that facing, rendered support surfaces
 *               (palm skin, knee skin within 12 cm of the joint, soles) above the sole plane,
 *               finger direction, palm-down score (thumb towards her midline), raw-vs-normalized hips, avatar identity.
 *   view(kind)  a camera at a fixed distance around her standing facing: front, back, left,
 *               right, q3, top, low (side, 25 cm above the sole plane), hands (close-up of
 *               the palms). Matching cameras for before/after. `reset` puts the person's
 *               camera back.
 *   grid(on)    a grid drawn exactly at the measured sole plane (ref.sole) while shooting, so
 *               contact is judged against the documented reference, never a moved grid.
 *   Skin that leans (>5 %) on a non-humanoid bone is not counted: secondary bones do not follow
 *   a posed limb. Vertices no triangle draws, and per-bone outliers in the bind pose, are
 *   skipped too (AvatarSample_A's tights carry a floor-level strip 30 cm out from the right
 *   foot, cut out by the texture's alpha).
 */
(function () {
    const am = () => window.NEXUS_VIEWER.avatarManager;
    const hum = () => am()._currentVRM.humanoid;
    const raw = (n) => hum().getRawBoneNode(n);
    let V3, ref;
    const wp = (n) => {
        const b = raw(n);
        if (!b) return null;
        V3 = V3 || b.position.constructor;
        return b.getWorldPosition(new V3());
    };
    const r3 = (x) => +x.toFixed(3);
    const P = (v) => (v ? [r3(v.x), r3(v.y), r3(v.z)] : null);

    /**
     * Her skin, once per avatar root, with the same rules as VRPoseSystem's skinOfAvatar: drawn
     * vertices only, nothing that leans (>5 %) on a non-humanoid bone, and per bone (pooled over
     * all meshes) an outlier beyond 2 x the 95th-percentile bind distance from its bone segment
     * (joint to child joint) + 3 cm, skipped except for the standing-sole reference. Needs
     * window.__L3 (THREE.Line3), set by loadThree().
     */
    const skinCache = new WeakMap();
    function skinOf(rootObj, nameOf) {
        if (skinCache.has(rootObj)) return skinCache.get(rootObj);
        const per = [];
        const spread = new Map();
        rootObj.traverse((mesh) => {
            if (!mesh.isSkinnedMesh || !mesh.geometry) return;
            const g = mesh.geometry;
            const si = g.attributes.skinIndex;
            const sw = g.attributes.skinWeight;
            const pos = g.attributes.position;
            if (!si || !sw || !pos) return;
            const M4 = mesh.bindMatrix.constructor;
            const joints = mesh.skeleton.boneInverses.map((inv) =>
                new V3().setFromMatrixPosition(new M4().copy(inv).invert())
            );
            const bonesList = mesh.skeleton.bones;
            const ends = bonesList.map((bone, b) => {
                const c = bonesList.findIndex((x) => x && x.parent === bone);
                return c >= 0 && joints[c] ? joints[c] : joints[b];
            });
            const L3 = window.__L3;
            const seg = L3 ? new L3() : null;
            const closest = new V3();
            const drawn = new Uint8Array(pos.count);
            if (g.index) for (let t = 0; t < g.index.count; t++) drawn[g.index.getX(t)] = 1;
            else drawn.fill(1);
            const keep = [];
            const v = new V3();
            for (let i = 0; i < pos.count; i++) {
                if (!drawn[i]) continue;
                let best = 0;
                let bw = -1;
                let stray = false;
                for (let k = 0; k < 4; k++) {
                    const w = sw[GET[k]](i);
                    const b = si[GET[k]](i);
                    if (w > 0.05 && !nameOf.has(mesh.skeleton.bones[b])) stray = true;
                    if (w > bw) {
                        bw = w;
                        best = b;
                    }
                }
                const bone = mesh.skeleton.bones[best];
                if (stray || !nameOf.has(bone) || !joints[best]) continue;
                v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix);
                let d;
                if (seg) {
                    seg.set(joints[best], ends[best]);
                    seg.closestPointToPoint(v, true, closest);
                    d = v.distanceTo(closest);
                } else d = v.distanceTo(joints[best]);
                if (!spread.has(bone)) spread.set(bone, []);
                spread.get(bone).push(d);
                keep.push([i, bone, d]);
            }
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            per.push({ mesh, keep, matName: mats.map((m) => (m && m.name) || '').join('|') });
        });
        const limit = new Map();
        for (const [bone, list] of spread) {
            list.sort((a, c) => a - c);
            limit.set(bone, list[Math.min(list.length - 1, Math.floor(list.length * 0.95))] * 2 + 0.03);
        }
        for (const m of per) m.keep = m.keep.map(([i, bone, d]) => [i, bone, d > limit.get(bone)]);
        skinCache.set(rootObj, per);
        return per;
    }

    /** Skinned vertex world positions grouped by dominant raw bone name. */
    function surfaces(filter, withOutliers) {
        V3 = V3 || raw('hips').position.constructor;
        const rootObj = am().currentRoot;
        rootObj.updateMatrixWorld(true);
        const nameOf = new Map();
        for (const n of Object.keys(hum().humanBones || {})) {
            const b = raw(n);
            if (b) nameOf.set(b, n);
        }
        const byBone = {};
        const v = new V3();
        for (const { mesh, keep, matName } of skinOf(rootObj, nameOf)) {
            if (!mesh.visible) continue;
            mesh.skeleton.update();
            const pos = mesh.geometry.attributes.position;
            for (const [i, bone, outlier] of keep) {
                if (outlier && !withOutliers) continue;
                const name = nameOf.get(bone);
                if (filter && !filter(name, matName)) continue;
                v.fromBufferAttribute(pos, i);
                mesh.boneTransform(i, v);
                v.applyMatrix4(mesh.matrixWorld);
                (byBone[name] = byBone[name] || []).push({ x: v.x, y: v.y, z: v.z, mat: matName });
            }
        }
        return byBone;
    }
    const GET = ['getX', 'getY', 'getZ', 'getW'];
    const minY = (arr) => (arr && arr.length ? Math.min(...arr.map((p) => p.y)) : null);

    function forwardOf() {
        const l = wp('leftUpperLeg');
        const r = wp('rightUpperLeg');
        const lr = l.clone().sub(r).setY(0).normalize();
        const up = new V3(0, 1, 0);
        return lr.clone().cross(up).normalize(); // cross(L-R, up)
    }

    window.__probe = {
        async loadThree() {
            const THREE = await import('/vendor/three-0.147.0/build/three.module.js');
            window.__L3 = THREE.Line3;
        },
        standRef() {
            const v = window.vrPoseSystem;
            v.claimBones();
            v.applyPreset('standing', 0);
            v.syncSkeleton();
            const s = surfaces((n) => /Foot|Toes/.test(n), true);
            const sole = Math.min(
                ...Object.values(s)
                    .map(minY)
                    .filter((x) => x != null)
            );
            const fwd = forwardOf();
            ref = { sole, fwd, hips: wp('hips'), head: wp('head') };
            v.releaseBones({ blendSeconds: 0 });
            return { sole: r3(sole), fwd: P(fwd), hips: P(ref.hips), head: P(ref.head) };
        },
        measure() {
            const v = window.vrPoseSystem;
            const up = new V3(0, 1, 0);
            const fwd = ref.fwd;
            const ang = (a, b) => {
                const d = wp(b).sub(wp(a)).normalize();
                const pitch = (Math.asin(Math.max(-1, Math.min(1, d.dot(fwd)))) * 180) / Math.PI; // + = toward front
                const tilt = (Math.acos(Math.max(-1, Math.min(1, d.dot(up)))) * 180) / Math.PI; // from vertical
                return { tilt: Math.round(tilt), fwd: Math.round(pitch) };
            };
            const skin = surfaces((n, mat) => /Hand$/.test(n) && /SKIN|Skin|skin|Body/.test(mat));
            const hands = surfaces((n) => /Hand$|Thumb|Index|Middle|Ring|Little/.test(n));
            const knees = surfaces((n) => /LowerLeg/.test(n));
            const feet = surfaces((n) => /Foot|Toes/.test(n));
            const palm = (side) => {
                const pts = skin[side + 'Hand'] || [];
                return pts.length ? r3(minY(pts) - ref.sole) : null;
            };
            const kneeSurf = (side) => {
                const k = wp(side + 'LowerLeg');
                const pts = (knees[side + 'LowerLeg'] || []).filter(
                    (p) => Math.hypot(p.x - k.x, p.y - k.y, p.z - k.z) < 0.12
                );
                return pts.length ? r3(minY(pts) - ref.sole) : null;
            };
            // Palm down, read from the thumb: with the fingers forward, a palm-down hand has its
            // thumb towards her midline (+1), a palm-up one away from it (-1). Unambiguous where a
            // palm normal from finger-base cross products depends on each rig's winding.
            const palmDown = (side) => {
                const h = wp(side + 'Hand');
                const t = wp(side + 'ThumbProximal');
                const l = wp('leftUpperLeg');
                const r = wp('rightUpperLeg');
                if (!h || !t || !l || !r) return null;
                const lr = l.sub(r).setY(0).normalize(); // towards her left
                const towardsLeft = t.sub(h).setY(0).normalize().dot(lr);
                return r3(side === 'left' ? -towardsLeft : towardsLeft);
            };
            const fingersFwd = (side) => {
                const h = wp(side + 'Hand');
                const m = wp(side + 'MiddleProximal');
                if (!h || !m) return null;
                return r3(m.sub(h).normalize().dot(fwd));
            };
            // normalized vs raw: hips world position difference
            const nh = hum().getNormalizedBoneNode('hips').getWorldPosition(new V3());
            const rh = wp('hips');
            const summary = {
                preset: v.getCurrentPreset(),
                held: v.isHoldingBones(),
                hipsY: r3(rh.y - ref.sole),
                headY: r3(wp('head').y - ref.sole),
                trunk: ang('hips', 'head'),
                spineUp: ang('hips', 'chest'),
                lArm: ang('leftUpperArm', 'leftHand'),
                rArm: ang('rightUpperArm', 'rightHand'),
                thighL: ang('leftUpperLeg', 'leftLowerLeg'),
                shinL: ang('leftLowerLeg', 'leftFoot'),
                handJointY: [r3(wp('leftHand').y - ref.sole), r3(wp('rightHand').y - ref.sole)],
                palmSkinY: [palm('left'), palm('right')],
                handAnyY: [r3(minY(hands.leftHand || []) - ref.sole), r3(minY(hands.rightHand || []) - ref.sole)],
                kneeSurfY: [kneeSurf('left'), kneeSurf('right')],
                kneeJointY: [r3(wp('leftLowerLeg').y - ref.sole), r3(wp('rightLowerLeg').y - ref.sole)],
                footSurfY: [r3(minY(feet.leftFoot || []) - ref.sole), r3(minY(feet.rightFoot || []) - ref.sole)],
                fingersFwd: [fingersFwd('left'), fingersFwd('right')],
                palmDown: [palmDown('left'), palmDown('right')],
                support: window.vrPoseSystem.lastSupport,
                normVsRawHips: r3(nh.distanceTo(rh)),
                rootUuid: am().currentRoot.uuid,
                url: (am().current && am().current.url) || null,
            };
            return { summary };
        },
        lowestByBone() {
            const all = surfaces(null);
            const out = {};
            for (const [k, pts] of Object.entries(all)) out[k] = r3(minY(pts) - ref.sole);
            return Object.fromEntries(
                Object.entries(out)
                    .sort((a, b) => a[1] - b[1])
                    .slice(0, 8)
            );
        },
        /** A grid exactly on the standing-sole plane (ref.sole), shown only while shooting. */
        async grid(on) {
            const scene = window.NEXUS_VIEWER.scene;
            let g = scene.getObjectByName('__soleGrid');
            if (!on) {
                if (g) scene.remove(g);
                return;
            }
            if (!g) {
                const THREE = await import('/vendor/three-0.147.0/build/three.module.js');
                g = new THREE.GridHelper(4, 40, 0x33ddff, 0x226688);
                g.name = '__soleGrid';
                g.material.depthTest = true;
            }
            g.position.set(am().currentRoot.position.x, ref.sole, am().currentRoot.position.z);
            scene.add(g);
        },
        view(kind) {
            const viewer = window.NEXUS_VIEWER;
            const cam = viewer.camera;
            const ctl = viewer.controls;
            if (kind === 'reset') {
                if (this._saved) {
                    cam.position.copy(this._saved.p);
                    ctl.target.copy(this._saved.t);
                    ctl.update();
                }
                return;
            }
            if (!this._saved) this._saved = { p: cam.position.clone(), t: ctl.target.clone() };
            const fwd = ref.fwd.clone();
            const up = new V3(0, 1, 0);
            const left = up.clone().cross(fwd).normalize(); // avatar's left
            const base = am().currentRoot.getWorldPosition(new V3());
            const target = base.clone().setY(ref.sole + 0.7);
            let dir;
            let dist = 4.4;
            if (kind === 'front') dir = fwd.clone();
            else if (kind === 'back') dir = fwd.clone().negate();
            else if (kind === 'left') dir = left.clone();
            else if (kind === 'right') dir = left.clone().negate();
            else if (kind === 'low') {
                dir = left.clone();
                target.setY(ref.sole + 0.25);
                dist = 3.4;
            } else if (kind === 'q3') dir = fwd.clone().add(left).normalize();
            else if (kind === 'top') {
                dir = up.clone().add(fwd.clone().multiplyScalar(0.02)).normalize();
                dist = 3.2;
                target.setY(ref.sole);
            } else if (kind === 'hands') {
                const l = wp('leftHand');
                const r = wp('rightHand');
                target.copy(l.add(r).multiplyScalar(0.5));
                target.y = ref.sole + 0.05;
                dir = fwd.clone().add(left.clone().multiplyScalar(0.9)).normalize().setY(0.18).normalize();
                dist = 0.9;
            }
            cam.position.copy(target).add(dir.multiplyScalar(dist));
            ctl.target.copy(target);
            ctl.update();
        },
    };
})();
