/**
 * desktop-shell/main.js — Optional Electron wrapper (Level 2 companion).
 *
 * Loads the UNMODIFIED web app in a transparent, frameless, always-on-top,
 * click-through window so the avatar floats directly over your real desktop —
 * the true "Your Mother"-style desktop pet, with chat / TTS / lip-sync intact
 * because it is literally the same app.
 *
 * This folder is fully additive: it is NOT part of the web build and changes
 * nothing in the web app. Run it separately.
 *
 *   # Point it at the live site (default):
 *   npm install && npm start
 *
 *   # Or at a local dev server:
 *   APP_URL="http://localhost:8080/?mode=companion" npm start
 *
 * Click-through is on by default so clicks pass to the app behind the avatar.
 * The web app can request pointer capture for the avatar itself via the
 * `set-interactive` IPC channel (raycast under the cursor → toggle) — the
 * standard desktop-pet pattern. Toggle click-through globally with the tray-
 * free shortcut Ctrl/Cmd+Shift+I (see below), or quit with Ctrl/Cmd+Q.
 */
'use strict';

const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');

/**
 * Which deployment this shell opens. Resolution order:
 *   1. APP_URL env var          — dev / testing override
 *   2. app-config.json (bundled) — set at BUILD time, so a downloaded installer
 *                                  points at whichever deployment you shipped
 *   3. the public production site
 *
 * NOTE: the target must be publicly reachable. A Vercel *preview* URL with
 * Deployment Protection enabled redirects to vercel.com/login, so the shell
 * would show a login page instead of the avatar — use the production domain
 * or disable protection for that deployment.
 */
function resolveAppUrl() {
    if (process.env.APP_URL) return process.env.APP_URL;
    try {
        const cfgPath = require('path').join(__dirname, 'app-config.json');
        const cfg = JSON.parse(require('fs').readFileSync(cfgPath, 'utf8'));
        if (cfg.appUrl) return cfg.appUrl;
    } catch (_) {
        /* no bundled config — fall through */
    }
    return 'https://www.yourfriend.online/?mode=companion';
}

const APP_URL = resolveAppUrl();

let win = null;
let clickThrough = true;

function createWindow() {
    const { width } = screen.getPrimaryDisplay().workAreaSize;

    win = new BrowserWindow({
        width: 360,
        height: 520,
        x: width - 400, // park near the right edge by default
        y: 80,
        transparent: true,
        frame: false,
        resizable: true,
        hasShadow: false,
        alwaysOnTop: true,
        skipTaskbar: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // Float above full-screen apps too (editors, browsers) on all platforms.
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Click-through: pointer events fall through to the app behind, but the
    // renderer still receives move events (forward:true) so the avatar can gaze.
    win.setIgnoreMouseEvents(clickThrough, { forward: true });

    win.loadURL(APP_URL);
}

// The web app calls this over IPC when the cursor is over the avatar (raycast
// hit) so clicks land on it, and releases when the cursor leaves.
ipcMain.on('set-interactive', (_evt, interactive) => {
    if (!win) return;
    win.setIgnoreMouseEvents(!interactive, { forward: true });
});

app.whenReady().then(() => {
    createWindow();

    // Manual global toggle for click-through (handy while positioning).
    globalShortcut.register('CommandOrControl+Shift+I', () => {
        clickThrough = !clickThrough;
        win?.setIgnoreMouseEvents(clickThrough, { forward: true });
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
