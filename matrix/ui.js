(function () {
    const $ = (sel) => document.querySelector(sel);

    const els = {
        rain: $('#matrixRain'),
        avatar: $('#avatarViz'), // Reverted to internal ID
        messages: $('#messages'),
        input: $('#input'),
        sendBtn: $('#sendBtn'),
        micBtn: $('#micBtn'),
        personaSelect: $('#personaSelect'),
        stateText: $('#stateText'),
        statePill: $('#statePill'),
        autoSpeak: $('#autoSpeakToggle'),
        toast: $('#toast'),
        clearBtn: $('#clearBtn'),
        settingsBtn: $('#settingsBtn'),
        settingsModal: $('#settingsModal'),
        modalBackdrop: $('#modalBackdrop'),
        closeSettings: $('#closeSettings'),
        apiKey: $('#apiKey'),
        model: $('#model'),
        saveSettings: $('#saveSettings'),
    };

    // ---------- Matrix rain background ----------
    function startMatrixRain() {
        const canvas = els.rain;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: true });

        const glyphs = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789$#@%*&+-';

        let w = 0,
            h = 0,
            cols = 0;
        let drops = [];

        // --- knobs you can tweak ---
        const TARGET_FPS = 22; // lower = slower
        const FRAME_MS = 1000 / TARGET_FPS;
        const SPEED_MUL = 0.45; // lower = slower
        const FADE_ALPHA = 0.045; // lower = longer trails

        function resize() {
            const dpr = Math.max(1, window.devicePixelRatio || 1);
            w = canvas.width = Math.floor(window.innerWidth * dpr);
            h = canvas.height = Math.floor(window.innerHeight * dpr);
            canvas.style.width = window.innerWidth + 'px';
            canvas.style.height = window.innerHeight + 'px';

            const fontSize = Math.floor(16 * dpr);
            ctx.font = `${fontSize}px ui-monospace`;
            cols = Math.floor(w / fontSize);

            drops = new Array(cols).fill(0).map(() => Math.random() * h);

            canvas._fontSize = fontSize;
            canvas._dpr = dpr;
        }

        function drawFrame() {
            const fontSize = canvas._fontSize || 16;

            ctx.fillStyle = `rgba(0,0,0,${FADE_ALPHA})`;
            ctx.fillRect(0, 0, w, h);

            ctx.fillStyle = 'rgba(0,255,123,0.70)';

            for (let i = 0; i < drops.length; i++) {
                const x = i * fontSize;
                const y = drops[i];
                const ch = glyphs[Math.floor(Math.random() * glyphs.length)];
                ctx.fillText(ch, x, y);

                const base = 0.9 + Math.random() * 0.6;
                drops[i] = y + fontSize * base * SPEED_MUL;

                if (drops[i] > h + Math.random() * 2000) drops[i] = -Math.random() * 800;
            }
        }

        let last = 0;
        function loop(t) {
            if (!last) last = t;
            const dt = t - last;

            if (dt >= FRAME_MS) {
                last = t - (dt % FRAME_MS);
                drawFrame();
            }
            requestAnimationFrame(loop);
        }

        window.addEventListener('resize', resize);
        resize();
        requestAnimationFrame(loop);
    }

    // ---------- Avatar viz (The Internal 2D HUD) ----------
    function startAvatarViz() {
        const canvas = els.avatar;
        if (!canvas) return { setState: () => {} };

        const ctx = canvas.getContext('2d');

        function resize() {
            const rect = canvas.getBoundingClientRect();
            const dpr = Math.max(1, window.devicePixelRatio || 1);
            const size = Math.floor(Math.min(rect.width, rect.height) * dpr);
            canvas.width = size;
            canvas.height = size;
        }

        const state = { value: 'idle', t: 0 };

        function setState(v) {
            state.value = v;
        }

        function draw() {
            const w = canvas.width,
                h = canvas.height;
            const cx = w / 2,
                cy = h / 2;
            const t = (state.t += 0.016);

            // background
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(0, 0, w, h);

            // grid
            ctx.globalAlpha = 0.35;
            ctx.strokeStyle = 'rgba(0,255,123,0.25)';
            ctx.lineWidth = Math.max(1, w * 0.002);
            const step = w / 16;
            for (let x = step; x < w; x += step) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, h);
                ctx.stroke();
            }
            for (let y = step; y < h; y += step) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(w, y);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;

            // main ring
            const pulse =
                state.value === 'thinking'
                    ? 1 + Math.sin(t * 6) * 0.03
                    : state.value === 'listening'
                      ? 1 + Math.sin(t * 10) * 0.05
                      : state.value === 'speaking'
                        ? 1 + Math.sin(t * 12) * 0.04
                        : state.value === 'error'
                          ? 1 + Math.sin(t * 16) * 0.02
                          : 1 + Math.sin(t * 2) * 0.01;

            const R = w * 0.33 * pulse;

            ctx.strokeStyle = 'rgba(0,255,123,0.65)';
            ctx.lineWidth = Math.max(2, w * 0.008);
            ctx.beginPath();
            ctx.arc(cx, cy, R, 0, Math.PI * 2);
            ctx.stroke();

            // inner head outline
            ctx.strokeStyle = 'rgba(0,255,123,0.35)';
            ctx.lineWidth = Math.max(1, w * 0.004);
            ctx.beginPath();
            ctx.ellipse(cx, cy - w * 0.02, w * 0.18, w * 0.22, 0, 0, Math.PI * 2);
            ctx.stroke();

            // eyes
            const eyeY = cy - w * 0.08;
            const eyeX = w * 0.06;
            let eyeGlow =
                state.value === 'listening'
                    ? 0.9
                    : state.value === 'thinking'
                      ? 0.7
                      : state.value === 'speaking'
                        ? 1.0
                        : state.value === 'error'
                          ? 0.25
                          : 0.55;

            ctx.fillStyle = `rgba(0,255,123,${0.15 + eyeGlow * 0.25})`;
            ctx.beginPath();
            ctx.arc(cx - eyeX, eyeY, w * 0.02, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(cx + eyeX, eyeY, w * 0.02, 0, Math.PI * 2);
            ctx.fill();

            // waveform / activity line
            ctx.strokeStyle = 'rgba(0,255,123,0.55)';
            ctx.lineWidth = Math.max(1, w * 0.004);
            ctx.beginPath();
            const y = cy + w * 0.15;
            const amp =
                state.value === 'speaking'
                    ? w * 0.045
                    : state.value === 'thinking'
                      ? w * 0.028
                      : state.value === 'listening'
                        ? w * 0.02
                        : state.value === 'error'
                          ? w * 0.01
                          : w * 0.012;
            for (let x = -w * 0.22; x <= w * 0.22; x += w * 0.01) {
                const nx = x / (w * 0.22);
                const wy = Math.sin(t * 6 + nx * 10) * amp * (0.2 + 0.8 * (1 - Math.abs(nx)));
                const px = cx + x;
                const py = y + wy;
                if (x === -w * 0.22) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();

            // HUD text
            ctx.fillStyle = 'rgba(209,255,224,0.85)';
            ctx.font = `${Math.floor(w * 0.04)}px ui-monospace`;
            ctx.textAlign = 'center';
            ctx.fillText(state.value.toUpperCase(), cx, h - w * 0.08);

            // scanline shimmer
            ctx.globalAlpha = 0.18;
            ctx.fillStyle = 'rgba(0,255,123,0.18)';
            const shimmerY = (t * 90) % h;
            ctx.fillRect(0, shimmerY, w, Math.max(2, w * 0.01));
            ctx.globalAlpha = 1;

            requestAnimationFrame(draw);
        }

        window.addEventListener('resize', resize);
        resize();
        draw();

        return { setState };
    }

    // ---------- Chat rendering ----------
    function formatTime(ts) {
        try {
            const d = new Date(ts);
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
            return '';
        }
    }

    function addMessage({ role, text, ts }) {
        if (!els.messages) return;
        const wrap = document.createElement('div');
        wrap.className = 'msg ' + (role === 'user' ? 'msg--user' : '');
        const meta = document.createElement('div');
        meta.className = 'msg__meta';
        const roleEl = document.createElement('div');
        roleEl.className = 'msg__role';
        roleEl.textContent = role === 'user' ? 'operator' : 'matrix';
        const timeEl = document.createElement('div');
        timeEl.className = 'msg__time';
        timeEl.textContent = formatTime(ts || Date.now());
        meta.appendChild(roleEl);
        meta.appendChild(timeEl);

        const body = document.createElement('div');
        body.className = 'msg__text';
        body.textContent = text;

        wrap.appendChild(meta);
        wrap.appendChild(body);
        els.messages.appendChild(wrap);
        els.messages.scrollTop = els.messages.scrollHeight;
    }

    function setStateUI(value) {
        if (els.stateText) els.stateText.textContent = value;
        if (els.statePill) {
            const dot = els.statePill.querySelector('.dot');
            if (dot) dot.style.opacity = value === 'error' ? '0.35' : '1';
        }
    }

    function toast(text) {
        if (!els.toast) return;
        els.toast.textContent = text || '';
        if (!text) return;
        els.toast.style.opacity = '1';
        window.clearTimeout(toast._t);
        toast._t = window.setTimeout(() => {
            els.toast.style.opacity = '0.0';
        }, 2200);
    }

    // Auto-grow textarea
    function autoGrow() {
        if (!els.input) return;
        els.input.style.height = 'auto';
        els.input.style.height = Math.min(140, els.input.scrollHeight) + 'px';
    }

    // ---------- Settings modal ----------
    function openSettings(settings) {
        if (els.apiKey) els.apiKey.value = settings.apiKey || '';
        if (els.model) els.model.value = settings.model || '';
        if (els.modalBackdrop) els.modalBackdrop.classList.remove('hidden');
        if (els.settingsModal) els.settingsModal.showModal();
    }

    function closeSettings() {
        try {
            els.settingsModal.close();
        } catch {}
        if (els.modalBackdrop) els.modalBackdrop.classList.add('hidden');
    }

    // ---------- Boot ----------
    async function main() {
        startMatrixRain();

        // START INTERNAL AVATAR
        const avatarViz = startAvatarViz();

        const controller = new window.MatrixController(new window.JsFolderAdapter());

        controller.on('message', addMessage);

        // UPDATE INTERNAL AVATAR ON STATE CHANGE
        controller.on('state', ({ value }) => {
            setStateUI(value);
            avatarViz.setState(value);
        });

        controller.on('toast', ({ text }) => toast(text));
        controller.on('error', ({ text }) => toast(text));

        await controller.init();

        // personalities
        const personalities = controller.getPersonalities();
        const current = localStorage.getItem('selected_personality') || 'friendly-kids';
        if (els.personaSelect) {
            els.personaSelect.innerHTML = '';
            for (const [id, p] of Object.entries(personalities)) {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = `${p.icon || ''} ${p.name}`;
                if (id === current) opt.selected = true;
                els.personaSelect.appendChild(opt);
            }
            els.personaSelect.addEventListener('change', (e) => controller.setPersonality(e.target.value));
        }

        // settings
        const settings = controller.getSettings();
        if (els.autoSpeak) {
            els.autoSpeak.checked = !!settings.autoSpeak;
            els.autoSpeak.addEventListener('change', (e) => controller.saveSettings({ autoSpeak: e.target.checked }));
        }

        if (els.clearBtn)
            els.clearBtn.addEventListener('click', () => {
                if (els.messages) els.messages.innerHTML = '';
                controller.clearHistory();
            });

        if (els.settingsBtn) els.settingsBtn.addEventListener('click', () => openSettings(controller.getSettings()));
        if (els.modalBackdrop) els.modalBackdrop.addEventListener('click', closeSettings);
        if (els.closeSettings)
            els.closeSettings.addEventListener('click', (e) => {
                e.preventDefault();
                closeSettings();
            });

        if (els.saveSettings)
            els.saveSettings.addEventListener('click', () => {
                controller.saveSettings({
                    apiKey: els.apiKey.value,
                    model: els.model.value,
                    autoSpeak: els.autoSpeak ? els.autoSpeak.checked : false,
                });
                closeSettings();
            });

        function send() {
            const text = els.input.value.trim();
            if (!text) return;
            els.input.value = '';
            autoGrow();
            controller.sendMessage(text).catch(() => {});
        }

        if (els.sendBtn) els.sendBtn.addEventListener('click', send);

        if (els.input) {
            els.input.addEventListener('input', autoGrow);
            els.input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                }
            });
        }

        // mic
        let micOn = false;
        if (els.micBtn) {
            els.micBtn.addEventListener('click', () => {
                micOn = !micOn;
                if (micOn) {
                    toast('listening…');
                    controller.startVoice();
                } else {
                    controller.stopVoice();
                    toast('stopped');
                }
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }
})();
