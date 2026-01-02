# LLM Manager Implementation Guide

## Overview

The Nexus Avatar now includes a comprehensive **LLM Manager** system that provides unified access to multiple AI providers with dynamic model fetching and clean separation of concerns.

---

## ✅ What's New

### 1. **Unified LLM Manager** (`src/LLMManager.js`)

A single, professional-grade class that handles all AI provider interactions:

```javascript
// Initialize (done automatically on page load)
const llmManager = new window.LLMManager();

// Send a message to any configured provider
const response = await llmManager.sendMessage(userText, systemPrompt);

// Fetch available models dynamically
const { models, error } = await llmManager.fetchAvailableModels();

// Update settings
llmManager.updateSettings({
    provider: 'openai',
    openai: { api_key: 'sk-...', model: 'gpt-4o' }
});
```

---

## 🎯 Supported Providers

### 1. **OpenAI**
- **Models:** GPT-4o, GPT-4-turbo, GPT-4, GPT-3.5-turbo
- **Dynamic Fetching:** ✅ Fetches from `/v1/models` API
- **Requirements:** API Key

### 2. **Claude (Anthropic)**
- **Models:** Claude-3.5-Sonnet, Opus, Sonnet, Haiku
- **Dynamic Fetching:** Curated list (no public API)
- **Requirements:** API Key
- **Note:** May require CORS proxy for browser use

### 3. **Watsonx (IBM)**
- **Models:** Granite, Llama-3, Mixtral
- **Dynamic Fetching:** ✅ Fetches from `foundation_model_specs` API
- **Requirements:** API Key (Bearer token) + Project ID

### 4. **Ollama (Local)**
- **Models:** llama3, mistral, codellama, etc.
- **Dynamic Fetching:** ✅ Fetches from local `/api/tags`
- **Requirements:** Ollama running locally
- **Setup:** `OLLAMA_ORIGINS="*" ollama serve`

### 5. **None (Fallback)**
- Simple rule-based responses
- No API required

---

## 📁 Architecture

### File Structure

```
src/
├── LLMManager.js       # New: AI provider abstraction
├── main.js             # Updated: Uses LLMManager
└── vendor-guard.js     # Unchanged

index.html              # Updated: Loads LLMManager.js
```

### Loading Order (Critical)

```html
<!-- 1. Three.js vendor libraries -->
<script defer src="vendor/three-0.147.0/build/three.min.js"></script>
<script defer src="vendor/three-0.147.0/examples/js/controls/OrbitControls.js"></script>
<script defer src="vendor/three-0.147.0/examples/js/loaders/GLTFLoader.js"></script>

<!-- 2. Vendor guard -->
<script defer src="src/vendor-guard.js"></script>

<!-- 3. LLM Manager (MUST load before main.js) -->
<script defer src="src/LLMManager.js"></script>

<!-- 4. Main application -->
<script defer src="src/main.js"></script>
```

---

## ⚙️ Settings Management

### Provider-Specific Configuration

Each provider has its own settings object:

```javascript
{
  provider: 'openai',  // Active provider
  system_prompt: '...',  // Global system prompt

  openai: {
    api_key: 'sk-...',
    model: 'gpt-4o',
    base_url: ''  // Optional: Custom endpoint
  },

  claude: {
    api_key: 'sk-ant-...',
    model: 'claude-3-5-sonnet-20241022',
    base_url: ''
  },

  watsonx: {
    api_key: 'Bearer ...',
    project_id: 'abc-123',
    model_id: 'ibm/granite-13b-chat-v2',
    base_url: 'https://us-south.ml.cloud.ibm.com'
  },

  ollama: {
    base_url: 'http://localhost:11434',
    model: 'llama3'
  }
}
```

### Persistence

All settings are automatically saved to `localStorage`:

- **Key:** `nexus_llm_settings`
- **Format:** JSON
- **Automatic:** Saves on every `updateSettings()` call
- **Restoration:** Loads on page refresh

---

## 🔧 Key Features

### 1. **Dynamic Model Fetching**

The settings UI now fetches real models from each provider:

```javascript
// When user selects a provider, models are fetched automatically
async function updateProviderFields() {
    llmManager.updateSettings({ provider: selectedProvider });
    const { models, error } = await llmManager.fetchAvailableModels();
    // Populate dropdown with real models
}
```

### 2. **Error Handling**

All provider calls include comprehensive error handling:

```javascript
try {
    const response = await llmManager.sendMessage(text, prompt);
} catch (error) {
    // Error includes provider name and HTTP status
    console.error('LLM Error:', error.message);
}
```

### 3. **Fallback Lists**

If API calls fail (network, CORS, etc.), fallback model lists are used:

- **OpenAI:** GPT-4o, GPT-3.5-turbo
- **Claude:** Claude-3.5-Sonnet, Opus, Haiku
- **Watsonx:** Granite, Llama-3, Mixtral
- **Ollama:** llama3, mistral, codellama

---

## 🚀 Usage Examples

### Basic Chat Integration

```javascript
// In main.js
async function handleUserMessage(text) {
    const settings = llmManager.getSettings();
    const response = await llmManager.sendMessage(text, settings.system_prompt);
    addMessageToHistory('avatar', response);
    speakText(response);
}
```

### Switching Providers

```javascript
// Change provider dynamically
llmManager.updateSettings({ provider: 'claude' });

// Update model
llmManager.updateSettings({
    claude: { model: 'claude-3-opus-20240229' }
});
```

### Custom System Prompts

```javascript
// Global system prompt
llmManager.updateSettings({
    system_prompt: 'You are Nexus, a helpful 3D avatar assistant.'
});

// Or per-message override
const response = await llmManager.sendMessage(
    'Hello!',
    'You are a pirate. Speak like one!'
);
```

---

## 🐛 Debugging

### Check Initialization

```javascript
// In browser console
console.log(typeof window.LLMManager);  // Should be 'function'
console.log(typeof llmManager);         // Should be 'object'
```

### View Current Settings

```javascript
// In browser console
console.log(llmManager.getSettings());
```

### Test Provider Connection

```javascript
// In browser console
const { models, error } = await llmManager.fetchAvailableModels();
console.log('Models:', models);
console.log('Error:', error);
```

---

## ⚠️ Known Issues & Solutions

### 1. **CORS Errors (Claude, OpenAI)**

**Problem:** Browser blocks direct API calls due to CORS policy

**Solutions:**
- Use a backend proxy server
- Use browser extension to disable CORS (dev only)
- Use provider's official SDKs with server-side rendering

### 2. **Ollama Connection Failed**

**Problem:** Cannot connect to `http://localhost:11434`

**Solution:**
```bash
# Start Ollama with CORS enabled
OLLAMA_ORIGINS="*" ollama serve
```

### 3. **Watsonx Authentication**

**Problem:** "Bearer token expired" error

**Solution:**
- Watsonx requires IAM Bearer tokens, not API keys
- Tokens expire after 1 hour
- Use IBM Cloud CLI to generate fresh tokens:
  ```bash
  ibmcloud iam oauth-tokens
  ```

---

## 📊 Migration from Old System

### Automatic Migration

The LLMManager automatically migrates old localStorage keys:

| Old Key | New Location |
|---------|--------------|
| `ai_provider` | `nexus_llm_settings.provider` |
| `ai_api_key` | `nexus_llm_settings.{provider}.api_key` |
| `ai_model` | `nexus_llm_settings.{provider}.model` |
| `system_prompt` | `nexus_llm_settings.system_prompt` |
| `watsonx_project_id` | `nexus_llm_settings.watsonx.project_id` |

### Manual Migration

If you need to manually migrate settings:

```javascript
// Old system (deprecated)
localStorage.setItem('ai_provider', 'openai');
localStorage.setItem('ai_api_key', 'sk-...');

// New system
llmManager.updateSettings({
    provider: 'openai',
    openai: { api_key: 'sk-...' }
});
```

---

## 🎨 UI Integration

### Settings Modal

The settings modal automatically:
1. Shows/hides provider-specific fields
2. Fetches and populates model dropdowns
3. Saves settings to LLMManager
4. Validates required fields

### Provider-Specific Fields

| Provider | Fields Required |
|----------|----------------|
| OpenAI | API Key, Model, Base URL (optional) |
| Claude | API Key, Model, Base URL (optional) |
| Watsonx | API Key, Project ID, Model, Base URL |
| Ollama | Base URL, Model |
| None | (no fields) |

---

## 📝 Development Guidelines

### Adding a New Provider

1. Add provider constant to `LLMProvider`:
   ```javascript
   const LLMProvider = {
       // ...existing...
       NEWPROVIDER: 'newprovider',
   };
   ```

2. Add chat method to `LLMManager`:
   ```javascript
   async _chatNewProvider(userMessage, systemPrompt) {
       const { api_key, model } = this._settings.newprovider;
       // Implement API call
   }
   ```

3. Add model fetcher:
   ```javascript
   async _fetchNewProviderModels() {
       // Return { models: [], error: null }
   }
   ```

4. Update `sendMessage()` router
5. Update `fetchAvailableModels()` router
6. Update `_getDefaults()` with provider defaults
7. Add UI fields to settings modal

---

## 🔐 Security Best Practices

### API Key Storage

⚠️ **Warning:** API keys are stored in browser `localStorage`

**Recommendations:**
1. Never commit real API keys to git
2. Use environment variables for production
3. Consider implementing a backend proxy
4. Rotate keys regularly
5. Use read-only/limited-scope keys when possible

### Production Deployment

For production, implement a backend proxy:

```
Browser → Your Backend → AI Provider
```

This keeps API keys on the server, not in the browser.

---

## 📚 API Reference

See the full JSDoc comments in `src/LLMManager.js` for detailed API documentation.

### Key Methods

- `getSettings()` - Get current settings (safe copy)
- `updateSettings(updates)` - Update and persist settings
- `sendMessage(text, prompt)` - Send message to active provider
- `fetchAvailableModels()` - Get model list for active provider

---

## 📈 Performance

### Caching

- Model lists are not cached (fetched on demand)
- Settings are persisted to localStorage immediately
- No in-memory caching of responses

### Optimizations

- Async/await for all API calls
- Proper error handling with fallbacks
- Deep merge prevents data loss
- Minimal memory footprint

---

## 🎯 Next Steps

### Planned Enhancements

1. **Model Temperature Controls** - Add UI for temperature, max_tokens
2. **Conversation History** - Send multi-turn conversations
3. **Streaming Responses** - Support SSE/streaming APIs
4. **Provider Health Check** - Auto-detect provider availability
5. **Response Caching** - Cache repeated queries
6. **Cost Tracking** - Estimate token usage and costs

### Contributing

To contribute to the LLM Manager:

1. Follow existing code style (Prettier + ESLint)
2. Add comprehensive error handling
3. Include fallback mechanisms
4. Update this documentation
5. Test with real API keys

---

## 📞 Support

For issues or questions:

1. Check browser console for errors
2. Verify API keys are valid
3. Test with curl/Postman first
4. Check provider status pages
5. Review CORS requirements

---

**Last Updated:** 2025-12-16
**Version:** 2.0.0
**Author:** Nexus Team
