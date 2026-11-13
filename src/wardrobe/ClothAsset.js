/**
 * Read a Forge cloth asset (schema wardrobe.cloth/1, magic WCL1).
 *
 * The byte layout is the one wardrobe/cloth/binary.py writes. Particle arrays
 * stay in the glTF buffer. This file does not invent seams or a seated shape.
 */
(function (global, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_CLOTH_ASSET = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null, function () {
    var SCHEMA = 'wardrobe.cloth/1';

    function decode(buffer) {
        var bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
        var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        var magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
        if (magic !== 'WCL1') throw new Error('unsupported cloth asset ' + magic);
        var version = view.getUint32(4, true);
        if (version !== 1) throw new Error('unsupported cloth asset version ' + version);
        var flags = view.getUint32(8, true);
        var particles = view.getUint32(12, true);
        var triangleCount = view.getUint32(16, true);
        var stretchCount = view.getUint32(20, true);
        var shearCount = view.getUint32(24, true);
        var bendCount = view.getUint32(28, true);
        var seamCount = view.getUint32(32, true);
        var attachmentCount = view.getUint32(36, true);
        var renderCount = view.getUint32(40, true);
        var lodCount = view.getUint32(44, true);
        var offset = 48;

        function u32() {
            var value = view.getUint32(offset, true);
            offset += 4;
            return value;
        }
        function f32() {
            var value = view.getFloat32(offset, true);
            offset += 4;
            return value;
        }
        function pairs(count) {
            var list = [];
            for (var index = 0; index < count; index += 1) {
                list.push({ a: u32(), b: u32(), rest: f32(), lambda: 0 });
            }
            return list;
        }

        var positions = new Float32Array(particles * 3);
        for (var p = 0; p < positions.length; p += 1) positions[p] = f32();
        var triangles = new Uint32Array(triangleCount * 3);
        for (var t = 0; t < triangles.length; t += 1) triangles[t] = u32();
        var stretch = pairs(stretchCount);
        var shear = [];
        for (var s = 0; s < shearCount; s += 1) {
            shear.push({ a: u32(), b: u32(), c: u32(), rest: f32(), lambda: 0 });
        }
        var bend = pairs(bendCount);
        var seams = [];
        for (var e = 0; e < seamCount; e += 1) seams.push([u32(), u32()]);
        var attachment = new Float32Array(particles);
        for (var a = 0; a < attachmentCount; a += 1) attachment[u32()] = f32();
        var binding = [];
        for (var r = 0; r < renderCount; r += 1) {
            binding.push({ i0: u32(), i1: u32(), i2: u32(), w0: f32(), w1: f32(), w2: f32() });
        }
        var lods = [];
        for (var lodIndex = 0; lodIndex < lodCount; lodIndex += 1) {
            var nameLength = u32();
            var characters = [];
            for (var c = 0; c < nameLength; c += 1) characters.push(String.fromCharCode(view.getUint8(offset + c)));
            offset += nameLength;
            offset = (offset + 3) & ~3;
            var coarseCount = u32();
            var coarseTriangles = u32();
            var coarsePositions = new Float32Array(coarseCount * 3);
            for (var q = 0; q < coarsePositions.length; q += 1) coarsePositions[q] = f32();
            var coarseIndex = new Uint32Array(coarseTriangles * 3);
            for (var q2 = 0; q2 < coarseIndex.length; q2 += 1) coarseIndex[q2] = u32();
            var particleMap = new Uint32Array(particles);
            for (var m = 0; m < particles; m += 1) particleMap[m] = u32();
            lods.push({
                name: characters.join(''),
                positions: coarsePositions,
                triangles: coarseIndex,
                particleMap: particleMap,
            });
        }
        if (offset > bytes.byteLength) throw new Error('cloth asset ended early');
        return {
            schema: SCHEMA,
            flags: flags,
            heightFallback: (flags & 1) !== 0,
            particles: particles,
            positions: positions,
            triangles: triangles,
            stretch: stretch,
            shear: shear,
            bend: bend,
            seams: seams,
            attachment: attachment,
            binding: binding,
            lods: lods,
        };
    }

    /**
     * Pull the payload named by a node's clothAsset extra out of the GLB binary chunk.
     * ``bufferViews`` is the glTF bufferViews array. The chunk is buffer 0.
     */
    function readView(binary, bufferViews, index) {
        var view = bufferViews[index];
        if (!view) throw new Error('cloth asset bufferView ' + index + ' is missing');
        var start = view.byteOffset || 0;
        return binary.subarray(start, start + view.byteLength);
    }

    function isBytes(value) {
        return value instanceof ArrayBuffer || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value));
    }

    /** A clothAsset extra may be the bytes, a bufferView index, or `{bufferView: n}`. */
    function viewIndex(extra) {
        if (typeof extra === 'number' && extra >= 0 && extra === Math.floor(extra)) return extra;
        if (!extra || typeof extra !== 'object' || isBytes(extra)) return null;
        if (typeof extra.bufferView === 'number') return extra.bufferView;
        if (typeof extra.index === 'number') return extra.index;
        return null;
    }

    /**
     * Bytes to post to the worker. A buffer-view reference is not a payload:
     * posting it makes decode throw and drops the pose correction too.
     */
    function payload(extra) {
        if (!isBytes(extra)) return null;
        return extra instanceof Uint8Array
            ? extra
            : new Uint8Array(extra.buffer || extra, extra.byteOffset || 0, extra.byteLength);
    }

    /**
     * Resolve a clothAsset extra through the glTF parser. `parser.getDependency('bufferView', n)`
     * is the loader's buffer-view slice. No parser and no bytes means the garment stays
     * on the pose corrector.
     */
    function bytesFromParser(extra, parser) {
        var ready = payload(extra);
        if (ready) return Promise.resolve(ready);
        var index = viewIndex(extra);
        if (index == null || !parser || typeof parser.getDependency !== 'function') return Promise.resolve(null);
        return Promise.resolve(parser.getDependency('bufferView', index)).then(function (buffer) {
            if (!buffer) return null;
            return new Uint8Array(buffer);
        });
    }

    return {
        SCHEMA: SCHEMA,
        decode: decode,
        readView: readView,
        isBytes: isBytes,
        viewIndex: viewIndex,
        payload: payload,
        bytesFromParser: bytesFromParser,
    };
});
