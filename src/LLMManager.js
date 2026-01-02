/**
 * LLMManager.js
 * Unified AI Provider Controller for Nexus Avatar
 *
 * Manages:
 * - Multiple LLM providers (OpenAI, Claude, Watsonx, Ollama)
 * - Settings persistence (localStorage)
 * - API communication
 * - Dynamic model fetching
 *
 * Architecture: Global namespace (no ES6 modules)
 * Usage: Access via window.LLMManager
 */

'use strict';

(function (global) {
    /**
     * LLM Provider Constants
     */
    const LLMProvider = {
        NONE: 'none',
        OPENAI: 'openai',
        CLAUDE: 'claude',
        WATSONX: 'watsonx',
        OLLAMA: 'ollama',
    };

    const STORAGE_KEY = 'nexus_llm_settings';

    /**
     * LLMManager Class
     * Handles all LLM provider operations
     */
    class LLMManager {
        constructor() {
            this._settings = this._loadSettings();
            this._watsonxTokenCache = null; // Cache for Watsonx IAM token
            this._watsonxTokenExpiry = 0;
            console.log('[LLMManager] Initialized with provider:', this._settings.provider);
        }

        /**
         * Get current settings (safe copy)
         * @returns {object} Current settings
         */
        getSettings() {
            return JSON.parse(JSON.stringify(this._settings));
        }

        /**
         * Update settings and persist to localStorage
         * @param {object} updates - Settings to update
         * @returns {object} Updated settings
         */
        updateSettings(updates) {
            const current = this.getSettings();
            const merged = this._deepMerge(current, updates);

            // Validate provider
            if (merged.provider && !Object.values(LLMProvider).includes(merged.provider)) {
                console.warn(`[LLMManager] Invalid provider ${merged.provider}, defaulting to none`);
                merged.provider = LLMProvider.NONE;
            }

            this._settings = merged;
            this._saveSettings();
            console.log('[LLMManager] Settings updated:', merged.provider);
            return this.getSettings();
        }

        /**
         * Main API Router: Send message to active provider
         * @param {string} userMessage - User's input text
         * @param {string} systemPrompt - System/persona prompt (optional)
         * @returns {Promise<string>} AI response
         */
        async sendMessage(userMessage, systemPrompt) {
            const cfg = this._settings;
            const provider = cfg.provider;

            console.log(`[LLMManager] Sending message to ${provider}`);

            if (provider === LLMProvider.NONE) {
                return this._getSimpleResponse(userMessage);
            }

            if (provider === LLMProvider.OPENAI) {
                return await this._chatOpenAI(userMessage, systemPrompt);
            }

            if (provider === LLMProvider.CLAUDE) {
                return await this._chatClaude(userMessage, systemPrompt);
            }

            if (provider === LLMProvider.WATSONX) {
                return await this._chatWatsonx(userMessage, systemPrompt);
            }

            if (provider === LLMProvider.OLLAMA) {
                return await this._chatOllama(userMessage, systemPrompt);
            }

            throw new Error(`Provider ${provider} is not implemented.`);
        }

        /**
         * Fetch available models from active provider
         * @returns {Promise<{models: string[], error: string|null}>}
         */
        async fetchAvailableModels() {
            const provider = this._settings.provider;
            console.log(`[LLMManager] Fetching models for ${provider}`);

            try {
                if (provider === LLMProvider.NONE) {
                    return { models: [], error: null };
                }
                if (provider === LLMProvider.OPENAI) {
                    return await this._fetchOpenAIModels();
                }
                if (provider === LLMProvider.CLAUDE) {
                    return await this._fetchClaudeModels();
                }
                if (provider === LLMProvider.WATSONX) {
                    return await this._fetchWatsonxModels();
                }
                if (provider === LLMProvider.OLLAMA) {
                    return await this._fetchOllamaModels();
                }
                return { models: [], error: `Unknown provider: ${provider}` };
            } catch (e) {
                console.error('[LLMManager] Error fetching models:', e);
                return { models: [], error: e.message };
            }
        }

        // ===============================================
        // Proxy Support
        // ===============================================

        /**
         * Check if proxy is enabled and configured
         * @returns {boolean}
         */
        _hasProxy() {
            const { enable_proxy, proxy_url } = this._settings.proxy || {};
            return enable_proxy === true && typeof proxy_url === 'string' && proxy_url.trim().length > 0;
        }

        /**
         * Get proxy base URL
         * @returns {string}
         */
        _proxyBase() {
            return (this._settings.proxy?.proxy_url || 'http://localhost:8080').replace(/\/$/, '');
        }

        /**
         * Send request through proxy server
         * @param {string} url - Target API URL
         * @param {string} method - HTTP method
         * @param {object} headers - Request headers
         * @param {object|string} body - Request body
         * @returns {Promise<Response>}
         */
        async _fetchViaProxy(url, method, headers, body) {
            const proxyUrl = `${this._proxyBase()}/proxy`;

            console.log(`[LLMManager] Proxying ${method} request to ${url}`);

            const response = await fetch(proxyUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    method,
                    headers,
                    body,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Proxy error (${response.status}): ${errorText}`);
            }

            // Return a Response-like object that matches fetch API
            const text = await response.text();
            return {
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                text: async () => text,
                json: async () => JSON.parse(text),
            };
        }

        /**
         * Get or refresh Watsonx IAM token
         * @returns {Promise<string>} Bearer token
         */
        async _getWatsonxToken() {
            const { api_key } = this._settings.watsonx;

            // If token is cached and not expired, use it
            const now = Date.now();
            if (this._watsonxTokenCache && now < this._watsonxTokenExpiry) {
                console.log('[LLMManager] Using cached Watsonx token');
                return this._watsonxTokenCache;
            }

            // Token format check: if it already starts with "Bearer ", extract the token
            let cleanApiKey = api_key;
            if (api_key.startsWith('Bearer ')) {
                cleanApiKey = api_key.substring(7);
            }

            // If the api_key looks like a raw IAM token, cache it
            // (Real IAM tokens are JWTs, typically very long)
            if (cleanApiKey.length > 100) {
                console.log('[LLMManager] Caching Watsonx IAM token');
                this._watsonxTokenCache = cleanApiKey;
                // Watsonx tokens typically expire in 1 hour, cache for 50 minutes
                this._watsonxTokenExpiry = now + 50 * 60 * 1000;
                return cleanApiKey;
            }

            // If we have a shorter key, it might be an API key that needs exchange
            // For now, just return it and let the API call fail with a helpful error
            console.warn('[LLMManager] Watsonx API key may need IAM token exchange');
            return cleanApiKey;
        }

        // ===============================================
        // Provider API Implementations
        // ===============================================

        async _chatOpenAI(userMessage, systemPrompt) {
            const { api_key, model, base_url } = this._settings.openai;
            if (!api_key) throw new Error('OpenAI API Key missing');

            const url = `${(base_url || 'https://api.openai.com').replace(/\/$/, '')}/v1/chat/completions`;
            const headers = {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${api_key}`,
            };
            const body = {
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt || 'You are a helpful assistant.' },
                    { role: 'user', content: userMessage },
                ],
                max_tokens: 500,
            };

            let res;
            if (this._hasProxy()) {
                res = await this._fetchViaProxy(url, 'POST', headers, body);
            } else {
                res = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                });
            }

            if (!res.ok) {
                const err = await res.text();
                const corsHint = !this._hasProxy() ? '\n\nHint: Enable proxy in settings to fix CORS issues.' : '';
                throw new Error(`OpenAI Error: ${res.status} - ${err}${corsHint}`);
            }

            const data = await res.json();
            return data.choices?.[0]?.message?.content || 'No response';
        }

        async _chatClaude(userMessage, systemPrompt) {
            const { api_key, model, base_url } = this._settings.claude;
            if (!api_key) throw new Error('Claude API Key missing');

            const url = `${(base_url || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;
            const headers = {
                'Content-Type': 'application/json',
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01',
            };
            const body = {
                model: model,
                system: systemPrompt || 'You are a helpful assistant.',
                messages: [{ role: 'user', content: userMessage }],
                max_tokens: 1024,
            };

            let res;
            if (this._hasProxy()) {
                res = await this._fetchViaProxy(url, 'POST', headers, body);
            } else {
                res = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                });
            }

            if (!res.ok) {
                const err = await res.text();
                const corsHint = !this._hasProxy() ? '\n\nHint: Enable proxy in settings to fix CORS issues.' : '';
                throw new Error(`Claude Error: ${res.status} - ${err}${corsHint}`);
            }

            const data = await res.json();
            return data.content?.[0]?.text || 'No response';
        }

        async _chatWatsonx(userMessage, systemPrompt) {
            const { project_id, model_id, base_url } = this._settings.watsonx;
            if (!project_id) throw new Error('Watsonx credentials missing');

            // Get token (uses cache if available)
            const token = await this._getWatsonxToken();

            const url = `${(base_url || 'https://us-south.ml.cloud.ibm.com').replace(/\/$/, '')}/ml/v1/text/generation?version=2023-05-29`;
            const headers = {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
            };
            const body = {
                model_id: model_id,
                project_id: project_id,
                input: `${systemPrompt || 'You are a helpful assistant.'}\n\nUser: ${userMessage}\n\nAssistant:`,
                parameters: {
                    max_new_tokens: 500,
                    temperature: 0.7,
                },
            };

            let res;
            if (this._hasProxy()) {
                res = await this._fetchViaProxy(url, 'POST', headers, body);
            } else {
                res = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                });
            }

            if (!res.ok) {
                const err = await res.text();
                const corsHint = !this._hasProxy() ? '\n\nHint: Enable proxy in settings to fix CORS issues.' : '';
                throw new Error(`Watsonx Error: ${res.status} - ${err}${corsHint}`);
            }

            const data = await res.json();
            return data.results?.[0]?.generated_text || 'No response';
        }

        async _chatOllama(userMessage, systemPrompt) {
            const { base_url, model } = this._settings.ollama;
            const url = `${(base_url || 'http://localhost:11434').replace(/\/$/, '')}/api/chat`;
            const headers = { 'Content-Type': 'application/json' };
            const body = {
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt || 'You are a helpful assistant.' },
                    { role: 'user', content: userMessage },
                ],
                stream: false,
            };

            let res;
            // Ollama typically doesn't need proxy (local), but support it anyway
            if (this._hasProxy()) {
                res = await this._fetchViaProxy(url, 'POST', headers, body);
            } else {
                res = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                });
            }

            if (!res.ok) {
                const err = await res.text();
                throw new Error(`Ollama Error: ${res.status} - ${err}`);
            }

            const data = await res.json();
            return data.message?.content || 'No response';
        }

        // ===============================================
        // Model Fetchers
        // ===============================================

        async _fetchOpenAIModels() {
            const { api_key, base_url } = this._settings.openai;
            if (!api_key) {
                return {
                    models: ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
                    error: 'Missing API Key - using default list',
                };
            }

            try {
                const url = `${(base_url || 'https://api.openai.com').replace(/\/$/, '')}/v1/models`;
                const headers = { Authorization: `Bearer ${api_key}` };

                let res;
                if (this._hasProxy()) {
                    res = await this._fetchViaProxy(url, 'GET', headers, null);
                } else {
                    res = await fetch(url, { headers });
                }

                if (!res.ok) throw new Error(res.statusText);

                const data = await res.json();
                const models = (data.data || [])
                    .map((m) => m.id)
                    .filter((id) => id.includes('gpt'))
                    .sort();
                return { models: models.length > 0 ? models : ['gpt-4o', 'gpt-3.5-turbo'], error: null };
            } catch (e) {
                return {
                    models: ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
                    error: `Network error: ${e.message} - using defaults`,
                };
            }
        }

        async _fetchClaudeModels() {
            // Claude doesn't have a public models endpoint, return curated list
            return {
                models: [
                    'claude-3-5-sonnet-20241022',
                    'claude-3-opus-20240229',
                    'claude-3-sonnet-20240229',
                    'claude-3-haiku-20240307',
                ],
                error: null,
            };
        }

        async _fetchOllamaModels() {
            const { base_url } = this._settings.ollama;
            try {
                const url = `${(base_url || 'http://localhost:11434').replace(/\/$/, '')}/api/tags`;
                const res = await fetch(url);

                if (!res.ok) throw new Error('Could not reach Ollama');

                const data = await res.json();
                const models = (data.models || []).map((m) => m.name).sort();
                return {
                    models: models.length > 0 ? models : ['llama3'],
                    error: models.length === 0 ? 'No models found' : null,
                };
            } catch (e) {
                return {
                    models: ['llama3', 'mistral', 'codellama'],
                    error: `Cannot connect to Ollama: ${e.message} - using defaults`,
                };
            }
        }

        async _fetchWatsonxModels() {
            const fallback = [
                'ibm/granite-13b-chat-v2',
                'meta-llama/llama-3-70b-instruct',
                'meta-llama/llama-3-8b-instruct',
                'mistralai/mixtral-8x7b-instruct-v01',
            ];

            const bases = ['https://us-south.ml.cloud.ibm.com', 'https://eu-de.ml.cloud.ibm.com'];
            const endpoint = '/ml/v1/foundation_model_specs?version=2024-09-16';
            const allModels = new Set();

            for (const base of bases) {
                try {
                    const res = await fetch(`${base}${endpoint}`);
                    if (res.ok) {
                        const json = await res.json();
                        (json.resources || []).forEach((m) => {
                            if (m.model_id && !m.model_id.includes('deprecated')) {
                                allModels.add(m.model_id);
                            }
                        });
                    }
                } catch (e) {
                    /* continue */
                }
            }

            const models = Array.from(allModels).sort();
            return {
                models: models.length > 0 ? models : fallback,
                error: models.length === 0 ? 'Could not fetch Watsonx models - using defaults' : null,
            };
        }

        // ===============================================
        // Simple Response (no AI)
        // ===============================================

        _getSimpleResponse(text) {
            const t = text.toLowerCase();
            if (t.includes('hello') || t.includes('hi')) return 'Hello! How can I help you today?';
            if (t.includes('how are you')) return "I'm doing great! Thanks for asking.";
            if (t.includes('help'))
                return 'I can chat with you. To use AI features, configure an AI provider in Settings.';
            return "That's interesting! Could you tell me more about that?";
        }

        // ===============================================
        // Persistence
        // ===============================================

        _loadSettings() {
            const defaults = this._getDefaults();
            if (typeof localStorage !== 'undefined') {
                try {
                    const stored = localStorage.getItem(STORAGE_KEY);
                    if (stored) {
                        const parsed = JSON.parse(stored);
                        return this._deepMerge(defaults, parsed);
                    }
                } catch (e) {
                    console.warn('[LLMManager] Could not load settings from localStorage:', e);
                }
            }
            return defaults;
        }

        _saveSettings() {
            if (typeof localStorage !== 'undefined') {
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(this._settings));
                } catch (e) {
                    console.warn('[LLMManager] Could not save settings to localStorage:', e);
                }
            }
        }

        _getDefaults_old() {
            // Auto-detect proxy URL based on environment
            const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const defaultProxyUrl = isLocalhost ? 'http://localhost:3001' : '/api/proxy';

            return {
                provider: LLMProvider.NONE,
                system_prompt:
                    'You are a helpful AI assistant named Nexus. You are friendly, professional, and knowledgeable.',
                proxy: {
                    enable_proxy: false,
                    proxy_url: defaultProxyUrl,
                },
                openai: {
                    api_key: '',
                    model: 'gpt-4o',
                    base_url: '',
                },
                claude: {
                    api_key: '',
                    model: 'claude-3-5-sonnet-20241022',
                    base_url: '',
                },
                watsonx: {
                    api_key: '',
                    project_id: '',
                    model_id: 'ibm/granite-13b-chat-v2',
                    base_url: 'https://us-south.ml.cloud.ibm.com',
                },
                ollama: {
                    base_url: 'http://localhost:11434',
                    model: 'llama3',
                },
            };
        }

        _getDefaults() {
            // Prefer same-origin proxy everywhere (works on Vercel AND locally via vercel dev).
            // If the user runs the standalone nexus-proxy/server.js (8080), same-origin still works.
            const defaultProxyUrl = "/api/proxy";

            return {
                provider: LLMProvider.NONE,
                system_prompt:
                    "You are a helpful AI assistant named Nexus. You are friendly, professional, and knowledgeable.",
                proxy: {
                    enable_proxy: false,
                    proxy_url: defaultProxyUrl
                },
                openai: {
                    api_key: "",
                    model: "gpt-4o",
                    base_url: ""
                },
                claude: {
                    api_key: "",
                    model: "claude-3-5-sonnet-20241022",
                    base_url: ""
                },
                watsonx: {
                    api_key: "",
                    project_id: "",
                    model_id: "ibm/granite-13b-chat-v2",
                    base_url: "https://us-south.ml.cloud.ibm.com"
                },
                ollama: {
                    base_url: "http://localhost:11434",
                    model: "llama3"
                }
            };
        }


        // ===============================================
        // Utilities
        // ===============================================

        _deepMerge(target, source) {
            const output = Object.assign({}, target);
            if (this._isObject(target) && this._isObject(source)) {
                Object.keys(source).forEach((key) => {
                    if (this._isObject(source[key])) {
                        if (!(key in target)) {
                            Object.assign(output, { [key]: source[key] });
                        } else {
                            output[key] = this._deepMerge(target[key], source[key]);
                        }
                    } else {
                        Object.assign(output, { [key]: source[key] });
                    }
                });
            }
            return output;
        }

        _isObject(item) {
            return item && typeof item === 'object' && !Array.isArray(item);
        }
    }

    // ===============================================
    // Expose to global scope
    // ===============================================
    global.LLMManager = LLMManager;
    global.LLMProvider = LLMProvider;
})(window);
