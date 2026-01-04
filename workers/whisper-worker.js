/**
 * Whisper WASM Worker
 * Handles client-side speech-to-text using Whisper.cpp WASM
 */

let whisperInstance = null;
let modelLoaded = false;

/**
 * Load Whisper model
 * @param {string} modelSize - Model size ('tiny' | 'base' | 'small')
 * @param {string} modelPath - Base path to model files
 */
async function loadModel(modelSize, modelPath) {
    try {
        console.log(`[WhisperWorker] Loading ${modelSize} model from ${modelPath}...`);

        // In a real implementation, you would:
        // 1. Import whisper.cpp WASM module
        // 2. Load the model file (.bin)
        // 3. Initialize the whisper instance

        // For now, we'll simulate the loading
        // You would replace this with actual Whisper.cpp WASM loading:
        // importScripts(`${modelPath}/whisper.wasm.js`);
        // whisperInstance = await createWhisper(`${modelPath}/ggml-${modelSize}.bin`);

        // Simulate model loading time
        await new Promise((resolve) => setTimeout(resolve, 1000));

        modelLoaded = true;

        self.postMessage({
            type: 'model-loaded',
            modelSize,
        });
    } catch (error) {
        console.error('[WhisperWorker] Model load error:', error);
        self.postMessage({
            type: 'model-load-error',
            error: error.message,
        });
    }
}

/**
 * Transcribe audio
 * @param {Float32Array} audio - PCM audio data @ 16kHz mono
 * @param {string} language - Language code (e.g., 'en')
 */
async function transcribe(audio, language) {
    try {
        if (!modelLoaded || !whisperInstance) {
            throw new Error('Model not loaded');
        }

        console.log(`[WhisperWorker] Transcribing ${audio.length} samples (${audio.length / 16000}s)...`);

        // In a real implementation, you would:
        // const result = await whisperInstance.transcribe(audio, { language });
        // const transcript = result.text;

        // For now, we'll return a placeholder
        // This is where you'd call the actual Whisper.cpp WASM transcription
        const transcript = '[WASM Whisper not yet implemented - placeholder transcript]';

        // Simulate transcription time (roughly 0.1x real-time for tiny model)
        const duration = audio.length / 16000;
        await new Promise((resolve) => setTimeout(resolve, duration * 100));

        self.postMessage({
            type: 'transcription-complete',
            transcript,
        });
    } catch (error) {
        console.error('[WhisperWorker] Transcription error:', error);
        self.postMessage({
            type: 'transcription-error',
            error: error.message,
        });
    }
}

// Worker message handler
self.onmessage = async (event) => {
    const { type, modelSize, modelPath, audio, language } = event.data;

    switch (type) {
        case 'load-model':
            await loadModel(modelSize, modelPath);
            break;

        case 'transcribe':
            await transcribe(audio, language);
            break;

        default:
            console.warn('[WhisperWorker] Unknown message type:', type);
    }
};

console.log('[WhisperWorker] Worker initialized');

// ============================================================================
// INTEGRATION NOTES
// ============================================================================

/*
To integrate actual Whisper.cpp WASM:

1. Download Whisper.cpp WASM build:
   - whisper.wasm.js (WASM module loader)
   - whisper.wasm (WASM binary)
   - ggml-tiny.bin (39MB model)
   - ggml-base.bin (74MB model)
   - ggml-small.bin (244MB model)

2. Place in /models/whisper/ directory

3. Load in this worker:
   importScripts('/models/whisper/whisper.wasm.js');

4. Initialize Whisper:
   const whisper = await createWhisper();
   await whisper.loadModel(`/models/whisper/ggml-${modelSize}.bin`);

5. Transcribe:
   const result = await whisper.full({
       audio: pcmFloat32Array,
       language: languageCode,
       n_threads: 4,
       max_len: 0, // Auto-detect
       translate: false,
   });

   const transcript = result.map(segment => segment.text).join(' ');

6. Example Whisper.cpp WASM libraries:
   - whisper.wasm: https://github.com/ggerganov/whisper.cpp/tree/master/examples/wasm
   - whisper-turbo: https://github.com/FL33TW00D/whisper-turbo
   - transformers.js: https://github.com/xenova/transformers.js (alternative)

7. Transformers.js alternative (easier):
   importScripts('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.6.0');

   const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
   const result = await transcriber(pcmFloat32Array, { language: 'en' });
   const transcript = result.text;
*/
