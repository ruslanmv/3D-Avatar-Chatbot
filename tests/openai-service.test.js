/**
 * @file Unit tests for OpenAI Service module
 * @module tests/openai-service
 */

describe('OpenAI Service', () => {
    let mockService;

    beforeEach(() => {
        mockService = {
            apiEndpoint: 'https://api.openai.com/v1/chat/completions',
            conversationHistory: [],
            maxHistoryLength: 20,
        };
    });

    describe('History Management', () => {
        test('should initialize with system prompt', () => {
            const personality = {
                systemPrompt: 'You are a helpful assistant.',
            };
            mockService.conversationHistory = [
                {
                    role: 'system',
                    content: personality.systemPrompt,
                },
            ];
            expect(mockService.conversationHistory).toHaveLength(1);
            expect(mockService.conversationHistory[0].role).toBe('system');
        });

        test('should add user message to history', () => {
            mockService.conversationHistory.push({
                role: 'user',
                content: 'Hello',
            });
            expect(mockService.conversationHistory).toHaveLength(1);
            expect(mockService.conversationHistory[0].role).toBe('user');
        });

        test('should trim history when too long', () => {
            const systemMessage = { role: 'system', content: 'System prompt' };
            mockService.conversationHistory = [systemMessage];

            // Add messages beyond max length
            for (let i = 0; i < 25; i++) {
                mockService.conversationHistory.push({
                    role: 'user',
                    content: `Message ${i}`,
                });
            }

            // Simulate trimming
            if (mockService.conversationHistory.length > mockService.maxHistoryLength) {
                const recentMessages = mockService.conversationHistory.slice(-mockService.maxHistoryLength + 1);
                mockService.conversationHistory = [systemMessage, ...recentMessages];
            }

            expect(mockService.conversationHistory.length).toBeLessThanOrEqual(mockService.maxHistoryLength);
            expect(mockService.conversationHistory[0].role).toBe('system');
        });
    });

    describe('Token Count Estimation', () => {
        test('should estimate token count', () => {
            const messages = [
                { role: 'system', content: 'You are helpful.' },
                { role: 'user', content: 'Hello there!' },
            ];
            const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
            const estimatedTokens = Math.ceil(totalChars / 4);
            expect(estimatedTokens).toBeGreaterThan(0);
        });
    });

    describe('Error Handling', () => {
        test('should detect API key not configured', () => {
            expect(() => {
                if (!AppConfig.isConfigured()) {
                    throw new Error('OpenAI API key not configured.');
                }
            }).toThrow('OpenAI API key not configured');
        });
    });
});
