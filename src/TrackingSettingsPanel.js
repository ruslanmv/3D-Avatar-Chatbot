/**
 * TrackingSettingsPanel — VRoid Hub–style tracking settings gear panel.
 *
 * Provides the full settings UI matching VRoid Hub's tracking page:
 *   - Camera device selector (enumerate + switch webcams)
 *   - Flip toggle (mirror camera horizontally)
 *   - Hand tracking toggle (enable/disable hand/finger detection)
 *   - Facial expressions overwrite toggle
 *   - Eye direction: "Look at camera" toggle
 *   - Emotion presets (Neutral / Fun / Sorrow / Angry / Joy)
 *   - Per-eye blink buttons (Right / Left)
 *   - User-defined expression slot (Surprised)
 *
 * Architecture:
 *   - Gear button in toolbar opens a floating panel
 *   - Panel state persisted to localStorage
 *   - Non-destructive: communicates via NEXUS_FACE_TRACKER / NEXUS_HAND_TRACKER APIs
 *
 * Exposes: window.NEXUS_TRACKING_PANEL
 *
 * @module TrackingSettingsPanel
 */
(function (global) {
    'use strict';

    // ── State (persisted) ────────────────────────────────────────────────

    const STORAGE_KEY = 'nexus_tracking_settings';

    function _loadSettings() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
        } catch (_) {
            return {};
        }
    }

    function _saveSettings(s) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
        } catch (_) {}
    }

    let _settings = Object.assign(
        {
            cameraDeviceId: '',
            flip: false,
            handTracking: false,
            overwriteExpressions: true,
            lookAtCamera: false,
            emotion: 'neutral',
        },
        _loadSettings()
    );

    let _panelEl = null;
    let _visible = false;
    let _cameraDevices = [];

    // ── Panel Creation ───────────────────────────────────────────────────

    function _createPanel() {
        if (_panelEl) return _panelEl;

        const panel = document.createElement('div');
        panel.id = 'tracking-settings-panel';
        panel.style.cssText = `
            position: fixed;
            top: 60px;
            right: 16px;
            width: 300px;
            max-height: calc(100vh - 80px);
            overflow-y: auto;
            background: rgba(12, 20, 30, 0.95);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(0, 229, 255, 0.15);
            border-radius: 12px;
            padding: 0;
            z-index: 9000;
            font-family: var(--font-body, 'Rajdhani', sans-serif);
            color: #e0e0e0;
            display: none;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
            scrollbar-width: thin;
            scrollbar-color: rgba(0, 229, 255, 0.2) transparent;
        `;

        panel.innerHTML = _buildPanelHTML();
        document.body.appendChild(panel);
        _panelEl = panel;

        _wireEvents(panel);
        _refreshCameraDevices();

        return panel;
    }

    function _buildPanelHTML() {
        return `
            <div style="padding: 14px 16px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; justify-content: space-between; align-items: center;">
                <span style="font-family: var(--font-display, 'Orbitron', monospace); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.12em; color: var(--primary, #00e5ff);">TRACKING SETTINGS</span>
                <button id="tsp-close" style="background: none; border: none; color: #888; cursor: pointer; font-size: 18px; line-height: 1; padding: 0 4px;" aria-label="Close">&times;</button>
            </div>

            <!-- Camera -->
            <div class="tsp-section">
                <div class="tsp-label">Camera</div>
                <select id="tsp-camera-select" class="tsp-select">
                    <option value="">Default Camera</option>
                </select>
            </div>

            <!-- Background / Flip -->
            <div class="tsp-section">
                <div class="tsp-row">
                    <span>Flip</span>
                    <label class="tsp-switch">
                        <input type="checkbox" id="tsp-flip" ${_settings.flip ? 'checked' : ''}>
                        <span class="tsp-slider"></span>
                    </label>
                </div>
            </div>

            <!-- Hand Tracking -->
            <div class="tsp-section">
                <div class="tsp-label">Avatar Movement</div>
                <div class="tsp-row">
                    <span>Hand Tracking</span>
                    <label class="tsp-switch">
                        <input type="checkbox" id="tsp-hand-tracking" ${_settings.handTracking ? 'checked' : ''}>
                        <span class="tsp-slider"></span>
                    </label>
                </div>
            </div>

            <!-- Facial Expressions -->
            <div class="tsp-section">
                <div class="tsp-label">Facial Expressions</div>
                <div class="tsp-row">
                    <span>Overwrite facial expressions</span>
                    <label class="tsp-switch">
                        <input type="checkbox" id="tsp-overwrite-expr" ${_settings.overwriteExpressions ? 'checked' : ''}>
                        <span class="tsp-slider"></span>
                    </label>
                </div>
            </div>

            <!-- Eye Direction -->
            <div class="tsp-section">
                <div class="tsp-label">Eye Direction</div>
                <div class="tsp-row">
                    <span>Look at camera</span>
                    <label class="tsp-switch">
                        <input type="checkbox" id="tsp-look-at-camera" ${_settings.lookAtCamera ? 'checked' : ''}>
                        <span class="tsp-slider"></span>
                    </label>
                </div>
            </div>

            <!-- Emotion Presets -->
            <div class="tsp-section">
                <div class="tsp-label">Emotion</div>
                <div id="tsp-emotions" class="tsp-emotion-grid">
                    <button class="tsp-emotion-btn${_settings.emotion === 'neutral' ? ' active' : ''}" data-emotion="neutral">Neutral</button>
                    <button class="tsp-emotion-btn${_settings.emotion === 'happy' ? ' active' : ''}" data-emotion="happy">Fun</button>
                    <button class="tsp-emotion-btn${_settings.emotion === 'sad' ? ' active' : ''}" data-emotion="sad">Sorrow</button>
                    <button class="tsp-emotion-btn${_settings.emotion === 'angry' ? ' active' : ''}" data-emotion="angry">Angry</button>
                    <button class="tsp-emotion-btn${_settings.emotion === 'joy' ? ' active' : ''}" data-emotion="joy">Joy</button>
                </div>
            </div>

            <!-- Eye Blink -->
            <div class="tsp-section">
                <div class="tsp-label">Eye</div>
                <div class="tsp-row" style="gap: 8px;">
                    <button class="tsp-blink-btn" id="tsp-blink-right">Blink (right)</button>
                    <button class="tsp-blink-btn" id="tsp-blink-left">Blink (left)</button>
                </div>
            </div>

            <!-- User Definition -->
            <div class="tsp-section" style="border-bottom: none;">
                <div class="tsp-label">User Definition</div>
                <button class="tsp-emotion-btn" id="tsp-surprised" data-emotion="surprised">Surprised</button>
            </div>
        `;
    }

    // ── Event Wiring ─────────────────────────────────────────────────────

    function _wireEvents(panel) {
        // Close button
        panel.querySelector('#tsp-close').addEventListener('click', hide);

        // Camera selector
        panel.querySelector('#tsp-camera-select').addEventListener('change', function (e) {
            _settings.cameraDeviceId = e.target.value;
            _saveSettings(_settings);
            _applyCameraSwitch();
        });

        // Flip
        panel.querySelector('#tsp-flip').addEventListener('change', function (e) {
            _settings.flip = e.target.checked;
            _saveSettings(_settings);
            _applyFlip();
        });

        // Hand tracking toggle
        panel.querySelector('#tsp-hand-tracking').addEventListener('change', function (e) {
            _settings.handTracking = e.target.checked;
            _saveSettings(_settings);
            _applyHandTracking();
        });

        // Overwrite expressions
        panel.querySelector('#tsp-overwrite-expr').addEventListener('change', function (e) {
            _settings.overwriteExpressions = e.target.checked;
            _saveSettings(_settings);
            _applyOverwriteExpressions();
        });

        // Look at camera
        panel.querySelector('#tsp-look-at-camera').addEventListener('change', function (e) {
            _settings.lookAtCamera = e.target.checked;
            _saveSettings(_settings);
            _applyLookAtCamera();
        });

        // Emotion buttons
        panel.querySelector('#tsp-emotions').addEventListener('click', function (e) {
            const btn = e.target.closest('.tsp-emotion-btn');
            if (!btn) return;
            const emotion = btn.dataset.emotion;
            _settings.emotion = emotion;
            _saveSettings(_settings);
            _applyEmotion(emotion);
            // Update active state
            panel.querySelectorAll('#tsp-emotions .tsp-emotion-btn').forEach(function (b) {
                b.classList.toggle('active', b.dataset.emotion === emotion);
            });
        });

        // Surprised (user definition)
        panel.querySelector('#tsp-surprised').addEventListener('click', function () {
            _applyEmotion('surprised');
        });

        // Blink buttons
        panel.querySelector('#tsp-blink-right').addEventListener('mousedown', function () {
            _triggerBlink('right');
        });
        panel.querySelector('#tsp-blink-right').addEventListener('mouseup', function () {
            _releaseBlink('right');
        });
        panel.querySelector('#tsp-blink-right').addEventListener('mouseleave', function () {
            _releaseBlink('right');
        });
        panel.querySelector('#tsp-blink-right').addEventListener('touchstart', function (e) {
            e.preventDefault();
            _triggerBlink('right');
        });
        panel.querySelector('#tsp-blink-right').addEventListener('touchend', function () {
            _releaseBlink('right');
        });

        panel.querySelector('#tsp-blink-left').addEventListener('mousedown', function () {
            _triggerBlink('left');
        });
        panel.querySelector('#tsp-blink-left').addEventListener('mouseup', function () {
            _releaseBlink('left');
        });
        panel.querySelector('#tsp-blink-left').addEventListener('mouseleave', function () {
            _releaseBlink('left');
        });
        panel.querySelector('#tsp-blink-left').addEventListener('touchstart', function (e) {
            e.preventDefault();
            _triggerBlink('left');
        });
        panel.querySelector('#tsp-blink-left').addEventListener('touchend', function () {
            _releaseBlink('left');
        });

        // Close on outside click
        document.addEventListener('click', function (e) {
            if (!_visible) return;
            if (_panelEl && !_panelEl.contains(e.target) && !e.target.closest('#tracking-settings-btn')) {
                hide();
            }
        });
    }

    // ── Action Handlers ──────────────────────────────────────────────────

    async function _refreshCameraDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            _cameraDevices = devices.filter(function (d) {
                return d.kind === 'videoinput';
            });

            const select = _panelEl?.querySelector('#tsp-camera-select');
            if (!select) return;

            // Keep the default option
            select.innerHTML = '<option value="">Default Camera</option>';

            _cameraDevices.forEach(function (device, i) {
                const opt = document.createElement('option');
                opt.value = device.deviceId;
                opt.textContent = device.label || 'Camera ' + (i + 1) + ' (' + device.deviceId.slice(0, 8) + ')';
                if (device.deviceId === _settings.cameraDeviceId) opt.selected = true;
                select.appendChild(opt);
            });
        } catch (err) {
            console.warn('[TrackingSettingsPanel] Failed to enumerate cameras:', err.message);
        }
    }

    function _applyCameraSwitch() {
        const ft = global.NEXUS_FACE_TRACKER;
        if (!ft || !ft.isActive) return;

        // Restart with new device
        ft.stop();
        setTimeout(function () {
            ft.start({ deviceId: _settings.cameraDeviceId || undefined });
        }, 300);
    }

    function _applyFlip() {
        const ft = global.NEXUS_FACE_TRACKER;
        if (ft?.setFlipped) {
            ft.setFlipped(_settings.flip);
        }
    }

    function _applyHandTracking() {
        const ht = global.NEXUS_HAND_TRACKER;
        if (!ht) return;

        if (_settings.handTracking) {
            ht.start().catch(function (err) {
                console.warn('[TrackingSettingsPanel] Hand tracking failed:', err.message);
                _settings.handTracking = false;
                _saveSettings(_settings);
                var checkbox = _panelEl?.querySelector('#tsp-hand-tracking');
                if (checkbox) checkbox.checked = false;
            });
        } else {
            ht.stop();
        }
    }

    function _applyOverwriteExpressions() {
        const ft = global.NEXUS_FACE_TRACKER;
        if (ft?.setOverwriteExpressions) {
            ft.setOverwriteExpressions(_settings.overwriteExpressions);
        }
    }

    function _applyLookAtCamera() {
        const ft = global.NEXUS_FACE_TRACKER;
        if (ft?.setLookAtCamera) {
            ft.setLookAtCamera(_settings.lookAtCamera);
        }
    }

    function _applyEmotion(emotion) {
        // If overwrite is ON (camera driving expressions), disable it for manual emotions
        if (_settings.overwriteExpressions && global.NEXUS_FACE_TRACKER?.isActive) {
            // Skip — camera is driving expressions
            return;
        }

        const em = _getExpressionManager();
        if (!em) return;

        // Clear all emotions first
        var emotionNames = ['happy', 'sad', 'angry', 'surprised', 'neutral'];
        for (var i = 0; i < emotionNames.length; i++) {
            try {
                em.setValue(emotionNames[i], 0);
            } catch (_) {}
        }

        // Apply selected emotion
        if (emotion !== 'neutral') {
            var vrmName = emotion;
            if (emotion === 'joy') vrmName = 'happy';
            try {
                em.setValue(vrmName, 0.8);
            } catch (_) {}
        }
    }

    function _triggerBlink(eye) {
        const em = _getExpressionManager();
        if (!em) return;

        try {
            if (eye === 'right') {
                em.setValue('blinkRight', 1.0);
            } else if (eye === 'left') {
                em.setValue('blinkLeft', 1.0);
            }
        } catch (_) {
            // Fallback to combined blink
            try {
                em.setValue('blink', 1.0);
            } catch (_e) {}
        }
    }

    function _releaseBlink(eye) {
        const em = _getExpressionManager();
        if (!em) return;

        try {
            if (eye === 'right') {
                em.setValue('blinkRight', 0);
            } else if (eye === 'left') {
                em.setValue('blinkLeft', 0);
            }
        } catch (_) {
            try {
                em.setValue('blink', 0);
            } catch (_e) {}
        }
    }

    function _getExpressionManager() {
        var viewer = global.NEXUS_VIEWER;
        var vrm = viewer?.avatarManager?._currentVRM;
        return vrm?.expressionManager || null;
    }

    // ── Show / Hide ──────────────────────────────────────────────────────

    function show() {
        _createPanel();
        _panelEl.style.display = 'block';
        _visible = true;
        _refreshCameraDevices();
    }

    function hide() {
        if (_panelEl) _panelEl.style.display = 'none';
        _visible = false;
    }

    function toggle() {
        if (_visible) hide();
        else show();
    }

    // ── Apply saved settings on FaceTracker start ────────────────────────

    global.addEventListener('facetracker-started', function () {
        // Apply all saved settings when tracking starts
        _applyFlip();
        _applyOverwriteExpressions();
        _applyLookAtCamera();

        // Auto-start hand tracking if enabled in settings
        if (_settings.handTracking) {
            // Wait for webcam to stabilize before starting hand detection
            setTimeout(function () {
                _applyHandTracking();
            }, 800);
        }

        // Refresh camera list (now we have permission)
        setTimeout(function () {
            _refreshCameraDevices();
        }, 200);
    });

    // Also listen for webcam-ready event (more reliable timing)
    global.addEventListener('facetracker-webcam-ready', function () {
        // Refresh camera devices now that permissions are granted
        setTimeout(function () {
            _refreshCameraDevices();
        }, 100);
    });

    global.addEventListener('facetracker-stopped', function () {
        // Stop hand tracking when face tracking stops
        if (global.NEXUS_HAND_TRACKER?.isActive) {
            global.NEXUS_HAND_TRACKER.stop();
        }
    });

    // ── Inject Styles ────────────────────────────────────────────────────

    function _injectStyles() {
        if (document.getElementById('tsp-styles')) return;

        const style = document.createElement('style');
        style.id = 'tsp-styles';
        style.textContent = `
            #tracking-settings-panel .tsp-section {
                padding: 10px 16px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            }
            #tracking-settings-panel .tsp-label {
                font-size: 0.65rem;
                font-weight: 700;
                letter-spacing: 0.1em;
                text-transform: uppercase;
                color: rgba(255, 255, 255, 0.45);
                margin-bottom: 8px;
            }
            #tracking-settings-panel .tsp-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 0.82rem;
                margin-bottom: 4px;
            }
            #tracking-settings-panel .tsp-select {
                width: 100%;
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                color: #e0e0e0;
                padding: 6px 10px;
                font-size: 0.8rem;
                font-family: inherit;
                outline: none;
                cursor: pointer;
            }
            #tracking-settings-panel .tsp-select:focus {
                border-color: var(--primary, #00e5ff);
            }
            #tracking-settings-panel .tsp-select option {
                background: #1a2432;
                color: #e0e0e0;
            }

            /* Toggle switch */
            #tracking-settings-panel .tsp-switch {
                position: relative;
                display: inline-block;
                width: 36px;
                height: 20px;
                flex-shrink: 0;
            }
            #tracking-settings-panel .tsp-switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }
            #tracking-settings-panel .tsp-slider {
                position: absolute;
                cursor: pointer;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(255, 255, 255, 0.12);
                border-radius: 20px;
                transition: 0.2s;
            }
            #tracking-settings-panel .tsp-slider::before {
                content: '';
                position: absolute;
                height: 16px;
                width: 16px;
                left: 2px;
                bottom: 2px;
                background: #aaa;
                border-radius: 50%;
                transition: 0.2s;
            }
            #tracking-settings-panel .tsp-switch input:checked + .tsp-slider {
                background: var(--primary, #00e5ff);
            }
            #tracking-settings-panel .tsp-switch input:checked + .tsp-slider::before {
                transform: translateX(16px);
                background: #fff;
            }

            /* Emotion grid */
            #tracking-settings-panel .tsp-emotion-grid {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
            }
            #tracking-settings-panel .tsp-emotion-btn {
                flex: 1 1 auto;
                min-width: 55px;
                padding: 5px 10px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                background: rgba(255, 255, 255, 0.04);
                color: #ccc;
                font-size: 0.75rem;
                font-family: inherit;
                cursor: pointer;
                transition: all 0.15s;
                text-align: center;
            }
            #tracking-settings-panel .tsp-emotion-btn:hover {
                background: rgba(0, 229, 255, 0.08);
                border-color: rgba(0, 229, 255, 0.3);
                color: #fff;
            }
            #tracking-settings-panel .tsp-emotion-btn.active {
                background: rgba(0, 229, 255, 0.15);
                border-color: var(--primary, #00e5ff);
                color: var(--primary, #00e5ff);
            }

            /* Blink buttons */
            #tracking-settings-panel .tsp-blink-btn {
                flex: 1;
                padding: 6px 10px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                background: rgba(255, 255, 255, 0.04);
                color: #ccc;
                font-size: 0.75rem;
                font-family: inherit;
                cursor: pointer;
                transition: all 0.1s;
                text-align: center;
                user-select: none;
                -webkit-user-select: none;
            }
            #tracking-settings-panel .tsp-blink-btn:active {
                background: rgba(0, 229, 255, 0.2);
                border-color: var(--primary, #00e5ff);
            }

            /* Mobile responsive */
            @media (max-width: 640px) {
                #tracking-settings-panel {
                    right: 8px !important;
                    left: 8px !important;
                    width: auto !important;
                    top: 50px !important;
                    max-height: calc(100vh - 60px) !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // ── Init ─────────────────────────────────────────────────────────────

    _injectStyles();

    global.NEXUS_TRACKING_PANEL = {
        show: show,
        hide: hide,
        toggle: toggle,
        get isVisible() {
            return _visible;
        },
        getSettings: function () {
            return { ..._settings };
        },
    };

    console.log('[TrackingSettingsPanel] Initialized');
})(window);
