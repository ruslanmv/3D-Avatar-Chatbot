/**
 * @file Unit tests for AppConfig module
 * @module tests/config
 */

describe('AppConfig', () => {
    beforeEach(() => {
        // Clear localStorage before each test
        localStorage.clear();
        // Reset API key
        AppConfig.openai.apiKey = '';
    });

    describe('API Key Validation', () => {
        test('should validate correct API key format', () => {
            const validKey = 'sk-1234567890abcdefghijklmnop';
            expect(AppConfig.isValidApiKey(validKey)).toBe(true);
        });

        test('should reject invalid API key format', () => {
            expect(AppConfig.isValidApiKey('invalid-key')).toBe(false);
            expect(AppConfig.isValidApiKey('')).toBe(false);
            expect(AppConfig.isValidApiKey('sk-short')).toBe(false);
        });

        test('should save and retrieve API key', () => {
            const apiKey = 'sk-test1234567890abcdef';
            AppConfig.saveApiKey(apiKey);
            expect(localStorage.getItem('openai_api_key')).toBe(apiKey);
            expect(AppConfig.openai.apiKey).toBe(apiKey);
        });
    });

    describe('Personality Management', () => {
        test('should have all required personalities', () => {
            const required = ['friendly-kids', 'educational', 'professional', 'creative', 'storyteller', 'coach'];
            required.forEach((personality) => {
                expect(AppConfig.personalities[personality]).toBeDefined();
            });
        });

        test('should return current personality', () => {
            const personality = AppConfig.getCurrentPersonality();
            expect(personality).toBeDefined();
            expect(personality.name).toBeDefined();
            expect(personality.systemPrompt).toBeDefined();
        });

        test('should save personality preference', () => {
            AppConfig.savePersonality('professional');
            expect(localStorage.getItem('selected_personality')).toBe('professional');
        });
    });

    describe('Configuration State', () => {
        test('should be configured when valid API key is set', () => {
            AppConfig.saveApiKey('sk-validkey1234567890abcdef');
            expect(AppConfig.isConfigured()).toBe(true);
        });

        test('should not be configured without valid API key', () => {
            expect(AppConfig.isConfigured()).toBe(false);
        });
    });

    describe('Speech Settings', () => {
        test('should save speech settings', () => {
            const settings = {
                rate: 1.5,
                pitch: 1.2,
                autoSpeak: false,
            };
            AppConfig.saveSpeechSettings(settings);
            expect(AppConfig.speech.rate).toBe(1.5);
            expect(AppConfig.speech.pitch).toBe(1.2);
            expect(AppConfig.speech.autoSpeak).toBe(false);
        });
    });
});
