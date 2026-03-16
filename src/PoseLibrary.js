'use strict';

/**
 * PoseLibrary — Built-in presets + user-saved poses with localStorage persistence.
 *
 * Exposes: window.NEXUS_POSE_LIBRARY (constructor class)
 */
(function () {
    var STORAGE_KEY = 'homepilot_pose_library_v1';

    function PoseLibrary() {
        this.builtInPoses = this._createBuiltIns();
        this.userPoses = this._loadUserPoses();
    }

    // Built-in poses removed — VRPoseSystem is now the single source of truth
    // for all pose presets (standing, sitting, kneeling, lying, ground poses).
    // PoseLibrary only manages user-saved poses via localStorage.
    PoseLibrary.prototype._createBuiltIns = function () {
        return [];
    };

    PoseLibrary.prototype._loadUserPoses = function () {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        } catch (err) {
            console.warn('[PoseLibrary] Failed to load user poses', err);
            return [];
        }
    };

    PoseLibrary.prototype._saveUserPoses = function () {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.userPoses));
    };

    PoseLibrary.prototype.getBuiltInPoses = function () {
        return this.builtInPoses.slice();
    };

    PoseLibrary.prototype.getUserPoses = function () {
        return this.userPoses.slice();
    };

    PoseLibrary.prototype.getAllPoses = function () {
        return this.getBuiltInPoses().concat(this.getUserPoses());
    };

    PoseLibrary.prototype.getPoseById = function (id) {
        var all = this.getAllPoses();
        for (var i = 0; i < all.length; i++) {
            if (all[i].id === id) return all[i];
        }
        return null;
    };

    PoseLibrary.prototype.savePose = function (name, poseState) {
        var id = 'user_pose_' + Date.now();
        var entry = JSON.parse(JSON.stringify(poseState));
        entry.id = id;
        entry.builtIn = false;
        entry.name = name || poseState.name || 'Custom Pose';
        entry.updatedAt = new Date().toISOString();

        this.userPoses.unshift(entry);
        this._saveUserPoses();
        return entry;
    };

    PoseLibrary.prototype.updatePose = function (id, nextPoseState) {
        var idx = -1;
        for (var i = 0; i < this.userPoses.length; i++) {
            if (this.userPoses[i].id === id) {
                idx = i;
                break;
            }
        }
        if (idx === -1) return null;

        var updated = JSON.parse(JSON.stringify(nextPoseState));
        updated.id = id;
        updated.builtIn = false;
        updated.updatedAt = new Date().toISOString();
        this.userPoses[idx] = updated;
        this._saveUserPoses();
        return this.userPoses[idx];
    };

    PoseLibrary.prototype.deletePose = function (id) {
        this.userPoses = this.userPoses.filter(function (p) {
            return p.id !== id;
        });
        this._saveUserPoses();
    };

    PoseLibrary.prototype.exportPose = function (id) {
        var pose = this.getPoseById(id);
        return pose ? JSON.stringify(pose, null, 2) : null;
    };

    PoseLibrary.prototype.importPose = function (jsonText) {
        var pose = JSON.parse(jsonText);
        return this.savePose(pose.name || 'Imported Pose', pose);
    };

    window.NEXUS_POSE_LIBRARY = PoseLibrary;
})();
