/**
 * LT6. Changing clothes must not despawn her.
 *
 * AvatarManager is an ES module, so this reads the source the way the other
 * avatar tests do. The failure this guards: `_removeCurrentAvatar` ran before
 * `loader.load` resolved, and the stage was empty for the whole download.
 * An MMO keeps the current body until the next one is parsed, then blends.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../src/gltf-viewer/AvatarManager.js'), 'utf8');

function setAvatarByUrl() {
    const start = src.indexOf('async setAvatarByUrl');
    // The load frames her, then crossfades. Stop at the method that does the framing,
    // not at the call inside the load.
    const end = src.indexOf('frameAvatar() {', start);
    return src.slice(start, end);
}

describe('a wardrobe swap keeps her on stage', () => {
    const body = setAvatarByUrl();

    test('the current avatar is not removed before the next file has loaded', () => {
        expect(body).not.toMatch(/_removeCurrentAvatar\s*\(/);
        const loadAt = body.indexOf('this.loader.load(url, resolve, onProgress, reject)');
        const addAt = body.indexOf('this.scene.add(root)');
        expect(loadAt).toBeGreaterThan(-1);
        expect(addAt).toBeGreaterThan(loadAt);
        expect(body.indexOf('this._crossfade(outgoing, root)')).toBeGreaterThan(addAt);
    });

    test('pose and, for a wardrobe swap, facing move onto the new body before it is shown', () => {
        const addAt = body.indexOf('this.scene.add(root)');
        expect(body.indexOf('this._copyHumanoidPose(this._currentVRM, vrm)')).toBeLessThan(addAt);
        expect(body).toMatch(/options\.keepFacing/);
        expect(body).toMatch(/root\.rotation\.y = this\.currentRoot\.rotation\.y/);
        expect(src).toMatch(/if \(vrm\) this\._currentVRM = vrm/);
    });

    test('the next and previous looks can be parsed ahead, and only three are held', () => {
        expect(src).toMatch(/preload\(url\)/);
        expect(src).toMatch(/_preloads\.size > 3/);
        expect(src).toMatch(/fadeMs = 180/);
        expect(src).toMatch(/cached\.claimed = true/);
    });
});
