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
        // ST17. Moonshine (Useful Sensors, MIT): reads the audio's own length instead of a padded
        // 30-second window, so a 2-5 s command costs a fraction of Whisper's fixed encoder pass.
        // The first Quest 3 report measured Whisper Tiny at 8.3 s inference for 4.1 s of speech
        // (RTF 2.0, one WASM thread); on this repo's test machine Moonshine Tiny transcribed the
        // same English phrases exactly in 0.24-0.48 s against Whisper Tiny's 2.05-2.29 s. English
        // only: on Italian it writes nonsense ("Chao, come stayagi"), so it is never used for a
        // language it does not list — see pickModel.
        'moonshine-tiny': Object.freeze({
            id: 'onnx-community/moonshine-tiny-ONNX',
            revision: 'a6da1241cd305dcd64eab1edbd615f2bb9aabb95',
            downloadMB: 28,
            family: 'moonshine',
            languages: Object.freeze(['en']),
            label: 'Moonshine Tiny — English only, fastest (~28 MB)',
            files: Object.freeze({
                'onnx/encoder_model_quantized.onnx': 'c6fc4b7bc5af75c0591fd157a1f3829b533d18e9769a888fd95a62e470dd4f4a',
                'onnx/decoder_model_merged_quantized.onnx':
                    'eed87831c3a6103534aae7d47a5d485025c659a1323901513961c39fe8a1a367',
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
        // ST16. Decoding budget per utterance. 128 is the measured-safe default (a runaway decode
        // took 35 s before any cap); lower values are for the benchmark, not a tuned setting.
        maxNewTokens: 128,
    });

    function modelFor(size) {
        return MODELS[size] || MODELS[DEFAULTS.model];
    }

    /** The model's family: 'whisper' (multilingual, 30 s window) unless it says otherwise. */
    function familyOf(size) {
        return (MODELS[size] && MODELS[size].family) || 'whisper';
    }

    /** Can this model hear this language? Whisper: every language; Moonshine: the ones it lists. */
    function speaks(size, language) {
        const m = MODELS[size];
        if (!m) return false;
        if (!m.languages) return true;
        const lang = String(language || '')
            .toLowerCase()
            .split(/[-_]/)[0];
        return m.languages.includes(lang);
    }

    /**
     * ST17. Which model to run for a choice and a language. 'auto' (the default for a new
     * install): Moonshine Tiny for English, Whisper Tiny for every other language — or when the
     * language is not known, since Whisper hears them all. An explicit choice is honoured unless
     * that model cannot hear the language (Moonshine with Italian): then Whisper Tiny, and the
     * reason is returned so Settings can say so. Pure.
     */
    function pickModel(choice, language) {
        const lang = String(language || '')
            .toLowerCase()
            .split(/[-_]/)[0];
        if (MODELS[choice]) {
            if (speaks(choice, lang)) return { model: choice, reason: 'chosen' };
            return { model: 'tiny', reason: 'language-not-supported', wanted: choice };
        }
        if (lang && speaks('moonshine-tiny', lang)) return { model: 'moonshine-tiny', reason: 'auto' };
        return { model: 'tiny', reason: 'auto' };
    }

    /**
     * The configuration in force: defaults, then the page's NEXUS_STT_CONFIG, then the model
     * size the person chose. Unknown keys are dropped; a bad model size falls back to Tiny.
     */
    function resolve(siteConfig, chosenSize, language) {
        const site = siteConfig && typeof siteConfig === 'object' ? siteConfig : {};
        const out = {};
        for (const k of Object.keys(DEFAULTS)) out[k] = site[k] !== undefined ? site[k] : DEFAULTS[k];
        const choice =
            MODELS[chosenSize] || chosenSize === 'auto' ? chosenSize : MODELS[site.model] ? site.model : 'auto';
        const pick = pickModel(choice, language);
        const size = pick.model;
        const m = modelFor(size);
        out.choice = choice;
        out.pickReason = pick.reason;
        out.family = familyOf(size);
        out.model = size;
        out.modelId = m.id;
        out.revision = m.revision;
        out.downloadMB = m.downloadMB;
        return out;
    }

    const api = { RUNTIME_VERSION, MODELS, MODEL_JSON, DEFAULTS, modelFor, familyOf, speaks, pickModel, resolve };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.NEXUS_WHISPER_CONFIG = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
