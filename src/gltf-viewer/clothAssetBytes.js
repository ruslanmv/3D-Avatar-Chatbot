/**
 * Turn a Forge `clothAsset` extra into WCL1 bytes before the page posts XPBD.
 *
 * The glTF extra is a buffer-view reference. GLTFLoader copies that reference
 * onto `userData` and does not decode it. Posting the reference makes the
 * worker throw, and that throw used to discard the pose correction as well.
 */

export function isClothBytes(value) {
    return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

export function clothViewIndex(extra) {
    if (typeof extra === 'number' && extra >= 0 && extra === Math.floor(extra)) return extra;
    if (!extra || typeof extra !== 'object' || isClothBytes(extra)) return null;
    if (typeof extra.bufferView === 'number') return extra.bufferView;
    if (typeof extra.index === 'number') return extra.index;
    return null;
}

export function clothPayload(tag) {
    if (!tag) return null;
    const bytes = tag.clothAssetBytes != null ? tag.clothAssetBytes : tag.clothAsset;
    if (!isClothBytes(bytes)) return null;
    return bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
}

export async function clothBytesFromParser(extra, parser) {
    if (isClothBytes(extra)) {
        return extra instanceof Uint8Array
            ? extra
            : new Uint8Array(extra.buffer || extra, extra.byteOffset || 0, extra.byteLength);
    }
    const index = clothViewIndex(extra);
    if (index == null || !parser || typeof parser.getDependency !== 'function') return null;
    const buffer = await parser.getDependency('bufferView', index);
    if (!buffer) return null;
    return new Uint8Array(buffer);
}

/** Store the resolved bytes on each garment tag. Leaves the original extra in place. */
export async function attachClothBytes(root, parser) {
    if (!root || typeof root.traverse !== 'function') return;
    const pending = [];
    root.traverse((node) => {
        const tag = node.userData && node.userData.wardrobeForge;
        if (!tag || isClothBytes(tag.clothAssetBytes)) return;
        if (tag.clothAsset == null) return;
        pending.push(
            clothBytesFromParser(tag.clothAsset, parser)
                .then((bytes) => {
                    if (bytes) tag.clothAssetBytes = bytes;
                })
                .catch(() => null)
        );
    });
    await Promise.all(pending);
}
