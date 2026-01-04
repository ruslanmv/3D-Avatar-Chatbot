/**
 * Speech Service Tests
 * Tests for voice-to-text and text-to-speech functionality
 */

describe('SpeechService', () => {
    let speechService;
    let mockRecognition;
    let mockSynthesis;

    beforeEach(() => {
        // Mock Web Speech API
        mockRecognition = {
            continuous: false,
            interimResults: false,
            lang: 'en-US',
            maxAlternatives: 1,
            start: jest.fn(),
            stop: jest.fn(),
            onstart: null,
            onresult: null,
            onerror: null,
            onend: null,
        };

        mockSynthesis = {
            speak: jest.fn(),
            cancel: jest.fn(),
            pause: jest.fn(),
            resume: jest.fn(),
            getVoices: jest.fn(() => []),
            speaking: false,
            paused: false,
            pending: false,
        };

        // Mock window.SpeechRecognition
        global.window = {
            SpeechRecognition: jest.fn(() => mockRecognition),
            webkitSpeechRecognition: jest.fn(() => mockRecognition),
            speechSynthesis: mockSynthesis,
        };

        global.navigator = {
            mediaDevices: {
                getUserMedia: jest.fn(() =>
                    Promise.resolve({
                        getTracks: () => [{ stop: jest.fn() }],
                    })
                ),
            },
        };

        // Create a fresh SpeechService instance
        const SpeechServiceClass = require('../js/speech-service.js');
        speechService = new SpeechServiceClass();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Recognition Support', () => {
        test('should detect if speech recognition is supported', () => {
            expect(speechService.isRecognitionAvailable()).toBe(true);
        });

        test('should detect if speech recognition is not supported', () => {
            global.window.SpeechRecognition = null;
            global.window.webkitSpeechRecognition = null;

            const SpeechServiceClass = require('../js/speech-service.js');
            const unsupportedService = new SpeechServiceClass();

            expect(unsupportedService.isRecognitionAvailable()).toBe(false);
        });
    });

    describe('Microphone Permission', () => {
        test('should request microphone permission', async () => {
            const granted = await speechService.requestMicrophonePermission();
            expect(granted).toBe(true);
            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
            expect(speechService.hasMicrophonePermission()).toBe(true);
        });

        test('should handle microphone permission denial', async () => {
            navigator.mediaDevices.getUserMedia.mockRejectedValue(new Error('Permission denied'));

            const granted = await speechService.requestMicrophonePermission();
            expect(granted).toBe(false);
            expect(speechService.hasMicrophonePermission()).toBe(false);
        });

        test('should not request permission if already granted', async () => {
            await speechService.requestMicrophonePermission();
            jest.clearAllMocks();

            await speechService.requestMicrophonePermission();
            expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
        });
    });

    describe('Speech Recognition', () => {
        test('should start recognition successfully', async () => {
            const result = await speechService.startRecognition({
                onStart: jest.fn(),
                onResult: jest.fn(),
                onError: jest.fn(),
            });

            expect(result).toBe(true);
            expect(mockRecognition.start).toHaveBeenCalled();
        });

        test('should call onStart callback when recognition starts', async () => {
            const onStart = jest.fn();
            await speechService.startRecognition({ onStart });

            // Simulate recognition start
            mockRecognition.onstart();

            expect(onStart).toHaveBeenCalled();
            expect(speechService.isRecognizing).toBe(true);
        });

        test('should call onResult callback with transcription', async () => {
            const onResult = jest.fn();
            await speechService.startRecognition({ onResult });

            // Simulate recognition result
            const mockEvent = {
                resultIndex: 0,
                results: [
                    {
                        0: { transcript: 'hello world', confidence: 0.95 },
                        isFinal: true,
                    },
                ],
            };

            mockRecognition.onresult(mockEvent);

            expect(onResult).toHaveBeenCalledWith('hello world', 0.95);
        });

        test('should call onInterim callback for interim results', async () => {
            const onInterim = jest.fn();
            await speechService.startRecognition({ onInterim });

            // Simulate interim result
            const mockEvent = {
                resultIndex: 0,
                results: [
                    {
                        0: { transcript: 'hello', confidence: 0.8 },
                        isFinal: false,
                    },
                ],
            };

            mockRecognition.onresult(mockEvent);

            expect(onInterim).toHaveBeenCalledWith('hello');
        });

        test('should handle recognition errors', async () => {
            const onError = jest.fn();
            await speechService.startRecognition({ onError });

            // Simulate error
            mockRecognition.onerror({ error: 'no-speech' });

            expect(onError).toHaveBeenCalledWith(
                'No speech detected. Please try again.',
                expect.any(String)
            );
        });

        test('should handle microphone permission error', async () => {
            const onError = jest.fn();
            await speechService.startRecognition({ onError });

            // Simulate permission denied error
            mockRecognition.onerror({ error: 'not-allowed' });

            expect(onError).toHaveBeenCalledWith(
                'Microphone access denied.',
                'Please allow microphone access in your browser settings.'
            );
            expect(speechService.hasMicrophonePermission()).toBe(false);
        });

        test('should stop recognition', async () => {
            await speechService.startRecognition({});
            speechService.stopRecognition();

            expect(mockRecognition.stop).toHaveBeenCalled();
        });

        test('should not start if already recognizing', async () => {
            await speechService.startRecognition({});
            mockRecognition.start.mockClear();

            const result = await speechService.startRecognition({});

            expect(result).toBe(false);
            expect(mockRecognition.start).not.toHaveBeenCalled();
        });
    });

    describe('Recognition Options', () => {
        test('should apply default recognition options', () => {
            expect(mockRecognition.interimResults).toBe(true);
            expect(mockRecognition.lang).toBe('en-US');
            expect(mockRecognition.maxAlternatives).toBe(1);
        });

        test('should update recognition options', () => {
            speechService.setRecognitionOptions({
                lang: 'es-ES',
                continuous: true,
            });

            expect(mockRecognition.lang).toBe('es-ES');
            expect(mockRecognition.continuous).toBe(true);
        });

        test('should merge options with existing ones', () => {
            speechService.setRecognitionOptions({ lang: 'fr-FR' });

            expect(mockRecognition.lang).toBe('fr-FR');
            expect(mockRecognition.interimResults).toBe(true); // unchanged
        });
    });

    describe('Speech Synthesis', () => {
        test('should detect if synthesis is supported', () => {
            expect(speechService.isSynthesisAvailable()).toBe(true);
        });

        test('should speak text', () => {
            const result = speechService.speak('Hello world', {
                onStart: jest.fn(),
                onEnd: jest.fn(),
            });

            expect(result).toBe(true);
            expect(mockSynthesis.speak).toHaveBeenCalled();
        });

        test('should stop speaking', () => {
            speechService.speak('Hello');
            speechService.stopSpeaking();

            expect(mockSynthesis.cancel).toHaveBeenCalled();
        });

        test('should check if currently speaking', () => {
            mockSynthesis.speaking = true;
            expect(speechService.isSpeakingNow()).toBe(true);

            mockSynthesis.speaking = false;
            expect(speechService.isSpeakingNow()).toBe(false);
        });
    });

    describe('Feature Detection', () => {
        test('should return supported features', () => {
            const features = speechService.getFeatures();

            expect(features).toEqual({
                recognition: true,
                synthesis: true,
                voiceCount: 0,
            });
        });

        test('should test capabilities', async () => {
            const results = await speechService.testCapabilities();

            expect(results.recognition).toBe(true);
            expect(results.synthesis).toBe(true);
            expect(results.error).toBeNull();
        });
    });
});
