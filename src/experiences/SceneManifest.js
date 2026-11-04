/**
 * SceneManifest — the contract for a place, checked before anything is built (IC2).
 *
 * Four scene types stay distinct so a flat backdrop cannot be mistaken for a
 * walkable world:
 *
 *   desktop-background     an image or colour behind the avatar
 *   immersive-panorama     a 360 projection, no collision, no walkable floor
 *   interactive-3d         real geometry, anchors, and bounds
 *   mixed-reality          objects placed in a real room, only when the
 *                          session can actually do that
 *
 * Validation is fail-soft: a bad manifest returns reasons and is not loaded.
 * One broken scene must not take the chat down with it. Asset paths have to
 * be relative and free of `..`, because a manifest is data and data does not
 * get to point at the filesystem.
 *
 * Exposes: window.NEXUS_EXPERIENCE_MANIFEST
 */
const SceneManifest = (() => {
    'use strict';

    const SCHEMA = 1;
    const TYPES = Object.freeze(['desktop-background', 'immersive-panorama', 'interactive-3d', 'mixed-reality']);

    function isSafePath(value) {
        if (typeof value !== 'string' || !value) return false;
        if (value.indexOf('..') !== -1) return false;
        if (/^[a-z]+:/i.test(value)) return false;
        if (value.charAt(0) === '/' || value.charAt(0) === '\\') return false;
        return true;
    }

    function validate(manifest) {
        const problems = [];
        if (!manifest || typeof manifest !== 'object') return ['not an object'];
        if (manifest.schemaVersion !== SCHEMA) problems.push('schemaVersion must be ' + SCHEMA);
        if (typeof manifest.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(manifest.id)) {
            problems.push('id must be a slug');
        }
        if (typeof manifest.title !== 'string' || !manifest.title) problems.push('title must be a string');
        if (TYPES.indexOf(manifest.sceneType) === -1) problems.push('sceneType is not a known type');
        if (!Array.isArray(manifest.assetPaths)) problems.push('assetPaths must be an array');
        else {
            for (const path of manifest.assetPaths) {
                if (!isSafePath(path)) problems.push('unsafe asset path');
            }
        }
        if (!manifest.qualityPresets || typeof manifest.qualityPresets !== 'object') {
            problems.push('qualityPresets must be an object');
        }
        if (!manifest.lighting || typeof manifest.lighting !== 'object') problems.push('lighting must be an object');
        if (!manifest.audio || typeof manifest.audio !== 'object') problems.push('audio must be an object');
        if (!manifest.avatarPlacement || typeof manifest.avatarPlacement !== 'object') {
            problems.push('avatarPlacement must be an object');
        }
        if (!Array.isArray(manifest.interactionAnchors)) problems.push('interactionAnchors must be an array');
        else {
            for (const anchor of manifest.interactionAnchors) {
                if (!anchor || typeof anchor.id !== 'string') problems.push('an anchor has no id');
                else if (!Array.isArray(anchor.position) || anchor.position.length !== 3) {
                    problems.push('anchor ' + anchor.id + ' needs a position');
                }
            }
        }
        if (
            !manifest.navigationBounds ||
            !Array.isArray(manifest.navigationBounds.min) ||
            !Array.isArray(manifest.navigationBounds.max)
        ) {
            problems.push('navigationBounds needs min and max');
        }
        if (
            manifest.sceneType === 'interactive-3d' &&
            (!Array.isArray(manifest.bodies) || manifest.bodies.length < 2)
        ) {
            problems.push('an interactive scene needs real bodies, not a single backdrop');
        }
        if (manifest.fallbackScene != null && typeof manifest.fallbackScene !== 'string') {
            problems.push('fallbackScene must be a string id or omitted');
        }
        return problems;
    }

    return { SCHEMA: SCHEMA, TYPES: TYPES, validate: validate, isSafePath: isSafePath };
})();

if (typeof window !== 'undefined') window.NEXUS_EXPERIENCE_MANIFEST = SceneManifest;
if (typeof module !== 'undefined' && module.exports) module.exports = SceneManifest;
