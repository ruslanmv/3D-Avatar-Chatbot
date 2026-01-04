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
         * @param {Array} conversationHistory - Previous messages for context (optional)
         * @returns {Promise<string>} AI response
         */
        async sendMessage(userMessage, systemPrompt, conversationHistory = []) {
            const cfg = this._settings;
            const provider = cfg.provider;

            console.log(
                `[LLMManager] Sending message to ${provider} with ${conversationHistory.length} history messages`
            );

            if (provider === LLMProvider.NONE) {
                return this._getSimpleResponse(userMessage);
            }

            if (provider === LLMProvider.OPENAI) {
                return await this._chatOpenAI(userMessage, systemPrompt, conversationHistory);
            }

            if (provider === LLMProvider.CLAUDE) {
                return await this._chatClaude(userMessage, systemPrompt, conversationHistory);
            }

            if (provider === LLMProvider.WATSONX) {
                return await this._chatWatsonx(userMessage, systemPrompt, conversationHistory);
            }

            if (provider === LLMProvider.OLLAMA) {
                return await this._chatOllama(userMessage, systemPrompt, conversationHistory);
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
            // Use proxy_url directly - it already includes /proxy or /api/proxy
            const proxyUrl = this._proxyBase();

            console.log(`[LLMManager] Proxying ${method} request to ${url} via ${proxyUrl}`);

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

        async _chatOpenAI(userMessage, systemPrompt, conversationHistory = []) {
            const { api_key: rawKey, model, base_url } = this._settings.openai;

            // Trim whitespace (prevents copy/paste issues)
            const api_key = (rawKey || '').trim();

            if (!api_key) {
                throw new Error('OpenAI API Key missing. Please add your API key in Settings.');
            }

            // Validate key format (OpenAI keys start with sk- but NOT sk-ant-)
            if (!api_key.startsWith('sk-') || api_key.startsWith('sk-ant-')) {
                throw new Error(
                    'Invalid OpenAI API key format. OpenAI keys should start with "sk-" (not "sk-ant-"). Please check your API key in Settings.'
                );
            }

            const url = `${(base_url || 'https://api.openai.com').replace(/\/$/, '')}/v1/chat/completions`;
            const headers = {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${api_key}`,
            };

            // ✅ Build messages with conversation history
            const messages = [
                { role: 'system', content: systemPrompt || 'You are a helpful assistant.' },
                ...conversationHistory, // Include previous conversation for context
                { role: 'user', content: userMessage },
            ];

            const body = {
                model: model,
                messages: messages,
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

        async _chatClaude(userMessage, systemPrompt, conversationHistory = []) {
            const { api_key: rawKey, model, base_url } = this._settings.claude;

            // Trim whitespace (prevents copy/paste issues)
            const api_key = (rawKey || '').trim();

            if (!api_key) {
                throw new Error('Claude API Key missing. Please add your API key in Settings.');
            }

            // Validate key format
            if (!api_key.startsWith('sk-ant-')) {
                throw new Error(
                    'Invalid Claude API key format. Anthropic keys should start with "sk-ant-". Please check your API key in Settings.'
                );
            }

            const url = `${(base_url || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;
            const headers = {
                'Content-Type': 'application/json',
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01',
            };

            // ✅ Build messages with conversation history
            const messages = [...conversationHistory, { role: 'user', content: userMessage }];

            const body = {
                model: model,
                system: systemPrompt || 'You are a helpful assistant.',
                messages: messages,
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

        async _chatWatsonx(userMessage, systemPrompt, conversationHistory = []) {
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

            // ✅ Build input string with conversation history
            let input = `${systemPrompt || 'You are a helpful assistant.'}\n\n`;
            for (const msg of conversationHistory) {
                const speaker = msg.role === 'user' ? 'User' : 'Assistant';
                input += `${speaker}: ${msg.content}\n\n`;
            }
            input += `User: ${userMessage}\n\nAssistant:`;

            const body = {
                model_id: model_id,
                project_id: project_id,
                input: input,
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

        async _chatOllama(userMessage, systemPrompt, conversationHistory = []) {
            const { base_url, model } = this._settings.ollama;
            const url = `${(base_url || 'http://localhost:11434').replace(/\/$/, '')}/api/chat`;
            const headers = { 'Content-Type': 'application/json' };

            // ✅ Build messages with conversation history
            const messages = [
                { role: 'system', content: systemPrompt || 'You are a helpful assistant.' },
                ...conversationHistory, // Include previous conversation for context
                { role: 'user', content: userMessage },
            ];

            const body = {
                model: model,
                messages: messages,
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
            const { api_key: rawKey, base_url } = this._settings.openai;

            // Fallback models (always point to latest flagship versions)
            const fallback = ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'];

            // Trim whitespace
            const api_key = (rawKey || '').trim();

            if (!api_key) {
                return {
                    models: fallback,
                    error: 'Missing API Key - using default list',
                };
            }

            // Validate key format
            if (!api_key.startsWith('sk-') || api_key.startsWith('sk-ant-')) {
                console.warn(
                    '[LLMManager] ⚠️ OpenAI API key should start with "sk-" (not "sk-ant-"), got:',
                    api_key.substring(0, 10) + '...'
                );
                return {
                    models: fallback,
                    error: 'Invalid API key format. OpenAI keys should start with "sk-" (not "sk-ant-"). Please check your API key in Settings.',
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

                // SMART FILTERING & SORTING: Prioritize gpt-4o, then gpt-4, then o1 models
                const models = (data.data || [])
                    .map((m) => m.id)
                    .filter((id) => id.startsWith('gpt') || id.startsWith('o1'))
                    .sort((a, b) => {
                        // Priority 1: gpt-4o (flagship)
                        if (a === 'gpt-4o') return -1;
                        if (b === 'gpt-4o') return 1;

                        // Priority 2: o1 models
                        const aO1 = a.startsWith('o1');
                        const bO1 = b.startsWith('o1');
                        if (aO1 && !bO1) return -1;
                        if (!aO1 && bO1) return 1;

                        // Priority 3: Alphabetical
                        return a.localeCompare(b);
                    });

                return { models: models.length > 0 ? models : fallback, error: null };
            } catch (e) {
                return {
                    models: fallback,
                    error: `Network error: ${e.message} - using defaults`,
                };
            }
        }

        async _fetchClaudeModels() {
            const { api_key: rawKey, base_url } = this._settings.claude;

            // Fallback models using "latest" aliases (auto-update to newest versions)
            const fallback = [
                'claude-3-5-sonnet-latest', // ✅ Auto-updates to newest 3.5 Sonnet
                'claude-3-5-haiku-latest', // ✅ Auto-updates to newest 3.5 Haiku
                'claude-3-opus-latest', // ✅ Auto-updates to newest Opus
                'claude-3-5-sonnet-20241022', // Specific backup
            ];

            // Trim whitespace (prevents copy/paste issues)
            const api_key = (rawKey || '').trim();

            if (!api_key) {
                return {
                    models: fallback,
                    error: 'No API key - using default model list',
                };
            }

            // Validate key format (Anthropic keys start with sk-ant-)
            if (!api_key.startsWith('sk-ant-')) {
                console.warn(
                    '[LLMManager] ⚠️ Claude API key should start with "sk-ant-", got:',
                    api_key.substring(0, 10) + '...'
                );
                return {
                    models: fallback,
                    error: 'Invalid API key format. Anthropic keys should start with "sk-ant-". Please check your API key in Settings.',
                };
            }

            try {
                const apiBase = base_url || 'https://api.anthropic.com';
                const url = `${apiBase.replace(/\/$/, '')}/v1/models`;

                const headers = {
                    'Content-Type': 'application/json',
                    'x-api-key': api_key,
                    'anthropic-version': '2023-06-01',
                };

                console.log(
                    '[LLMManager] 🔑 Using Claude API key:',
                    api_key.substring(0, 12) + '...' + api_key.substring(api_key.length - 4)
                );

                let response;
                if (this._hasProxy()) {
                    response = await this._fetchViaProxy(url, 'GET', headers, null);
                } else {
                    response = await fetch(url, {
                        method: 'GET',
                        headers: headers,
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                }

                const data = await response.json();

                // SMART SORTING: Prioritize "latest" aliases and "3-5" series
                const models = (data.data || [])
                    .map((m) => m.id)
                    .filter((id) => id && id.startsWith('claude-'))
                    .sort((a, b) => {
                        // Priority 1: Aliases containing "latest"
                        const aLatest = a.includes('latest');
                        const bLatest = b.includes('latest');
                        if (aLatest && !bLatest) return -1;
                        if (!aLatest && bLatest) return 1;

                        // Priority 2: "3-5" series (newest)
                        const a35 = a.includes('3-5');
                        const b35 = b.includes('3-5');
                        if (a35 && !b35) return -1;
                        if (!a35 && b35) return 1;

                        // Priority 3: Newest date (descending)
                        return b.localeCompare(a);
                    });

                if (models.length === 0) {
                    console.warn('[LLMManager] No Claude models found in API response, using fallback');
                    return { models: fallback, error: 'No models in API response - using defaults' };
                }

                console.log('[LLMManager] ✅ Fetched Claude models:', models);
                return { models: models, error: null };
            } catch (e) {
                console.error('[LLMManager] ❌ Failed to fetch Claude models:', e.message);

                // Enhanced error message for authentication failures
                if (e.message && e.message.includes('401')) {
                    return {
                        models: fallback,
                        error: '⚠️ Authentication failed (401). Your Claude API key is invalid or expired. Please check: https://console.anthropic.com/settings/keys',
                    };
                }

                return {
                    models: fallback,
                    error: `Could not fetch models: ${e.message} - using defaults`,
                };
            }
        }

        async _fetchOllamaModels() {
            const { base_url } = this._settings.ollama;

            // Updated fallback models (latest versions)
            const fallback = ['llama3.3', 'llama3.2', 'mistral', 'codellama'];

            try {
                const url = `${(base_url || 'http://localhost:11434').replace(/\/$/, '')}/api/tags`;
                const res = await fetch(url);

                if (!res.ok) throw new Error('Could not reach Ollama');

                const data = await res.json();
                const models = (data.models || []).map((m) => m.name).sort();
                return {
                    models: models.length > 0 ? models : fallback,
                    error: models.length === 0 ? 'No models found' : null,
                };
            } catch (e) {
                return {
                    models: fallback,
                    error: `Cannot connect to Ollama: ${e.message} - using defaults`,
                };
            }
        }

        async _fetchWatsonxModels() {
            // Updated fallback models (latest versions as of 2025/2026)
            const fallback = [
                'ibm/granite-3-1-8b-instruct', // Updated from granite-3-8b-instruct
                'meta-llama/llama-3-3-70b-instruct', // Updated from llama-3-70b-instruct (3.3 offers 405B performance)
                'meta-llama/llama-3-1-8b-instruct', // Updated from llama-3-8b-instruct (3.1 has 128k context)
                'mistralai/mistral-large-2407', // Updated from mixtral-8x7b (Mistral Large 2 flagship)
                'mistralai/mistral-nemo', // New mid-sized model (12B)
            ];

            // Watsonx regions (based on Python model_catalog.py)
            const bases = [
                'https://us-south.ml.cloud.ibm.com',
                'https://eu-de.ml.cloud.ibm.com',
                'https://jp-tok.ml.cloud.ibm.com',
                'https://au-syd.ml.cloud.ibm.com',
            ];

            // Watsonx foundation model specs endpoint with filters
            const endpoint =
                '/ml/v1/foundation_model_specs?version=2024-09-16&filters=!function_embedding,!lifecycle_withdrawn';
            const allModels = new Set();
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

            // Helper to check if model is deprecated/withdrawn
            const isDeprecatedOrWithdrawn = (lifecycle) => {
                if (!Array.isArray(lifecycle)) return false;
                for (const entry of lifecycle) {
                    const id = entry.id || '';
                    const startDate = entry.start_date || '';
                    if ((id === 'deprecated' || id === 'withdrawn') && startDate <= today) {
                        return true;
                    }
                }
                return false;
            };

            for (const base of bases) {
                try {
                    const res = await fetch(`${base}${endpoint}`);
                    if (res.ok) {
                        const json = await res.json();
                        (json.resources || []).forEach((m) => {
                            const modelId = m.model_id;
                            const lifecycle = m.lifecycle || [];

                            // Skip if no model_id or if deprecated/withdrawn
                            if (!modelId || isDeprecatedOrWithdrawn(lifecycle)) {
                                return;
                            }

                            allModels.add(modelId);
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
                    model: 'claude-3-5-sonnet-latest',
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
            const defaultProxyUrl = '/api/proxy';

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
                    model: 'claude-3-5-sonnet-latest',
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
