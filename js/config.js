/**
 * Configuration Module (Production, Provider-Safe)
 * ------------------------------------------------
 * Goals:
 * - Single source of truth for LLM settings, shared Desktop <-> VR:
 *     - Unified: nexus_llm_settings
 *     - Legacy fallbacks: ai_provider/ai_api_key/ai_model/ai_base_url
 *     - Existing desktop keys: openai_api_key/openai_model
 * - NEVER force provider to "openai" when saving.
 * - Sanitize known-bad model aliases (ex: claude-3-5-sonnet-latest).
 * - Keep your existing AppConfig API surface but add provider-safe helpers.
 */

(function () {
  "use strict";

  const STORAGE_KEYS = {
    // Existing desktop keys (some UIs still use these directly)
    OPENAI_API_KEY: "openai_api_key",
    OPENAI_MODEL: "openai_model",

    // Legacy keys used in parts of app / VR fallbacks
    AI_PROVIDER: "ai_provider",
    AI_API_KEY: "ai_api_key",
    AI_MODEL: "ai_model",
    AI_BASE_URL: "ai_base_url",

    // Unified key VR panel prefers
    NEXUS_LLM_SETTINGS: "nexus_llm_settings",

    // Optional prompt key (some parts use this)
    SYSTEM_PROMPT: "system_prompt",

    // Speech keys
    AUTO_SPEAK: "auto_speak",
    SPEECH_RATE: "speech_rate",
    SPEECH_PITCH: "speech_pitch",
    SELECTED_VOICE: "selected_voice",

    // UI keys
    SHOW_TIMESTAMPS: "show_timestamps",
    SOUND_EFFECTS: "sound_effects",

    // Personality
    SELECTED_PERSONALITY: "selected_personality",
  };

  const KNOWN_PROVIDERS = new Set(["openai", "claude", "watsonx", "ollama", "none"]);

  function safeJsonParse(str, fallback = null) {
    if (!str) return fallback;
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  }

  function normalizeProvider(provider) {
    const p = String(provider || "").trim().toLowerCase();
    if (KNOWN_PROVIDERS.has(p)) return p;
    return "none";
  }

  // --- IMPORTANT: sanitize "bad" / unsupported model strings ---
  // You MUST adapt the defaults below to what YOUR backend/proxy actually supports.
  // These are safe modern examples; change them if your proxy expects different IDs.
  function sanitizeModel(provider, modelRaw) {
    const model = String(modelRaw || "").trim();
    if (!model) return "";

    if (provider === "claude") {
      // Your error shows: model: claude-3-5-sonnet-latest
      // Many stacks don’t accept "-latest" aliases. Map to a pinned version you support.
      if (model === "claude-3-5-sonnet-latest") return "claude-sonnet-4-20250514";
      if (model === "claude-3-7-sonnet-latest") return "claude-sonnet-4-20250514";
      // If any "-latest" sneaks in, map it
      if (/-latest$/i.test(model)) return "claude-sonnet-4-20250514";
    }

    return model;
  }

  function readUnifiedLLMSettings() {
    const unified = safeJsonParse(localStorage.getItem(STORAGE_KEYS.NEXUS_LLM_SETTINGS), null);
    if (!unified || typeof unified !== "object") return null;

    const provider = normalizeProvider(unified.provider);

    let apiKey = "";
    let model = "";
    let baseUrl = "";
    let systemPrompt = unified.system_prompt || unified.systemPrompt || "";

    if (provider === "openai" && unified.openai && typeof unified.openai === "object") {
      apiKey = unified.openai.api_key || unified.openai.apiKey || "";
      model = unified.openai.model || "";
      baseUrl = unified.openai.base_url || unified.openai.baseUrl || "";
    } else if (provider === "claude" && unified.claude && typeof unified.claude === "object") {
      apiKey = unified.claude.api_key || unified.claude.apiKey || "";
      model = unified.claude.model || "";
      baseUrl = unified.claude.base_url || unified.claude.baseUrl || "";
    } else if (provider === "watsonx" && unified.watsonx && typeof unified.watsonx === "object") {
      apiKey = unified.watsonx.api_key || "";
      model = unified.watsonx.model_id || unified.watsonx.modelId || "";
      baseUrl = unified.watsonx.base_url || unified.watsonx.baseUrl || "";
    } else if (provider === "ollama" && unified.ollama && typeof unified.ollama === "object") {
      apiKey = ""; // usually none
      model = unified.ollama.model || "";
      baseUrl = unified.ollama.base_url || unified.ollama.baseUrl || "";
    }

    return {
      provider,
      apiKey,
      model: sanitizeModel(provider, model),
      baseUrl,
      systemPrompt,
    };
  }

  function readLegacyLLMSettings() {
    const provider = normalizeProvider(localStorage.getItem(STORAGE_KEYS.AI_PROVIDER) || "none");

    const apiKey =
      localStorage.getItem(STORAGE_KEYS.AI_API_KEY) ||
      localStorage.getItem(STORAGE_KEYS.OPENAI_API_KEY) ||
      "";

    const model =
      localStorage.getItem(STORAGE_KEYS.AI_MODEL) ||
      localStorage.getItem(STORAGE_KEYS.OPENAI_MODEL) ||
      "";

    const baseUrl = localStorage.getItem(STORAGE_KEYS.AI_BASE_URL) || "";
    const systemPrompt = localStorage.getItem(STORAGE_KEYS.SYSTEM_PROMPT) || "";

    return {
      provider,
      apiKey,
      model: sanitizeModel(provider, model),
      baseUrl,
      systemPrompt,
    };
  }

  const DEFAULTS = {
    llm: {
      provider: "none",
      apiKey: "",
      model: "",
      baseUrl: "",
      systemPrompt:
        "You are a helpful AI assistant named Nexus. You are friendly, professional, and knowledgeable.",
    },
    openai: {
      // fallback only if provider=openai and model empty
      model: "gpt-3.5-turbo",
    },
    speech: {
      rate: 1.0,
      pitch: 1.0,
    },
  };

  function getEffectiveLLMSettings() {
    const unified = readUnifiedLLMSettings();
    if (unified) {
      return {
        provider: unified.provider || DEFAULTS.llm.provider,
        apiKey: unified.apiKey || DEFAULTS.llm.apiKey,
        model: unified.model || DEFAULTS.llm.model,
        baseUrl: unified.baseUrl || DEFAULTS.llm.baseUrl,
        systemPrompt: unified.systemPrompt || DEFAULTS.llm.systemPrompt,
      };
    }

    const legacy = readLegacyLLMSettings();
    return {
      provider: legacy.provider || DEFAULTS.llm.provider,
      apiKey: legacy.apiKey || DEFAULTS.llm.apiKey,
      model: legacy.model || DEFAULTS.llm.model,
      baseUrl: legacy.baseUrl || DEFAULTS.llm.baseUrl,
      systemPrompt: legacy.systemPrompt || DEFAULTS.llm.systemPrompt,
    };
  }

  function writeLegacyKeys({ provider, apiKey, model, baseUrl }) {
    const p = normalizeProvider(provider);
    localStorage.setItem(STORAGE_KEYS.AI_PROVIDER, p);
    if (typeof apiKey === "string") localStorage.setItem(STORAGE_KEYS.AI_API_KEY, apiKey);
    if (typeof model === "string") localStorage.setItem(STORAGE_KEYS.AI_MODEL, model);
    if (typeof baseUrl === "string") localStorage.setItem(STORAGE_KEYS.AI_BASE_URL, baseUrl);

    // Keep existing desktop keys updated ONLY when provider is openai
    if (p === "openai") {
      if (typeof apiKey === "string") localStorage.setItem(STORAGE_KEYS.OPENAI_API_KEY, apiKey);
      if (typeof model === "string") localStorage.setItem(STORAGE_KEYS.OPENAI_MODEL, model);
    }
  }

  function writeUnifiedKeys({ provider, apiKey, model, baseUrl, systemPrompt }) {
    const p = normalizeProvider(provider);
    const prev = safeJsonParse(localStorage.getItem(STORAGE_KEYS.NEXUS_LLM_SETTINGS), {}) || {};
    const next = { ...prev };

    next.provider = p;

    // Always keep a prompt available for VR labels + consistent behavior
    next.system_prompt =
      systemPrompt ||
      next.system_prompt ||
      DEFAULTS.llm.systemPrompt;

    // Do NOT delete other providers’ blocks; just update the active provider’s block.
    if (p === "openai") {
      next.openai = { ...(next.openai || {}) };
      if (typeof apiKey === "string") next.openai.api_key = apiKey;
      if (typeof model === "string") next.openai.model = model;
      if (typeof baseUrl === "string") next.openai.base_url = baseUrl;
    } else if (p === "claude") {
      next.claude = { ...(next.claude || {}) };
      if (typeof apiKey === "string") next.claude.api_key = apiKey;
      if (typeof model === "string") next.claude.model = model;
      if (typeof baseUrl === "string") next.claude.base_url = baseUrl;
    } else if (p === "watsonx") {
      next.watsonx = { ...(next.watsonx || {}) };
      if (typeof apiKey === "string") next.watsonx.api_key = apiKey;
      if (typeof model === "string") next.watsonx.model_id = model;
      if (typeof baseUrl === "string") next.watsonx.base_url = baseUrl;
    } else if (p === "ollama") {
      next.ollama = { ...(next.ollama || {}) };
      if (typeof model === "string") next.ollama.model = model;
      if (typeof baseUrl === "string") next.ollama.base_url = baseUrl;
    }

    localStorage.setItem(STORAGE_KEYS.NEXUS_LLM_SETTINGS, JSON.stringify(next));
  }

  // Resolve initial settings
  const effective = getEffectiveLLMSettings();

  // Keep a single object representing provider-agnostic LLM settings
  const AppConfig = {
    // Provider-agnostic (recommended to use everywhere)
    llm: {
      provider: effective.provider,
      apiKey: effective.apiKey,
      model: effective.model,
      baseUrl: effective.baseUrl,
      systemPrompt: effective.systemPrompt,
    },

    // OpenAI convenience mirror (some of your code likely expects this)
    // Only meaningful when llm.provider === "openai"
    openai: {
      apiKey: effective.provider === "openai" ? effective.apiKey : (localStorage.getItem(STORAGE_KEYS.OPENAI_API_KEY) || ""),
      model:
        effective.provider === "openai"
          ? (effective.model || DEFAULTS.openai.model)
          : (localStorage.getItem(STORAGE_KEYS.OPENAI_MODEL) || DEFAULTS.openai.model),
      maxTokens: 500,
      temperature: 0.7,
    },

    speech: {
      autoSpeak: localStorage.getItem(STORAGE_KEYS.AUTO_SPEAK) !== "false",
      rate: parseFloat(localStorage.getItem(STORAGE_KEYS.SPEECH_RATE)) || DEFAULTS.speech.rate,
      pitch: parseFloat(localStorage.getItem(STORAGE_KEYS.SPEECH_PITCH)) || DEFAULTS.speech.pitch,
      volume: 1.0,
      selectedVoice: localStorage.getItem(STORAGE_KEYS.SELECTED_VOICE) || "",
    },

    ui: {
      showTimestamps: localStorage.getItem(STORAGE_KEYS.SHOW_TIMESTAMPS) !== "false",
      soundEffects: localStorage.getItem(STORAGE_KEYS.SOUND_EFFECTS) !== "false",
      messageAnimation: true,
    },

    personalities: {
      "friendly-kids": {
        name: "Friendly Kids",
        icon: "👶",
        description: "Fun and engaging for children",
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
        name: "Educational",
        icon: "📚",
        description: "Informative and teaching-focused",
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
        name: "Professional",
        icon: "💼",
        description: "Business-focused and efficient",
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
        name: "Creative",
        icon: "🎨",
        description: "Imaginative and artistic",
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
        name: "Storyteller",
        icon: "📖",
        description: "Engaging narratives and stories",
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
        name: "Life Coach",
        icon: "🌟",
        description: "Motivational and supportive",
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

    getCurrentPersonality() {
      const selected = localStorage.getItem(STORAGE_KEYS.SELECTED_PERSONALITY) || "friendly-kids";
      return this.personalities[selected] || this.personalities["friendly-kids"];
    },

    // --- NEW: provider-safe setters ---
    saveProvider(provider) {
      const p = normalizeProvider(provider);
      this.llm.provider = p;

      // sanitize current model if switching provider
      this.llm.model = sanitizeModel(p, this.llm.model);

      writeLegacyKeys({ provider: p, apiKey: this.llm.apiKey, model: this.llm.model, baseUrl: this.llm.baseUrl });
      writeUnifiedKeys({
        provider: p,
        apiKey: this.llm.apiKey,
        model: this.llm.model,
        baseUrl: this.llm.baseUrl,
        systemPrompt: this.llm.systemPrompt || DEFAULTS.llm.systemPrompt,
      });

      // keep openai mirror updated only if provider is openai
      if (p === "openai") {
        this.openai.apiKey = this.llm.apiKey;
        this.openai.model = this.llm.model || DEFAULTS.openai.model;
      }

      this.syncFromStorage();
    },

    saveBaseUrl(baseUrl) {
      this.llm.baseUrl = String(baseUrl || "").trim();

      writeLegacyKeys({ provider: this.llm.provider, apiKey: this.llm.apiKey, model: this.llm.model, baseUrl: this.llm.baseUrl });
      writeUnifiedKeys({
        provider: this.llm.provider,
        apiKey: this.llm.apiKey,
        model: this.llm.model,
        baseUrl: this.llm.baseUrl,
        systemPrompt: this.llm.systemPrompt || DEFAULTS.llm.systemPrompt,
      });
    },

    saveSystemPrompt(prompt) {
      const p = String(prompt || "").trim();
      this.llm.systemPrompt = p || DEFAULTS.llm.systemPrompt;
      localStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPT, this.llm.systemPrompt);

      writeUnifiedKeys({
        provider: this.llm.provider,
        apiKey: this.llm.apiKey,
        model: this.llm.model,
        baseUrl: this.llm.baseUrl,
        systemPrompt: this.llm.systemPrompt,
      });
    },

    // Backward-compatible: if your UI calls these, they still work,
    // but they write to the CURRENT provider, not always openai.
    saveApiKey(apiKey) {
      this.llm.apiKey = String(apiKey || "").trim();

      // If current provider is openai, also update openai mirror keys.
      if (this.llm.provider === "openai") {
        localStorage.setItem(STORAGE_KEYS.OPENAI_API_KEY, this.llm.apiKey);
        this.openai.apiKey = this.llm.apiKey;
      }

      writeLegacyKeys({ provider: this.llm.provider, apiKey: this.llm.apiKey, model: this.llm.model, baseUrl: this.llm.baseUrl });
      writeUnifiedKeys({
        provider: this.llm.provider,
        apiKey: this.llm.apiKey,
        model: this.llm.model,
        baseUrl: this.llm.baseUrl,
        systemPrompt: this.llm.systemPrompt || DEFAULTS.llm.systemPrompt,
      });

      this.syncFromStorage();
    },

    saveModel(model) {
      const m = sanitizeModel(this.llm.provider, model);
      this.llm.model = m;

      if (this.llm.provider === "openai") {
        localStorage.setItem(STORAGE_KEYS.OPENAI_MODEL, m);
        this.openai.model = m || DEFAULTS.openai.model;
      }

      writeLegacyKeys({ provider: this.llm.provider, apiKey: this.llm.apiKey, model: this.llm.model, baseUrl: this.llm.baseUrl });
      writeUnifiedKeys({
        provider: this.llm.provider,
        apiKey: this.llm.apiKey,
        model: this.llm.model,
        baseUrl: this.llm.baseUrl,
        systemPrompt: this.llm.systemPrompt || DEFAULTS.llm.systemPrompt,
      });

      this.syncFromStorage();
    },

    // Convenience: set everything at once
    saveLLMSettings({ provider, apiKey, model, baseUrl, systemPrompt } = {}) {
      if (provider !== undefined) this.llm.provider = normalizeProvider(provider);
      if (apiKey !== undefined) this.llm.apiKey = String(apiKey || "").trim();
      if (baseUrl !== undefined) this.llm.baseUrl = String(baseUrl || "").trim();
      if (systemPrompt !== undefined) this.llm.systemPrompt = String(systemPrompt || "").trim() || DEFAULTS.llm.systemPrompt;
      if (model !== undefined) this.llm.model = sanitizeModel(this.llm.provider, model);

      writeLegacyKeys({ provider: this.llm.provider, apiKey: this.llm.apiKey, model: this.llm.model, baseUrl: this.llm.baseUrl });
      writeUnifiedKeys({
        provider: this.llm.provider,
        apiKey: this.llm.apiKey,
        model: this.llm.model,
        baseUrl: this.llm.baseUrl,
        systemPrompt: this.llm.systemPrompt || DEFAULTS.llm.systemPrompt,
      });

      if (this.llm.provider === "openai") {
        this.openai.apiKey = this.llm.apiKey;
        this.openai.model = this.llm.model || DEFAULTS.openai.model;
      }

      this.syncFromStorage();
    },

    savePersonality(personality) {
      if (!this.personalities[personality]) return;
      localStorage.setItem(STORAGE_KEYS.SELECTED_PERSONALITY, personality);

      // Update prompt everywhere (VR reads unified)
      const prompt = this.personalities[personality].systemPrompt;
      this.saveSystemPrompt(prompt);
    },

    saveSpeechSettings(settings) {
      if (!settings || typeof settings !== "object") return;

      if (settings.rate !== undefined) {
        localStorage.setItem(STORAGE_KEYS.SPEECH_RATE, String(settings.rate));
        this.speech.rate = settings.rate;
      }
      if (settings.pitch !== undefined) {
        localStorage.setItem(STORAGE_KEYS.SPEECH_PITCH, String(settings.pitch));
        this.speech.pitch = settings.pitch;
      }
      if (settings.autoSpeak !== undefined) {
        localStorage.setItem(STORAGE_KEYS.AUTO_SPEAK, String(settings.autoSpeak));
        this.speech.autoSpeak = settings.autoSpeak;
      }
      if (settings.selectedVoice !== undefined) {
        localStorage.setItem(STORAGE_KEYS.SELECTED_VOICE, String(settings.selectedVoice));
        this.speech.selectedVoice = settings.selectedVoice;
      }
    },

    saveUISettings(settings) {
      if (!settings || typeof settings !== "object") return;

      if (settings.showTimestamps !== undefined) {
        localStorage.setItem(STORAGE_KEYS.SHOW_TIMESTAMPS, String(settings.showTimestamps));
        this.ui.showTimestamps = settings.showTimestamps;
      }
      if (settings.soundEffects !== undefined) {
        localStorage.setItem(STORAGE_KEYS.SOUND_EFFECTS, String(settings.soundEffects));
        this.ui.soundEffects = settings.soundEffects;
      }
    },

    isValidApiKey(apiKey) {
      const k = String(apiKey || "");
      // keep your original OpenAI-style check, but do NOT block other providers
      if (this.llm.provider === "openai") return k.startsWith("sk-") && k.length > 20;
      // for other providers, allow non-empty
      return k.length > 0;
    },

    isConfigured() {
      // require api key for providers that need it
      if (this.llm.provider === "ollama") return true;
      if (this.llm.provider === "none") return false;
      return this.isValidApiKey(this.llm.apiKey);
    },

    // Re-read effective settings from storage into memory
    syncFromStorage() {
      const next = getEffectiveLLMSettings();
      this.llm.provider = next.provider;
      this.llm.apiKey = next.apiKey;
      this.llm.model = next.model;
      this.llm.baseUrl = next.baseUrl;
      this.llm.systemPrompt = next.systemPrompt || DEFAULTS.llm.systemPrompt;

      if (this.llm.provider === "openai") {
        this.openai.apiKey = this.llm.apiKey;
        this.openai.model = this.llm.model || DEFAULTS.openai.model;
      }
    },
  };

  // Bootstrap: if unified missing but legacy/old exists, create unified once
  (function bootstrapConsistency() {
    const hasUnified = !!localStorage.getItem(STORAGE_KEYS.NEXUS_LLM_SETTINGS);
    if (hasUnified) return;

    const legacy = readLegacyLLMSettings();
    const p = legacy.provider !== "none" ? legacy.provider : "openai";

    // only bootstrap if there is *some* info already
    const hasAny = !!legacy.apiKey || !!legacy.model || !!localStorage.getItem(STORAGE_KEYS.OPENAI_MODEL) || !!localStorage.getItem(STORAGE_KEYS.OPENAI_API_KEY);
    if (!hasAny) return;

    const model = sanitizeModel(p, legacy.model);

    writeLegacyKeys({
      provider: p,
      apiKey: legacy.apiKey || "",
      model: model || "",
      baseUrl: legacy.baseUrl || "",
    });

    writeUnifiedKeys({
      provider: p,
      apiKey: legacy.apiKey || "",
      model: model || "",
      baseUrl: legacy.baseUrl || "",
      systemPrompt: legacy.systemPrompt || AppConfig.getCurrentPersonality().systemPrompt || DEFAULTS.llm.systemPrompt,
    });

    AppConfig.syncFromStorage();
  })();

  window.AppConfig = AppConfig;
})();
