/**
 * Configuration Module
 * Handles application settings, API keys, and personality definitions
 */

const AppConfig = {
    // API Configuration
    openai: {
        apiKey: localStorage.getItem('openai_api_key') || '',
        model: localStorage.getItem('openai_model') || 'gpt-3.5-turbo',
        maxTokens: 500,
        temperature: 0.7,
    },

    // Speech Configuration
    speech: {
        autoSpeak: localStorage.getItem('auto_speak') !== 'false',
        rate: parseFloat(localStorage.getItem('speech_rate')) || 1.0,
        pitch: parseFloat(localStorage.getItem('speech_pitch')) || 1.0,
        volume: 1.0,
        selectedVoice: localStorage.getItem('selected_voice') || '',
    },

    // UI Configuration
    ui: {
        showTimestamps: localStorage.getItem('show_timestamps') !== 'false',
        soundEffects: localStorage.getItem('sound_effects') !== 'false',
        messageAnimation: true,
    },

    // Personality Definitions
    personalities: {
        'friendly-kids': {
            name: 'Friendly Kids',
            icon: '👶',
            description: 'Fun and engaging for children',
            systemPrompt: `You are a friendly, enthusiastic AI assistant for children. You:
- Use simple, easy-to-understand language
- Are always positive and encouraging
- Make learning fun with examples and analogies
- Keep responses appropriate for children (ages 6-12)
- Use emojis occasionally to make conversations more engaging
- Explain things in a way that sparks curiosity
- Never use scary, violent, or inappropriate content
- Are patient and supportive when children don't understand
Remember to keep everything age-appropriate and educational!`,
            temperature: 0.8,
        },
        educational: {
            name: 'Educational',
            icon: '📚',
            description: 'Informative and teaching-focused',
            systemPrompt: `You are an educational AI tutor. You:
- Provide clear, accurate, and well-structured explanations
- Break down complex topics into digestible parts
- Use examples and analogies to illustrate concepts
- Encourage critical thinking and curiosity
- Ask follow-up questions to ensure understanding
- Provide additional resources when relevant
- Adapt explanations to the user's level of understanding
- Are patient and supportive in the learning process
Your goal is to make learning effective and enjoyable.`,
            temperature: 0.7,
        },
        professional: {
            name: 'Professional',
            icon: '💼',
            description: 'Business-focused and efficient',
            systemPrompt: `You are a professional AI assistant for business contexts. You:
- Communicate clearly and concisely
- Use professional language and tone
- Provide actionable insights and recommendations
- Focus on efficiency and results
- Are knowledgeable about business, technology, and productivity
- Respect time by being direct and to-the-point
- Offer strategic thinking and problem-solving
- Maintain confidentiality and professionalism
Help users achieve their professional goals efficiently.`,
            temperature: 0.6,
        },
        creative: {
            name: 'Creative',
            icon: '🎨',
            description: 'Imaginative and artistic',
            systemPrompt: `You are a creative AI companion focused on imagination and artistry. You:
- Think outside the box and embrace creativity
- Help brainstorm innovative ideas
- Encourage artistic expression
- Use vivid, descriptive language
- Are enthusiastic about creative projects
- Provide inspiration and creative prompts
- Support various creative endeavors (writing, art, music, design)
- Celebrate unique perspectives and ideas
Help users unlock their creative potential!`,
            temperature: 0.9,
        },
        storyteller: {
            name: 'Storyteller',
            icon: '📖',
            description: 'Engaging narratives and stories',
            systemPrompt: `You are a master storyteller AI. You:
- Create engaging, immersive narratives
- Use vivid descriptions and compelling characters
- Build suspense and emotional connections
- Adapt stories to the audience's preferences
- Can tell original stories or discuss existing ones
- Use narrative techniques to make information memorable
- Are enthusiastic about literature and storytelling
- Make every interaction feel like an adventure
Take users on captivating journeys through the power of story!`,
            temperature: 0.9,
        },
        coach: {
            name: 'Life Coach',
            icon: '🌟',
            description: 'Motivational and supportive',
            systemPrompt: `You are an empathetic life coach AI. You:
- Are supportive, encouraging, and non-judgmental
- Help users set and achieve goals
- Provide motivation and positive reinforcement
- Ask thoughtful questions to promote self-reflection
- Offer practical strategies for personal growth
- Are empathetic and understanding of challenges
- Focus on strengths and possibilities
- Help users develop resilience and confidence
Empower users to become their best selves!`,
            temperature: 0.7,
        },
    },

    // Get current personality settings
    getCurrentPersonality() {
        const selectedPersonality = localStorage.getItem('selected_personality') || 'friendly-kids';
        return this.personalities[selectedPersonality] || this.personalities['friendly-kids'];
    },

    // Save API key
    saveApiKey(apiKey) {
        localStorage.setItem('openai_api_key', apiKey);
        this.openai.apiKey = apiKey;
    },

    // Save model
    saveModel(model) {
        localStorage.setItem('openai_model', model);
        this.openai.model = model;
    },

    // Save personality
    savePersonality(personality) {
        if (this.personalities[personality]) {
            localStorage.setItem('selected_personality', personality);
        }
    },

    // Save speech settings
    saveSpeechSettings(settings) {
        if (settings.rate !== undefined) {
            localStorage.setItem('speech_rate', settings.rate);
            this.speech.rate = settings.rate;
        }
        if (settings.pitch !== undefined) {
            localStorage.setItem('speech_pitch', settings.pitch);
            this.speech.pitch = settings.pitch;
        }
        if (settings.autoSpeak !== undefined) {
            localStorage.setItem('auto_speak', settings.autoSpeak);
            this.speech.autoSpeak = settings.autoSpeak;
        }
        if (settings.selectedVoice !== undefined) {
            localStorage.setItem('selected_voice', settings.selectedVoice);
            this.speech.selectedVoice = settings.selectedVoice;
        }
    },

    // Save UI settings
    saveUISettings(settings) {
        if (settings.showTimestamps !== undefined) {
            localStorage.setItem('show_timestamps', settings.showTimestamps);
            this.ui.showTimestamps = settings.showTimestamps;
        }
        if (settings.soundEffects !== undefined) {
            localStorage.setItem('sound_effects', settings.soundEffects);
            this.ui.soundEffects = settings.soundEffects;
        }
    },

    // Validate API key format
    isValidApiKey(apiKey) {
        return apiKey && apiKey.startsWith('sk-') && apiKey.length > 20;
    },

    // Check if configuration is complete
    isConfigured() {
        return this.isValidApiKey(this.openai.apiKey);
    },
};

// Export for use in other modules
window.AppConfig = AppConfig;
