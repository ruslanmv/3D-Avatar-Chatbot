/**
 * @file Jest test setup and global configuration
 * @module tests/setup
 */

// Mock localStorage
const localStorageMock = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
};

global.localStorage = localStorageMock;

// Mock AppConfig
global.AppConfig = {
    openai: {
        apiKey: '',
        model: 'gpt-3.5-turbo',
        maxTokens: 500,
        temperature: 0.7,
    },
    speech: {
        autoSpeak: true,
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
        selectedVoice: '',
    },
    ui: {
        showTimestamps: true,
        soundEffects: true,
        messageAnimation: true,
    },
    personalities: {
        'friendly-kids': {
            name: 'Friendly Kids',
            icon: '👶',
            description: 'Fun and engaging for children',
            systemPrompt: 'You are a friendly assistant for children.',
            temperature: 0.8,
        },
        educational: {
            name: 'Educational',
            icon: '📚',
            description: 'Informative and teaching-focused',
            systemPrompt: 'You are an educational tutor.',
            temperature: 0.7,
        },
        professional: {
            name: 'Professional',
            icon: '💼',
            description: 'Business-focused and efficient',
            systemPrompt: 'You are a professional assistant.',
            temperature: 0.6,
        },
        creative: {
            name: 'Creative',
            icon: '🎨',
            description: 'Imaginative and artistic',
            systemPrompt: 'You are a creative companion.',
            temperature: 0.9,
        },
        storyteller: {
            name: 'Storyteller',
            icon: '📖',
            description: 'Engaging narratives',
            systemPrompt: 'You are a master storyteller.',
            temperature: 0.9,
        },
        coach: {
            name: 'Life Coach',
            icon: '🌟',
            description: 'Motivational and supportive',
            systemPrompt: 'You are an empathetic life coach.',
            temperature: 0.7,
        },
    },
    getCurrentPersonality: jest.fn(() => AppConfig.personalities['friendly-kids']),
    saveApiKey: jest.fn((key) => {
        AppConfig.openai.apiKey = key;
        localStorage.setItem('openai_api_key', key);
    }),
    saveModel: jest.fn((model) => {
        AppConfig.openai.model = model;
        localStorage.setItem('openai_model', model);
    }),
    savePersonality: jest.fn((personality) => {
        if (AppConfig.personalities[personality]) {
            localStorage.setItem('selected_personality', personality);
        }
    }),
    saveSpeechSettings: jest.fn((settings) => {
        if (settings.rate !== undefined) {
            AppConfig.speech.rate = settings.rate;
        }
        if (settings.pitch !== undefined) {
            AppConfig.speech.pitch = settings.pitch;
        }
        if (settings.autoSpeak !== undefined) {
            AppConfig.speech.autoSpeak = settings.autoSpeak;
        }
    }),
    saveUISettings: jest.fn(),
    isValidApiKey: jest.fn((key) => {
        return !!(key && key.startsWith('sk-') && key.length > 20);
    }),
    isConfigured: jest.fn(() => {
        return AppConfig.isValidApiKey(AppConfig.openai.apiKey);
    }),
};
