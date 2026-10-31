/**
 * Clear the __THREE__ marker set by three.min.js so three.module.js (loaded by the ES modules after
 * it) does not print "WARNING: Multiple instances of Three.js being imported." Both are r147 on
 * purpose: the global copy serves the classic defer scripts, the module copy the engine and
 * three-vrm — her scene and every VRM material are built from the module copy, so the two never
 * mix in rendering.
 *
 * XL4. This used to be an inline `<script defer>` in index.html. `defer` does nothing on an inline
 * script: it ran during parsing, before three.min.js had set the marker, so the warning it exists
 * to silence printed on every load — and read like a cause when VR entry froze over Quest Link.
 * As an external deferred file it runs where the comment always said: after three.min.js, before
 * the module scripts.
 */
(function () {
    'use strict';
    if (typeof window !== 'undefined' && window.__THREE__) {
        window.__THREE_REVISION_BACKUP__ = window.__THREE__;
        delete window.__THREE__;
    }
})();
