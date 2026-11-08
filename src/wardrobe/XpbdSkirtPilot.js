/**
 * Three audited skirt templates only. All helpers are pure and can be tested
 * in Node without VRM or a browser. WCL1 particles are in garment bind space;
 * the solver needs them initialized from CURRENT skinned world coordinates.
 */
(function (global, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_XPBD_SKIRT_PILOT = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null, function () {
    var TARGETS = {
        'dress-a-line-v1': true,
        'skirt-pencil-v1': true,
        'skirt-pleated-mini-v1': true,
    };

    function eligible(tag) {
        if (!tag || !TARGETS[tag.templateId]) return false;
        var asset = tag.clothAsset;
        return !!(asset && asset.schema === 'wardrobe.cloth/1' &&
            asset.simulation === 'xpbd' &&
            (asset.profile === 'cloth' || asset.profile === 'hybrid-skirt'));
    }

    function initialParticles(asset, renderWorld) {
        if (!asset || asset.binding.length * 3 !== renderWorld.length) {
            throw new Error('WCL1 render binding and mesh have different vertex counts');
        }
        var count = asset.positions.length / 3;
        var sums = new Float64Array(count * 3);
        var weights = new Float64Array(count);
        for (var i = 0; i < asset.binding.length; i += 1) {
            var b = asset.binding[i];
            var ids = [b.i0, b.i1, b.i2];
            var mix = [b.w0, b.w1, b.w2];
            for (var k = 0; k < 3; k += 1) {
                if (!mix[k]) continue;
                var particle = ids[k];
                if (particle >= count) throw new Error('WCL1 binding references missing particle');
                weights[particle] += mix[k];
                for (var axis = 0; axis < 3; axis += 1) {
                    sums[particle * 3 + axis] += renderWorld[i * 3 + axis] * mix[k];
                }
            }
        }
        var result = new Float32Array(count * 3);
        for (var j = 0; j < count; j += 1) {
            if (weights[j] < 1e-6) throw new Error('WCL1 particle has no render binding');
            for (var a = 0; a < 3; a += 1) result[j * 3 + a] = sums[j * 3 + a] / weights[j];
        }
        return result;
    }

    function hemMasks(asset, forwardSign) {
        var positions = asset.positions;
        var count = positions.length / 3;
        var loX = Infinity, hiX = -Infinity, loY = Infinity, hiY = -Infinity;
        var loZ = Infinity, hiZ = -Infinity;
        for (var i = 0; i < count; i += 1) {
            var x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
            loX = Math.min(loX, x); hiX = Math.max(hiX, x);
            loY = Math.min(loY, y); hiY = Math.max(hiY, y);
            loZ = Math.min(loZ, z); hiZ = Math.max(hiZ, z);
        }
        var hem = new Uint8Array(count);
        var centre = new Uint8Array(count);
        var hemMax = loY + Math.min(0.10, (hiY - loY) * 0.16);
        var midX = (hiX + loX) * 0.5, xBand = (hiX - loX) * 0.22;
        var frontCut = (loZ + hiZ) * 0.5;
        for (var j = 0; j < count; j += 1) {
            var at = j * 3;
            if (positions[at + 1] > hemMax || asset.attachment[j] >= 0.999) continue;
            hem[j] = 1;
            var front = forwardSign < 0 ? positions[at + 2] <= frontCut :
                positions[at + 2] >= frontCut;
            if (Math.abs(positions[at] - midX) <= xBand && front) centre[j] = 1;
        }
        return { hem: hem, centre: centre };
    }

    function boneSide(name, side) {
        var n = (name || '').toLowerCase();
        return n.includes(side) || (side === 'left' ? /(^|[_./-])l([_./-]|$)/ :
            /(^|[_./-])r([_./-]|$)/).test(n);
    }

    function joint(bones, side, type) {
        return bones.find(function (bone) {
            var n = (bone.name || '').toLowerCase().replace(/[ _./-]/g, '');
            if (!boneSide(bone.name, side)) return false;
            return type === 'upper' ? /upperleg|thigh/.test(n) : /lowerleg|shin|calf/.test(n);
        });
    }

    function thighCapsules(bodyMeshes) {
        var result = [];
        var seen = new Set();
        for (var m = 0; m < bodyMeshes.length; m += 1) {
            var skeleton = bodyMeshes[m].skeleton;
            if (!skeleton || seen.has(skeleton)) continue;
            seen.add(skeleton);
            var bones = skeleton.bones || [];
            for (var s = 0; s < 2; s += 1) {
                var side = s ? 'right' : 'left';
                var hip = joint(bones, side, 'upper'), knee = joint(bones, side, 'lower');
                if (!hip || !knee || !hip.matrixWorld || !knee.matrixWorld) continue;
                var a = hip.matrixWorld.elements, b = knee.matrixWorld.elements;
                var length = Math.hypot(a[12] - b[12], a[13] - b[13], a[14] - b[14]);
                if (!Number.isFinite(length) || length < 0.03) continue;
                result.push({
                    ax: a[12], ay: a[13], az: a[14],
                    bx: b[12], by: b[13], bz: b[14],
                    radius: Math.max(0.045, Math.min(0.14, length * 0.29)),
                    lap: true,
                });
            }
        }
        return result;
    }

    function briefBounds(renderWorld) {
        if (!renderWorld || !renderWorld.length) return null;
        var minY = Infinity;
        for (var i = 1; i < renderWorld.length; i += 3) {
            minY = Math.min(minY, renderWorld[i]);
        }
        return Number.isFinite(minY) ? { minY: minY } : null;
    }

    // M1. three-vrm's removeUnnecessaryVertices rebuilds every indexed mesh
    // with its vertices renumbered in order of first use in the index buffer,
    // even when no vertex is unused. A WCL1 binding addresses the file's own
    // vertex order, so after that pass the solver wrote particle i onto the
    // wrong render vertex: the standing A-line opened at the waist at 9.29x
    // edge stretch (docs/physics/CURRENT_STATE_AUDIT.md 3.1). No backend can
    // repair a binding that names the wrong vertex, so the fix is upstream of
    // every solver: a mesh that carries wardrobe.cloth/1 is lifted out of the
    // scene while the compaction runs and put back at the same child index.
    // The body, hair and every other mesh are still compacted as before.
    function carriesClothAsset(node) {
        for (var walk = node; walk; walk = walk.parent) {
            var forge = walk.userData && walk.userData.wardrobeForge;
            var asset = forge && forge.clothAsset;
            if (asset && asset.schema === 'wardrobe.cloth/1') return true;
        }
        return false;
    }

    function compactExceptCloth(root, compact) {
        var held = [];
        root.traverse(function (node) {
            if (!node.isMesh || !node.parent || !carriesClothAsset(node)) return;
            held.push({ node: node, parent: node.parent, index: node.parent.children.indexOf(node) });
        });
        // Detach after the traverse, so the walk never sees a list it is editing,
        // and last first: two cloth meshes can share a parent, and taking out the
        // earlier one first would shift the index recorded for the later one.
        for (var d = held.length - 1; d >= 0; d -= 1) {
            held[d].parent.children.splice(held[d].index, 1);
            held[d].node.parent = null;
        }
        try {
            compact(root);
        } finally {
            // First first, so every earlier sibling is back when an index is used.
            for (var r = 0; r < held.length; r += 1) {
                held[r].parent.children.splice(held[r].index, 0, held[r].node);
                held[r].node.parent = held[r].parent;
            }
        }
        return held.length;
    }

    return {
        carriesClothAsset: carriesClothAsset,
        compactExceptCloth: compactExceptCloth,
        eligible: eligible,
        initialParticles: initialParticles,
        hemMasks: hemMasks,
        thighCapsules: thighCapsules,
        briefBounds: briefBounds,
    };
});
