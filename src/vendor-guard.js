// src/vendor-guard.js
(() => {
    const text = document.getElementById('loading-text');

    function fail(msg) {
        if (text) text.textContent = msg;
        console.error(msg);
    }

    if (!window.THREE) {
        return fail('Initialization failed: THREE missing. Check vendor/three-0.147.0/build/three.min.js');
    }

    // Legacy GLOBAL scripts attach to THREE.*
    if (!window.THREE.GLTFLoader) {
        return fail(
            'Initialization failed: THREE.GLTFLoader missing. Check vendor/three-0.147.0/examples/js/loaders/GLTFLoader.js'
        );
    }

    if (!window.THREE.OrbitControls) {
        return fail(
            'Initialization failed: THREE.OrbitControls missing. Check vendor/three-0.147.0/examples/js/controls/OrbitControls.js'
        );
    }

    // Expose aliases if main.js expects window.*
    window.GLTFLoader = window.THREE.GLTFLoader;
    window.OrbitControls = window.THREE.OrbitControls;
})();
