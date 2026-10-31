/**
 * QuestWhisperConfig — ST1. Which Whisper, from where, pinned.
 *
 * On-device speech recognition downloads two things once: the Transformers.js runtime (with
 * its ONNX Runtime WebAssembly) and the model's weights. Both are pinned here — the runtime to
 * an exact npm version, each model to an exact Hugging Face commit — so the files a headset
 * caches today are the files it is given next month, and a model update upstream cannot change
 * what she hears without a change in this repository.
 *
 * Tiny is the default: ~41 MB, multilingual (English and Italian, and the rest of Whisper's
 * languages), and the size a Quest 3 can run while it also renders VR. Base is offered for
 * better accuracy at about twice the download and the time; Small (~250 MB) is for a desktop.
 * The `.en` models are deliberately absent: they cannot hear Italian.
 *
 * A site can host every file itself (an offline install, or no third-party CDN) by setting,
 * before the page's scripts run:
 *
 *   window.NEXUS_STT_CONFIG = {
 *       runtimeUrl: '/vendor/transformers/transformers.min.js', // the pinned ESM build
 *       wasmPaths: '/vendor/transformers/',                      // its ort-wasm*.wasm files
 *       localModelPath: '/models/',                              // models/onnx-community/whisper-tiny/…
 *   };
 *
 * `tools/stt/fetch-whisper-assets.mjs` downloads exactly those files, with their hashes. With
 * `localModelPath` set, remote model loading is switched off in the worker.
 *
 * Licences: Whisper's weights (OpenAI) and their ONNX conversion are MIT; Transformers.js is
 * Apache-2.0; ONNX Runtime Web is MIT. All compatible with this repository's Apache-2.0.
 */
(function (global) {
    'use strict';

    const RUNTIME_VERSION = '3.8.1';

    const MODELS = Object.freeze({
        tiny: Object.freeze({
            id: 'onnx-community/whisper-tiny',
            revision: 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7',
            downloadMB: 41,
            label: 'Tiny — fastest, multilingual (~41 MB)',
            files: Object.freeze({
                'onnx/encoder_model_quantized.onnx': '2af4a414ca47aa30f61246017e5fe82b0a8d229281d1255ba666a2a7f6b84d19',
                'onnx/decoder_model_merged_quantized.onnx':
                    '25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3',
            }),
        }),
        base: Object.freeze({
            id: 'onnx-community/whisper-base',
            revision: '1846881b6b3a3024392c1eea3ad983695bc23925',
            downloadMB: 77,
            label: 'Base — more accurate, ~2× slower (~77 MB)',
            files: Object.freeze({
                'onnx/encoder_model_quantized.onnx': '5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46',
                'onnx/decoder_model_merged_quantized.onnx':
                    'fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b',
            }),
        }),
        small: Object.freeze({
            id: 'onnx-community/whisper-small',
            revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732',
            downloadMB: 249,
            label: 'Small — desktop only (~250 MB)',
            files: Object.freeze({
                'onnx/encoder_model_quantized.onnx': 'a43a83f3c5361cd591cfa7c36f14b43cf7cb22f47a415cc14a8d557be800fa92',
                'onnx/decoder_model_merged_quantized.onnx':
                    'ec07c3cbb64172c39791e26ee870a65ac22b458c36722bfe2776b3dbf741e0c9',
            }),
        }),
    });

    // The config files the pipeline also reads (small, JSON). Listed so the asset tool can host them.
    const MODEL_JSON = Object.freeze([
        'config.json',
        'generation_config.json',
        'preprocessor_config.json',
        'tokenizer.json',
        'tokenizer_config.json',
    ]);

    const DEFAULTS = Object.freeze({
        model: 'tiny',
        runtimeUrl: `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${RUNTIME_VERSION}/dist/transformers.min.js`,
        wasmPaths: null, // null: the runtime's own pinned default (jsDelivr, same version)
        localModelPath: null, // null: the pinned Hugging Face revision
        dtype: 'q8', // the *_quantized.onnx files listed above
        device: 'wasm',
        loadTimeoutMs: 180000, // a 41 MB download on a slow Wi-Fi, then session creation
        transcribeTimeoutMs: 60000, // longer than any honest inference of ≤ 30 s of speech
        maxRecordMs: 30000,
    });

    function modelFor(size) {
        return MODELS[size] || MODELS[DEFAULTS.model];
    }

    /**
     * The configuration in force: defaults, then the page's NEXUS_STT_CONFIG, then the model
     * size the person chose. Unknown keys are dropped; a bad model size falls back to Tiny.
     */
    function resolve(siteConfig, chosenSize) {
        const site = siteConfig && typeof siteConfig === 'object' ? siteConfig : {};
        const out = {};
        for (const k of Object.keys(DEFAULTS)) out[k] = site[k] !== undefined ? site[k] : DEFAULTS[k];
        const size = MODELS[chosenSize] ? chosenSize : MODELS[site.model] ? site.model : DEFAULTS.model;
        const m = modelFor(size);
        out.model = size;
        out.modelId = m.id;
        out.revision = m.revision;
        out.downloadMB = m.downloadMB;
        return out;
    }

    const api = { RUNTIME_VERSION, MODELS, MODEL_JSON, DEFAULTS, modelFor, resolve };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_WHISPER_CONFIG = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
