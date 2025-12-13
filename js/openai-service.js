/**
 * OpenAI Service Module
 * Handles all interactions with the OpenAI API
 */

class OpenAIService {
    constructor() {
        this.apiEndpoint = 'https://api.openai.com/v1/chat/completions';
        this.conversationHistory = [];
        this.maxHistoryLength = 20; // Keep last 20 messages for context
    }

    /**
     * Initialize the service with system prompt based on personality
     * @param personality
     */
    initialize(personality) {
        this.conversationHistory = [
            {
                role: 'system',
                content: personality.systemPrompt,
            },
        ];
    }

    /**
     * Send a message to OpenAI and get a response
     * @param {string} message - User's message
     * @returns {Promise<string>} - AI response
     */
    async sendMessage(message) {
        if (!AppConfig.isConfigured()) {
            throw new Error('OpenAI API key not configured. Please add your API key in settings.');
        }

        // Add user message to history
        this.conversationHistory.push({
            role: 'user',
            content: message,
        });

        // Trim history if too long (keep system message + recent messages)
        if (this.conversationHistory.length > this.maxHistoryLength) {
            const systemMessage = this.conversationHistory[0];
            const recentMessages = this.conversationHistory.slice(-this.maxHistoryLength + 1);
            this.conversationHistory = [systemMessage, ...recentMessages];
        }

        try {
            const response = await this.makeAPIRequest();
            const assistantMessage = response.choices[0].message.content;

            // Add assistant's response to history
            this.conversationHistory.push({
                role: 'assistant',
                content: assistantMessage,
            });

            return assistantMessage;
        } catch (error) {
            console.error('OpenAI API Error:', error);

            // Remove the user message if request failed
            this.conversationHistory.pop();

            // Provide user-friendly error messages
            if (error.message.includes('401')) {
                throw new Error('Invalid API key. Please check your OpenAI API key in settings.');
            } else if (error.message.includes('429')) {
                throw new Error('Rate limit exceeded. Please wait a moment and try again.');
            } else if (error.message.includes('quota')) {
                throw new Error('API quota exceeded. Please check your OpenAI account.');
            } else if (error.message.includes('network') || error.message.includes('fetch')) {
                throw new Error('Network error. Please check your internet connection.');
            } else {
                throw new Error(`Failed to get response: ${error.message}`);
            }
        }
    }

    /**
     * Make the actual API request to OpenAI
     * @returns {Promise<object>} - API response
     */
    async makeAPIRequest() {
        const personality = AppConfig.getCurrentPersonality();
        const temperature = personality.temperature || AppConfig.openai.temperature;

        const requestBody = {
            model: AppConfig.openai.model,
            messages: this.conversationHistory,
            max_tokens: AppConfig.openai.maxTokens,
            temperature,
        };

        const response = await fetch(this.apiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${AppConfig.openai.apiKey}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Clear conversation history while keeping system prompt
     */
    clearHistory() {
        const systemMessage = this.conversationHistory[0];
        this.conversationHistory = [systemMessage];
    }

    /**
     * Change personality and reinitialize
     * @param personality
     */
    changePersonality(personality) {
        const systemMessage = {
            role: 'system',
            content: personality.systemPrompt,
        };

        // Keep recent conversation but update system prompt
        if (this.conversationHistory.length > 1) {
            this.conversationHistory[0] = systemMessage;
        } else {
            this.conversationHistory = [systemMessage];
        }
    }

    /**
     * Get conversation history (excluding system message)
     */
    getHistory() {
        return this.conversationHistory.slice(1);
    }

    /**
     * Export conversation history as JSON
     */
    exportHistory() {
        return JSON.stringify(this.conversationHistory, null, 2);
    }

    /**
     * Import conversation history from JSON
     * @param jsonString
     */
    importHistory(jsonString) {
        try {
            const history = JSON.parse(jsonString);
            if (Array.isArray(history) && history.length > 0) {
                this.conversationHistory = history;
                return true;
            }
            return false;
        } catch (error) {
            console.error('Failed to import history:', error);
            return false;
        }
    }

    /**
     * Get token count estimate (rough approximation)
     */
    getTokenCount() {
        // Rough estimate: 1 token ≈ 4 characters
        const totalChars = this.conversationHistory.reduce((sum, msg) => {
            return sum + msg.content.length;
        }, 0);
        return Math.ceil(totalChars / 4);
    }

    /**
     * Check if we're approaching token limits
     */
    isNearTokenLimit() {
        const tokenCount = this.getTokenCount();
        const modelLimits = {
            'gpt-4': 8000,
            'gpt-4-turbo-preview': 128000,
            'gpt-3.5-turbo': 4000,
        };
        const limit = modelLimits[AppConfig.openai.model] || 4000;
        return tokenCount > limit * 0.7; // 70% of limit
    }
}

// Create a singleton instance
const openAIService = new OpenAIService();

// Export for use in other modules
window.OpenAIService = openAIService;
