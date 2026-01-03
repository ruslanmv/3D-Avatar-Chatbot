import * as THREE from '../../vendor/three-0.147.0/build/three.module.js';
import { OrbitControls } from '../../vendor/three-0.147.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from '../../vendor/three-0.147.0/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from '../../vendor/three-0.147.0/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from '../../vendor/three-0.147.0/examples/jsm/loaders/KTX2Loader.js';
import { RoomEnvironment } from '../../vendor/three-0.147.0/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from '../../vendor/three-0.147.0/examples/jsm/libs/meshopt_decoder.module.js';
import { VRSupport } from './VRSupport.js';
import { VRControllers } from './VRControllers.js';

export class ViewerEngine {
    constructor(containerEl) {
        this.containerEl = containerEl;

        this.scene = new THREE.Scene();
        this.clock = new THREE.Clock();

        const w = containerEl.clientWidth || window.innerWidth;
        const h = containerEl.clientHeight || window.innerHeight;

        this.camera = new THREE.PerspectiveCamera(35, w / h, 0.01, 100);
        this.camera.position.set(0, 1.4, 2.6);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: false,
        });

        // Quality defaults (viewer-like)
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(w, h);
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.physicallyCorrectLights = true;

        containerEl.innerHTML = '';
        containerEl.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.target.set(0, 1.0, 0);
        this.controls.update();

        // PMREM / IBL environment
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.scene.environment = env;

        // Soft fill (IBL does most of the work)
        const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.25);
        this.scene.add(hemi);

        this.mixer = null;
        this.clips = [];
        this.currentRoot = null;

        // Initialize GLTF loader with CORS support for Vercel production
        this.loader = new GLTFLoader();
        this.loader.setCrossOrigin('anonymous');

        // ✅ FIX: decoder files live under /examples/js/libs/draco/ (not jsm/)
        const draco = new DRACOLoader();
        draco.setDecoderPath('/vendor/three-0.147.0/examples/js/libs/draco/');
        this.loader.setDRACOLoader(draco);

        const ktx2 = new KTX2Loader();
        ktx2.setTranscoderPath('/vendor/three-0.147.0/examples/jsm/libs/basis/');
        ktx2.detectSupport(this.renderer);
        this.loader.setKTX2Loader(ktx2);

        this.loader.setMeshoptDecoder(MeshoptDecoder);

        // Initialize VR Support
        this.vrSupport = new VRSupport(this.renderer, this.camera, this.scene);

        // Initialize VR Controllers
        this.vrControllers = new VRControllers(this.renderer, this.scene, this.camera);

        // Link VR session events to controllers
        window.addEventListener('vr-session-start', () => {
            this.vrControllers.setEnabled(true);
        });

        window.addEventListener('vr-session-end', () => {
            this.vrControllers.setEnabled(false);
            this.vrControllers.resetPosition();
        });

        this._onResize = () => this.resize();
        window.addEventListener('resize', this._onResize);

        this._raf = null;
        this.animate();
    }

    resize() {
        const w = this.containerEl.clientWidth || window.innerWidth;
        const h = this.containerEl.clientHeight || window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    disposeCurrent() {
        if (!this.currentRoot) return;
        this.scene.remove(this.currentRoot);

        this.currentRoot.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose?.();
            if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach((m) => {
                    if (!m) return;
                    for (const k in m) {
                        const v = m[k];
                        if (v && v.isTexture) v.dispose?.();
                    }
                    m.dispose?.();
                });
            }
        });

        this.currentRoot = null;
        this.mixer = null;
        this.clips = [];
    }

    async loadAvatar(url) {
        this.disposeCurrent();

        const gltf = await new Promise((resolve, reject) => {
            this.loader.load(url, resolve, undefined, reject);
        });

        this.currentRoot = gltf.scene;
        this.scene.add(this.currentRoot);

        /* NEXUS_PATCH_LIFE_ENGINE_VIEWERENGINE_REGISTER */
        try {
            // ProceduralAnimator is a GLOBAL script (index.html loads it).
            // In module context we still can call window.*.
            window.NEXUS_PROCEDURAL_ANIMATOR?.registerAvatar?.(
                this.currentRoot,
                Array.isArray(this.clips) && this.clips.length > 0
            );
        } catch (_) {}
        this.currentRoot.traverse((o) => {
            if (o.isMesh) {
                o.castShadow = false;
                o.receiveShadow = false;
            }
        });

        this.clips = gltf.animations || [];
        if (this.clips.length) {
            this.mixer = new THREE.AnimationMixer(this.currentRoot);
            const action = this.mixer.clipAction(this.clips[0]);
            action.play();
        }

        this.frameToContent();
    }

    frameToContent() {
        if (!this.currentRoot) return;

        const box = new THREE.Box3().setFromObject(this.currentRoot);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z);
        const fitDist = maxDim / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
        const dist = fitDist * 1.35;

        const dir = new THREE.Vector3(0, 0.25, 1).normalize();
        this.camera.position.copy(center).add(dir.multiplyScalar(dist));
        this.controls.target.copy(center);
        this.controls.update();
    }

    playAnimationByName(name) {
        if (!this.mixer || !this.clips?.length) return false;
        const wanted = (name || '').toLowerCase();

        // exact then fuzzy
        let clip = this.clips.find((c) => (c.name || '').toLowerCase() === wanted);
        if (!clip) clip = this.clips.find((c) => (c.name || '').toLowerCase().includes(wanted));
        if (!clip) return false;

        this.mixer.stopAllAction();
        const action = this.mixer.clipAction(clip);
        action.reset();
        action.play();
        return true;
    }

    animate() {
        // Use setAnimationLoop for VR compatibility (works in both VR and desktop mode)
        this.renderer.setAnimationLoop(() => {
            const dt = this.clock.getDelta();

            /* NEXUS_PATCH_LIFE_ENGINE_VIEWERENGINE_UPDATE */
            try {
                const t = this.clock.getElapsedTime();
                window.NEXUS_PROCEDURAL_ANIMATOR?.update?.(t, dt);
            } catch (_) {}
            this.mixer?.update(dt);

            // Update VR controllers with delta-time (handles input, interaction, and locomotion)
            this.vrControllers.update(dt);

            // Only update controls in desktop mode
            if (!this.renderer.xr.isPresenting) {
                this.controls.update();
            }

            this.renderer.render(this.scene, this.camera);
        });
    }
}
