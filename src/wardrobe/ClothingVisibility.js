/**
 * CV1. Her clothing hidden and shown again, in Private, for an approved file only — never a body made up.
 *
 * Wardrobe Forge decides; this follows. For the exact bytes on stage (their SHA-256, hashed here from
 * the file that was loaded, not taken from a name or a pinned constant) Forge answers whether her
 * clothing may be hidden and which (`GET /v1/visibility/{sha}` for a library file, `POST
 * /v1/visibility` for any other). Forge says yes only when every question the bare body state asks
 * passes for those bytes — the creator's terms, the operator's switch, the character's adult
 * declaration and a person's review (or a cleared file this one only adds clothing to) — and the body
 * under the clothes is whole. A file whose body is missing under the dress, or whose clothes are
 * painted on her skin, is refused with Forge's reason: hiding is not restoring a body.
 *
 * Hiding sets `visible = false` on the garment meshes Forge named (Forge-tagged nodes, or materials it
 * listed) and nothing else: her body, skeleton, expressions and animations are not touched, and the
 * meshes stay loaded so showing them again is instant. Every value overwritten is snapshotted and
 * written back verbatim on restore (snapshot and restore, never a bespoke undo).
 *
 * Restored, without being asked, when: Private is turned off; a General-only place is shown (the
 * school: `nexus-world-shown`); the avatar on stage changes. The choice is remembered for that exact
 * file only (`nexus_clothing_hidden`), and re-applied on the next load of the same bytes only if Forge
 * still says yes and Private is on. Nothing about the person enters Forge's answer: their own adult
 * confirmation opens Private; it never stands in for the character's.
 */
(function (global) {
    'use strict';

    const STORAGE = 'nexus_clothing_hidden';
    const OUTLINE = / \(Outline\)$/;

    function hex(buffer) {
        return Array.from(new Uint8Array(buffer))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    }

    async function sha256(bytes) {
        const subtle = global && global.crypto && global.crypto.subtle;
        if (!subtle) throw new Error('no SubtleCrypto: the file cannot be identified');
        return hex(await subtle.digest('SHA-256', bytes));
    }

    function isForgeGarment(object) {
        for (let o = object; o; o = o.parent) {
            const tag = o.userData && o.userData.wardrobeForge;
            if (tag && tag.kind === 'garment') return true;
        }
        return false;
    }

    /** The meshes Forge named for hiding, under `root`. Pure: reads the scene graph only. */
    function garmentMeshes(root, materials) {
        const names = new Set((materials || []).map(String));
        const found = [];
        if (!root || typeof root.traverse !== 'function') return found;
        root.traverse((o) => {
            if (!o || !o.isMesh) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            const named = mats.some((m) => m && names.has(String(m.name || '').replace(OUTLINE, '')));
            if (named || (names.size && isForgeGarment(o))) found.push(o);
        });
        return found;
    }

    /** Hide them; the snapshot holds each one's own `visible`, to be written back exactly. */
    function hide(meshes) {
        const snapshot = meshes.map((object) => ({ object, visible: object.visible }));
        for (const m of meshes) m.visible = false;
        return snapshot;
    }

    function restore(snapshot) {
        for (const s of snapshot || []) s.object.visible = s.visible;
    }

    class ClothingVisibilityController {
        /**
         * options.win          the page (NEXUS_VIEWER, NEXUS_SPICY, localStorage, fetch)
         * options.ask(sha, bytes)  Forge's answer for exact bytes (defaults to the Wardrobe client)
         * options.bytesOf(url)     the loaded file's bytes (defaults to fetch: the browser has it cached)
         */
        constructor(options) {
            options = options || {};
            this.win = options.win || global;
            this.ask = options.ask || ((sha, bytes) => this._askForge(sha, bytes));
            this.bytesOf = options.bytesOf || ((url) => this.win.fetch(url).then((r) => r.arrayBuffer()));
            this.snapshot = null;
            this.root = null;
            this.sha = null;
            this.answers = new Map();
            this._off = [];
        }

        _manager() {
            const v = this.win.NEXUS_VIEWER;
            return v && v.avatarManager;
        }

        _privateOn() {
            const s = this.win.NEXUS_SPICY;
            try {
                return Boolean(s && s.isEnabled());
            } catch (_) {
                return false;
            }
        }

        async _askForge(sha, bytes) {
            const w = this.win.NEXUS_WARDROBE;
            const forge = w && w.service && w.service.controller && w.service.controller.forge;
            if (!forge || typeof forge.request !== 'function')
                return { allowed: false, refusedBy: 'forge-unavailable' };
            try {
                return await forge.request(`/v1/visibility/${sha}`);
            } catch (_) {
                const body = new this.win.FormData();
                body.append('file', new this.win.Blob([bytes]), 'avatar.vrm');
                return forge.request('/v1/visibility', { method: 'POST', body });
            }
        }

        /** Forge's answer for the file on stage now, cached per exact bytes. */
        async answerForStage() {
            const m = this._manager();
            if (!m || !m.currentRoot || !m.current || !m.current.url) return { allowed: false, refusedBy: 'no-avatar' };
            const bytes = await this.bytesOf(m.current.url);
            const sha = await sha256(bytes);
            if (!this.answers.has(sha)) this.answers.set(sha, await this.ask(sha, bytes));
            const answer = this.answers.get(sha);
            // Forge's answer must be about these bytes; anything else is not an answer.
            if (!answer || answer.sha256 !== sha) return { allowed: false, refusedBy: 'answer-mismatch', sha };
            return Object.assign({ sha }, answer);
        }

        get hidden() {
            return Boolean(this.snapshot);
        }

        /** Hide her clothing. Refuses, with Forge's reason, rather than show anything Forge did not allow. */
        async hideClothing() {
            if (!this._privateOn()) return { ok: false, why: 'private-off' };
            if (this.snapshot) return { ok: true, why: 'already-hidden' };
            const answer = await this.answerForStage();
            if (!answer.allowed) {
                const structure = answer.structure || {};
                return { ok: false, why: answer.refusedBy, limitation: structure.limitation || null };
            }
            // Re-check after the wait: Private may have been turned off, or she changed, meanwhile.
            const m = this._manager();
            if (!this._privateOn() || !m || !m.currentRoot) return { ok: false, why: 'stale' };
            const meshes = garmentMeshes(m.currentRoot, answer.hideMaterials);
            if (!meshes.length) return { ok: false, why: 'nothing-to-hide' };
            this.snapshot = hide(meshes);
            this.root = m.currentRoot;
            this.sha = answer.sha;
            this._save(answer.sha);
            return { ok: true, hidden: meshes.length };
        }

        /** Show her clothing again, exactly as it was. Safe to call at any time. */
        showClothing(reason) {
            const had = Boolean(this.snapshot);
            const m = this._manager();
            // A snapshot of an avatar no longer on stage is only dropped: her meshes went with her.
            if (this.snapshot && (!m || m.currentRoot === this.root)) restore(this.snapshot);
            this.snapshot = null;
            this.root = null;
            if (reason !== 'avatar-changed') this._save(null);
            return { ok: true, restored: had, reason: reason || 'asked' };
        }

        /** Re-apply a remembered choice for the same exact bytes, if Forge and Private still say yes. */
        async resume() {
            const saved = this._load();
            if (!saved || this.snapshot || !this._privateOn()) return { ok: false, why: 'nothing-saved' };
            const answer = await this.answerForStage();
            if (answer.sha !== saved || !answer.allowed) return { ok: false, why: 'not-this-file' };
            return this.hideClothing();
        }

        _save(sha) {
            try {
                if (sha) this.win.localStorage.setItem(STORAGE, sha);
                else this.win.localStorage.removeItem(STORAGE);
            } catch (_) {
                /* storage refused: the choice lasts until reload */
            }
        }

        _load() {
            try {
                return this.win.localStorage.getItem(STORAGE);
            } catch (_) {
                return null;
            }
        }

        /** The automatic restores: Private off, a General-only place, a different avatar. */
        attach() {
            const win = this.win;
            const spicy = win.NEXUS_SPICY;
            if (spicy && typeof spicy.onPreferenceChange === 'function')
                this._off.push(spicy.onPreferenceChange((on) => on || this.showClothing('private-off')));
            if (spicy && typeof spicy.onChange === 'function')
                this._off.push(spicy.onChange((usable) => usable || this.showClothing('private-off')));
            // The school's hand-off (GO1) decides what is General-only; read after it has, so its
            // world list is loaded: `shown` is the General-only world on screen, or null.
            const shown = () =>
                win.setTimeout(() => {
                    const places = win.__NEXUS_GENERAL_ONLY;
                    if (places && places.shown) this.showClothing('general-place');
                }, 0);
            win.addEventListener('nexus-world-shown', shown);
            this._off.push(() => win.removeEventListener('nexus-world-shown', shown));
            const timer = win.setInterval(() => {
                const m = this._manager();
                if (this.snapshot && m && m.currentRoot !== this.root) this.showClothing('avatar-changed');
            }, 1000);
            this._off.push(() => win.clearInterval(timer));
            return this;
        }

        detach() {
            for (const off of this._off.splice(0)) {
                try {
                    if (typeof off === 'function') off();
                } catch (_) {
                    /* already gone */
                }
            }
        }
    }

    const api = { ClothingVisibilityController, garmentMeshes, hide, restore, sha256, STORAGE };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) {
        global.NEXUS_CLOTHING_VISIBILITY = api;
        if (global.document && !(typeof module !== 'undefined' && module.exports)) {
            const start = () => {
                global.NEXUS_CLOTHING = new ClothingVisibilityController({ win: global }).attach();
            };
            if (global.document.readyState === 'loading')
                global.document.addEventListener('DOMContentLoaded', start, { once: true });
            else start();
        }
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
