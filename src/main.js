/**
 * Nexus Avatar - Main Application Controller
 * High-performance 3D Avatar Chatbot with multi-provider LLM support
 */

// Avatar Preset URLs
const AVATAR_PRESETS = {
    robot: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
    soldier: 'https://threejs.org/examples/models/gltf/Soldier.glb',
    rpm: 'https://models.readyplayer.me/6185a4acfb622cf1cdc49348.glb',
};

// Application State
let scene, camera, renderer, controls, clock;
let currentAvatar = null;
let mixer = null;
let animations = {};
let currentAnimationAction = null;

// LLM Service
let llmService = null;

// Speech Recognition
let recognition = null;
let isListening = false;

// Configuration
const config = {
    provider: localStorage.getItem('ai_provider') || 'none',
    apiKey: localStorage.getItem('ai_api_key') || '',
    model: localStorage.getItem('ai_model') || '',
    systemPrompt:
        localStorage.getItem('system_prompt') ||
        'You are a helpful AI assistant named Nexus. You are friendly, professional, and knowledgeable.',
    watsonxProjectId: localStorage.getItem('watsonx_project_id') || '',
    baseUrl: localStorage.getItem('base_url') || '',
};

/**
 * Initialize the application
 */
function init() {
    setupThreeJS();
    setupEventListeners();
    setupModals();
    loadDefaultAvatar();
    initSpeechRecognition();
    loadConfig();
}

/**
 * Setup Three.js scene, camera, renderer, and controls
 */
function setupThreeJS() {
    const viewport = document.getElementById('avatar-viewport');

    // Scene
    scene = new THREE.Scene();
    scene.background = null;

    // Camera
    const aspect = viewport.clientWidth / viewport.clientHeight;
    camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    camera.position.set(0, 1.5, 3);

    // Renderer
    const canvas = document.createElement('canvas');
    viewport.appendChild(canvas);

    renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: true,
    });
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0xffffff, 0.4, 100);
    pointLight.position.set(-5, 5, 5);
    scene.add(pointLight);

    // Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 1.5;
    controls.maxDistance = 6;
    controls.enablePan = false;
    controls.maxPolarAngle = Math.PI / 1.5;
    controls.target.set(0, 1, 0);

    // Clock
    clock = new THREE.Clock();

    // Handle window resize
    window.addEventListener('resize', onWindowResize);

    // Start animation loop
    animate();
}

/**
 * Animation loop
 */
function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();

    if (mixer) {
        mixer.update(delta);
    }

    if (controls) {
        controls.update();
    }

    renderer.render(scene, camera);
}

/**
 * Handle window resize
 */
function onWindowResize() {
    const viewport = document.getElementById('avatar-viewport');
    camera.aspect = viewport.clientWidth / viewport.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
}

/**
 * Show loading overlay
 */
function showLoading(message = 'Loading 3D Avatar...') {
    const overlay = document.getElementById('loading-overlay');
    const text = document.getElementById('loading-text');
    if (text) text.textContent = message;
    overlay.classList.remove('hidden');
}

/**
 * Hide loading overlay
 */
function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.add('hidden');
}

/**
 * Update status indicator
 */
function setStatus(mode, text) {
    const indicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');

    if (statusText) statusText.textContent = text;

    if (indicator) {
        indicator.classList.remove('speaking', 'listening');
        if (mode === 'speaking') indicator.classList.add('speaking');
        if (mode === 'listening') indicator.classList.add('listening');
    }
}

/**
 * Dispose of 3D objects to prevent memory leaks
 */
function disposeObject3D(obj) {
    if (!obj) return;

    obj.traverse((child) => {
        if (child.isMesh) {
            if (child.geometry) {
                child.geometry.dispose();
            }

            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => {
                if (material) {
                    // Dispose textures
                    for (const key in material) {
                        const value = material[key];
                        if (value && value.isTexture) {
                            value.dispose();
                        }
                    }
                    material.dispose();
                }
            });
        }
    });
}

/**
 * Load avatar from URL
 */
function loadAvatar(url, source = 'preset') {
    showLoading('Loading 3D Avatar...');
    setStatus('idle', 'LOADING...');

    // Dispose of current avatar
    if (currentAvatar) {
        scene.remove(currentAvatar);
        disposeObject3D(currentAvatar);
        currentAvatar = null;
    }

    // Reset mixer and animations
    if (mixer) {
        mixer.stopAllAction();
        mixer = null;
    }
    animations = {};
    currentAnimationAction = null;

    // Load new avatar
    const loader = new THREE.GLTFLoader();

    loader.load(
        url,
        (gltf) => {
            currentAvatar = gltf.scene;
            scene.add(currentAvatar);

            // Scale and position
            currentAvatar.scale.set(1.5, 1.5, 1.5);
            currentAvatar.position.y = -1;

            // Enable shadows
            currentAvatar.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            // Setup animations
            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(currentAvatar);

                gltf.animations.forEach((clip) => {
                    const name = clip.name.toLowerCase();
                    animations[name] = clip;
                });

                // Start idle animation if available
                playAnimation('idle', true);
            }

            hideLoading();
            setStatus('idle', 'READY');
            console.log(`Avatar loaded successfully from ${source}:`, url);
            console.log('Available animations:', Object.keys(animations));
        },
        (progress) => {
            const percent = (progress.loaded / progress.total) * 100;
            showLoading(`Loading 3D Avatar... ${Math.round(percent)}%`);
        },
        (error) => {
            console.error('Error loading avatar:', error);
            hideLoading();
            setStatus('idle', 'ERROR');
            showMessage('Failed to load avatar. Please try another one.', 'error');
        }
    );
}

/**
 * Load default avatar on startup
 */
function loadDefaultAvatar() {
    loadAvatar(AVATAR_PRESETS.robot, 'default');
}

/**
 * Play animation
 */
function playAnimation(name, loop = false) {
    if (!mixer || !animations[name]) {
        console.warn(`Animation "${name}" not found`);
        return;
    }

    // Stop current animation
    if (currentAnimationAction) {
        currentAnimationAction.fadeOut(0.2);
    }

    const clip = animations[name];
    const action = mixer.clipAction(clip);

    action.reset();
    action.fadeIn(0.2);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce);
    action.clampWhenFinished = true;
    action.play();

    currentAnimationAction = action;

    // If not looping, return to idle after animation completes
    if (!loop) {
        setTimeout(
            () => {
                playAnimation('idle', true);
            },
            (clip.duration - 0.2) * 1000
        );
    }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Avatar selector
    const avatarSelect = document.getElementById('avatar-select');
    avatarSelect.addEventListener('change', (e) => {
        const preset = e.target.value;
        if (AVATAR_PRESETS[preset]) {
            loadAvatar(AVATAR_PRESETS[preset], 'preset');
        }
    });

    // Avatar upload
    const avatarUpload = document.getElementById('avatar-upload');
    avatarUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const url = URL.createObjectURL(file);
            loadAvatar(url, 'upload');
        }
    });

    // Text input
    const speechText = document.getElementById('speech-text');
    const speakBtn = document.getElementById('speak-btn');

    speakBtn.addEventListener('click', () => {
        const text = speechText.value.trim();
        if (text) {
            handleUserMessage(text);
            speechText.value = '';
        }
    });

    speechText.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const text = speechText.value.trim();
            if (text) {
                handleUserMessage(text);
                speechText.value = '';
            }
        }
    });

    // Voice input
    const listenBtn = document.getElementById('listen-btn');
    listenBtn.addEventListener('click', toggleVoiceInput);

    // Emotion buttons
    document.querySelectorAll('.emotion-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const emotion = btn.dataset.emotion;
            playAnimation(emotion, false);
            setStatus('idle', `FEELING ${emotion.toUpperCase()}`);
            setTimeout(() => setStatus('idle', 'READY'), 2000);
        });
    });

    // Clear history
    document.getElementById('clear-history').addEventListener('click', clearHistory);

    // Settings button
    document.getElementById('settings-btn').addEventListener('click', openSettings);

    // Info button
    document.getElementById('info-btn').addEventListener('click', openInfo);
}

/**
 * Setup modals
 */
function setupModals() {
    const settingsModal = document.getElementById('settings-modal');
    const infoModal = document.getElementById('info-modal');

    // Close buttons
    document.getElementById('close-settings').addEventListener('click', () => {
        settingsModal.classList.remove('active');
    });

    document.getElementById('close-info').addEventListener('click', () => {
        infoModal.classList.remove('active');
    });

    // Cancel button
    document.getElementById('cancel-settings').addEventListener('click', () => {
        settingsModal.classList.remove('active');
    });

    // Save settings
    document.getElementById('save-settings').addEventListener('click', saveSettings);

    // Provider selection
    document.querySelectorAll('input[name="provider"]').forEach((radio) => {
        radio.addEventListener('change', updateProviderFields);
    });

    // Close on overlay click
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.remove('active');
        }
    });

    infoModal.addEventListener('click', (e) => {
        if (e.target === infoModal) {
            infoModal.classList.remove('active');
        }
    });
}

/**
 * Open settings modal
 */
function openSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.add('active');
}

/**
 * Open info modal
 */
function openInfo() {
    const modal = document.getElementById('info-modal');
    modal.classList.add('active');
}

/**
 * Update provider-specific fields in settings
 */
function updateProviderFields() {
    const provider = document.querySelector('input[name="provider"]:checked').value;
    const modelSelect = document.getElementById('model-select');
    const watsonxRow = document.getElementById('watsonx-project-row');
    const baseurlRow = document.getElementById('baseurl-row');

    // Clear model options
    modelSelect.innerHTML = '<option value="">Select a model...</option>';

    // Show/hide provider-specific fields
    if (provider === 'watsonx') {
        watsonxRow.style.display = 'block';
        baseurlRow.style.display = 'block';

        // WatsonX models
        const models = [
            'meta-llama/llama-3-70b-instruct',
            'meta-llama/llama-3-8b-instruct',
            'ibm/granite-13b-chat-v2',
            'mistralai/mixtral-8x7b-instruct-v01',
        ];
        models.forEach((model) => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            modelSelect.appendChild(option);
        });
    } else {
        watsonxRow.style.display = 'none';

        if (provider === 'openai') {
            baseurlRow.style.display = 'none';

            const models = ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];
            models.forEach((model) => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model.toUpperCase();
                modelSelect.appendChild(option);
            });
        } else if (provider === 'claude') {
            baseurlRow.style.display = 'none';

            const models = [
                'claude-3-5-sonnet-20241022',
                'claude-3-opus-20240229',
                'claude-3-sonnet-20240229',
                'claude-3-haiku-20240307',
            ];
            models.forEach((model) => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model.toUpperCase().replace(/-/g, ' ');
                modelSelect.appendChild(option);
            });
        } else {
            baseurlRow.style.display = 'none';
        }
    }
}

/**
 * Load configuration from localStorage
 */
function loadConfig() {
    // Set provider radio
    const providerRadio = document.querySelector(`input[name="provider"][value="${config.provider}"]`);
    if (providerRadio) {
        providerRadio.checked = true;
        updateProviderFields();
    }

    // Set API key
    document.getElementById('api-key').value = config.apiKey;

    // Set model
    document.getElementById('model-select').value = config.model;

    // Set system prompt
    document.getElementById('system-prompt').value = config.systemPrompt;

    // Set WatsonX fields
    document.getElementById('watsonx-project-id').value = config.watsonxProjectId;
    document.getElementById('base-url').value = config.baseUrl;
}

/**
 * Save settings
 */
function saveSettings() {
    const provider = document.querySelector('input[name="provider"]:checked').value;
    const apiKey = document.getElementById('api-key').value;
    const model = document.getElementById('model-select').value;
    const systemPrompt = document.getElementById('system-prompt').value;
    const watsonxProjectId = document.getElementById('watsonx-project-id').value;
    const baseUrl = document.getElementById('base-url').value;

    // Validate
    if (provider !== 'none' && !apiKey) {
        showMessage('Please enter an API key', 'error');
        return;
    }

    if (provider !== 'none' && !model) {
        showMessage('Please select a model', 'error');
        return;
    }

    // Save to localStorage
    localStorage.setItem('ai_provider', provider);
    localStorage.setItem('ai_api_key', apiKey);
    localStorage.setItem('ai_model', model);
    localStorage.setItem('system_prompt', systemPrompt);
    localStorage.setItem('watsonx_project_id', watsonxProjectId);
    localStorage.setItem('base_url', baseUrl);

    // Update config
    config.provider = provider;
    config.apiKey = apiKey;
    config.model = model;
    config.systemPrompt = systemPrompt;
    config.watsonxProjectId = watsonxProjectId;
    config.baseUrl = baseUrl;

    // Initialize LLM service
    initLLMService();

    // Close modal
    document.getElementById('settings-modal').classList.remove('active');

    showMessage('Settings saved successfully', 'success');
}

/**
 * Initialize LLM service based on provider
 */
function initLLMService() {
    // This would import and initialize the appropriate LLM service
    // For now, we'll use a simple fetch-based implementation
    console.log('LLM Service initialized with provider:', config.provider);
}

/**
 * Handle user message
 */
async function handleUserMessage(text) {
    addMessageToHistory('user', text);
    setStatus('listening', 'THINKING...');
    playAnimation('thinking', true);

    try {
        let response;

        if (config.provider === 'none') {
            // Simple fallback responses
            response = getSimpleResponse(text);
        } else {
            // Call LLM API
            response = await callLLM(text);
        }

        addMessageToHistory('avatar', response);
        speakText(response);
    } catch (error) {
        console.error('Error processing message:', error);
        addMessageToHistory('avatar', 'Sorry, I encountered an error. Please check your settings.');
        setStatus('idle', 'ERROR');
        setTimeout(() => setStatus('idle', 'READY'), 2000);
    }
}

/**
 * Simple response fallback
 */
function getSimpleResponse(text) {
    text = text.toLowerCase();

    if (text.includes('hello') || text.includes('hi')) {
        return 'Hello! How can I assist you today?';
    } else if (text.includes('how are you')) {
        return "I'm functioning perfectly, thank you for asking! How can I help you?";
    } else if (text.includes('bye') || text.includes('goodbye')) {
        return 'Goodbye! Have a wonderful day!';
    } else if (text.includes('help')) {
        return 'I can chat with you and perform various tasks. To use AI features, please configure an AI provider in Settings.';
    } else {
        return "That's interesting! Could you tell me more about that?";
    }
}

/**
 * Call LLM API
 */
async function callLLM(userMessage) {
    if (config.provider === 'openai') {
        return await callOpenAI(userMessage);
    } else if (config.provider === 'claude') {
        return await callClaude(userMessage);
    } else if (config.provider === 'watsonx') {
        return await callWatsonX(userMessage);
    }
    return 'Provider not configured.';
}

/**
 * Call OpenAI API
 */
async function callOpenAI(userMessage) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.model,
            messages: [
                { role: 'system', content: config.systemPrompt },
                { role: 'user', content: userMessage },
            ],
            max_tokens: 500,
        }),
    });

    if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

/**
 * Call Claude API
 */
async function callClaude(userMessage) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: config.model,
            max_tokens: 500,
            system: config.systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
        }),
    });

    if (!response.ok) {
        throw new Error(`Claude API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.content[0].text;
}

/**
 * Call WatsonX API
 */
async function callWatsonX(userMessage) {
    // Note: WatsonX typically requires backend proxy due to CORS
    // This is a placeholder implementation
    const baseUrl = config.baseUrl || 'https://us-south.ml.cloud.ibm.com';

    const response = await fetch(`${baseUrl}/ml/v1/text/generation?version=2023-05-29`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
            Accept: 'application/json',
        },
        body: JSON.stringify({
            model_id: config.model,
            input: `${config.systemPrompt}\n\nUser: ${userMessage}\n\nAssistant:`,
            parameters: {
                max_new_tokens: 500,
                temperature: 0.7,
            },
            project_id: config.watsonxProjectId,
        }),
    });

    if (!response.ok) {
        throw new Error(`WatsonX API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.results[0].generated_text;
}

/**
 * Speak text using TTS
 */
function speakText(text) {
    setStatus('speaking', 'SPEAKING...');
    playAnimation('happy', true);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;

    utterance.onend = () => {
        setStatus('idle', 'READY');
        playAnimation('idle', true);
    };

    window.speechSynthesis.speak(utterance);
}

/**
 * Initialize speech recognition
 */
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        console.warn('Speech recognition not supported');
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
        isListening = true;
        setStatus('listening', 'LISTENING...');
        document.getElementById('listen-btn').classList.add('active');
        document.getElementById('voice-btn-text').textContent = 'LISTENING...';
        document.getElementById('recognition-status').textContent = 'Listening to your voice...';
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        document.getElementById('speech-text').value = transcript;
        handleUserMessage(transcript);
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        stopVoiceInput();
    };

    recognition.onend = () => {
        stopVoiceInput();
    };
}

/**
 * Toggle voice input
 */
function toggleVoiceInput() {
    if (isListening) {
        stopVoiceInput();
    } else {
        startVoiceInput();
    }
}

/**
 * Start voice input
 */
function startVoiceInput() {
    if (!recognition) {
        showMessage('Speech recognition not supported in this browser', 'error');
        return;
    }

    try {
        recognition.start();
    } catch (error) {
        console.error('Error starting recognition:', error);
    }
}

/**
 * Stop voice input
 */
function stopVoiceInput() {
    isListening = false;
    setStatus('idle', 'READY');
    document.getElementById('listen-btn').classList.remove('active');
    document.getElementById('voice-btn-text').textContent = 'ACTIVATE VOICE';
    document.getElementById('recognition-status').textContent = 'Voice system standby';

    if (recognition) {
        try {
            recognition.stop();
        } catch (error) {
            console.error('Error stopping recognition:', error);
        }
    }
}

/**
 * Add message to chat history
 */
function addMessageToHistory(sender, text) {
    const chatHistory = document.getElementById('chat-history');

    // Remove empty state
    const emptyState = chatHistory.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;

    const senderDiv = document.createElement('div');
    senderDiv.className = `message-sender ${sender}`;
    senderDiv.textContent = sender === 'user' ? 'YOU' : 'NEXUS';

    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.textContent = text;

    messageDiv.appendChild(senderDiv);
    messageDiv.appendChild(textDiv);
    chatHistory.appendChild(messageDiv);

    // Scroll to bottom
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

/**
 * Clear chat history
 */
function clearHistory() {
    const chatHistory = document.getElementById('chat-history');
    chatHistory.innerHTML = '<div class="empty-state">No transmissions recorded</div>';
}

/**
 * Show temporary message
 */
function showMessage(text, type = 'info') {
    // Create a temporary notification
    const notification = document.createElement('div');
    notification.textContent = text;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: ${type === 'error' ? '#ff5252' : '#00ff88'};
        color: #000;
        padding: 12px 24px;
        border-radius: 8px;
        font-family: var(--font-display);
        font-weight: 600;
        z-index: 2000;
        animation: slideDown 0.3s ease-out;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
