#!/usr/bin/env node
/**
 * Test: VR Chat Panel Hitbox Mode Isolation
 *
 * Validates that hitboxes are properly tagged with their mode and that
 * the interaction system only raycasts against active-mode interactables.
 *
 * This prevents the "ghost click" bug where buttons from hidden tabs
 * (e.g. settings buttons) respond to laser pointer input in the chat tab.
 *
 * Industry references:
 * - Meta Interaction SDK: InteractableGroup enable/disable pattern
 * - SteamVR: UIInteractableModule active/inactive filtering
 * - Unity UI: Canvas.enabled gates all child raycasts
 *
 * Usage:  node tests/test-vr-panel-hitboxes.cjs
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function log(status, msg) {
    const icon = status === 'PASS' ? '\x1b[32m✓\x1b[0m' : status === 'FAIL' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m→\x1b[0m';
    console.log(`  ${icon} ${msg}`);
    if (status === 'PASS') passed++;
    if (status === 'FAIL') failed++;
}

// ─── VRChatPanel Tests ───────────────────────────────────────

function testHitboxModeTags() {
    console.log('\n--- Hitbox Mode Tags (VRChatPanel.js) ---');
    const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'gltf-viewer', 'VRChatPanel.js'), 'utf8');

    // _makeHitbox should set default mode = 'global'
    log(code.includes("mesh.userData.mode = 'global'") ? 'PASS' : 'FAIL',
        '_makeHitbox sets default mode tag to "global"');

    // Count mode tags in the _createHitboxes function (between _createHitboxes and _makeHitbox)
    const hitboxFnStart = code.indexOf('_createHitboxes()');
    const hitboxFnEnd = code.indexOf('_makeHitbox(name, rect');
    const hitboxFn = code.substring(hitboxFnStart, hitboxFnEnd);

    // Chat layer buttons must be tagged 'chat'
    const chatModeTags = (hitboxFn.match(/\.userData\.mode\s*=\s*'chat'/g) || []).length;
    log(chatModeTags >= 4 ? 'PASS' : 'FAIL',
        `Chat layer hitboxes tagged with mode="chat" (found ${chatModeTags} tags, need ≥4)`);

    // Controls layer buttons must be tagged 'controls'
    const ctrlModeTags = (hitboxFn.match(/\.userData\.mode\s*=\s*'controls'/g) || []).length;
    log(ctrlModeTags >= 4 ? 'PASS' : 'FAIL',
        `Controls layer hitboxes tagged with mode="controls" (found ${ctrlModeTags} tags, need ≥4)`);

    // Settings layer buttons must be tagged 'settings'
    const setModeTags = (hitboxFn.match(/\.userData\.mode\s*=\s*'settings'/g) || []).length;
    log(setModeTags >= 4 ? 'PASS' : 'FAIL',
        `Settings layer hitboxes tagged with mode="settings" (found ${setModeTags} tags, need ≥4)`);

    // Handle (always-visible) should keep default 'global'
    log(!hitboxFn.includes("handle.userData.mode = 'chat'") ? 'PASS' : 'FAIL',
        'Handle hitbox keeps default "global" mode (always active)');
}

function testGetActiveInteractables() {
    console.log('\n--- getActiveInteractables Method ---');
    const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'gltf-viewer', 'VRChatPanel.js'), 'utf8');

    log(code.includes('getActiveInteractables()') ? 'PASS' : 'FAIL',
        'getActiveInteractables() method exists');

    // Must filter by mode tag
    log(code.includes("mTag === 'global' || mTag === mode") ? 'PASS' : 'FAIL',
        'getActiveInteractables filters: global OR current mode');
}

function testModeChangeCallback() {
    console.log('\n--- Mode Change Callback ---');
    const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'gltf-viewer', 'VRChatPanel.js'), 'utf8');

    // setMode should invoke onModeChanged callback
    const setModeBlock = code.substring(
        code.indexOf('setMode(mode)'),
        code.indexOf('setStatus(status)')
    );
    log(setModeBlock.includes('this.onModeChanged') ? 'PASS' : 'FAIL',
        'setMode() invokes onModeChanged callback after mode switch');
}

function testHandleUIActionModeGuard() {
    console.log('\n--- handleUIAction Mode Guard (defense-in-depth) ---');
    const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'gltf-viewer', 'VRChatPanel.js'), 'utf8');

    const fnStart = code.indexOf('handleUIAction(name, userData');
    const fnBlock = code.substring(fnStart, fnStart + 600);

    // Must check hitMode against current mode before executing
    log(fnBlock.includes('hitMode') && fnBlock.includes('this.mode') ? 'PASS' : 'FAIL',
        'handleUIAction checks hitbox mode against current panel mode');

    log(fnBlock.includes("hitMode !== 'global'") ? 'PASS' : 'FAIL',
        'handleUIAction allows global hitboxes through mode guard');

    log(fnBlock.includes('return false') ? 'PASS' : 'FAIL',
        'handleUIAction rejects mismatched-mode hits (returns false)');
}

// ─── VRControllers Tests ─────────────────────────────────────

function testActiveUIInteractables() {
    console.log('\n--- Active UI Interactables (VRControllers.js) ---');
    const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'gltf-viewer', 'VRControllers.js'), 'utf8');

    log(code.includes('_activeUIInteractables') ? 'PASS' : 'FAIL',
        '_activeUIInteractables field exists');

    log(code.includes('updateActiveUI(') ? 'PASS' : 'FAIL',
        'updateActiveUI() method exists');

    // All three raycast sites must use _activeUIInteractables.
    // Use method definitions (not call sites) by searching for the function signature pattern.
    const triggerDefn = code.indexOf('_onTriggerDown(controller, _hand)');
    const triggerEnd = code.indexOf('_onTriggerUp(', triggerDefn);
    const triggerBlock = code.substring(triggerDefn, triggerEnd);
    log(triggerBlock.includes('this._activeUIInteractables') ? 'PASS' : 'FAIL',
        '_onTriggerDown raycasts against _activeUIInteractables (not full list)');

    const hoverDefn = code.indexOf('_updateUIHover()');
    const hoverEnd = code.indexOf('// ====', hoverDefn + 20);
    const hoverBlock = code.substring(hoverDefn, hoverEnd);
    log(hoverBlock.includes('this._activeUIInteractables') ? 'PASS' : 'FAIL',
        '_updateUIHover raycasts against _activeUIInteractables (not full list)');

    // Grip handler also uses active list — find the method definition (indented with spaces)
    const gripDefn = code.indexOf('    _onGripDown(controller, hand)');
    const gripEnd = code.indexOf('    _onGripUp(', gripDefn + 30);
    const gripBlock = code.substring(gripDefn, gripEnd);
    log(gripBlock.includes('this._activeUIInteractables') ? 'PASS' : 'FAIL',
        '_onGripDown raycasts against _activeUIInteractables (not full list)');

    // registerUIInteractables should also set _activeUIInteractables
    const regBlock = code.substring(
        code.indexOf('registerUIInteractables('),
        code.indexOf('registerUIInteractables(') + 300
    );
    log(regBlock.includes('this._activeUIInteractables = interactables') ? 'PASS' : 'FAIL',
        'registerUIInteractables initializes _activeUIInteractables');
}

function testNoStaleRaycasts() {
    console.log('\n--- No Stale Raycasts (VRControllers.js) ---');
    const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'gltf-viewer', 'VRControllers.js'), 'utf8');

    // Make sure uiInteractables is NOT used directly in raycast calls anymore
    // (except in registerUIInteractables and the field declaration)
    const raycastCalls = code.match(/intersectObjects\(this\.uiInteractables/g) || [];
    log(raycastCalls.length === 0 ? 'PASS' : 'FAIL',
        `No direct raycasts against this.uiInteractables (found ${raycastCalls.length}, want 0)`);
}

// ─── VRChatIntegration Tests ─────────────────────────────────

function testIntegrationWiring() {
    console.log('\n--- Integration Wiring (VRChatIntegration.js) ---');
    const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'gltf-viewer', 'VRChatIntegration.js'), 'utf8');

    // Must call updateActiveUI on init
    log(code.includes('updateActiveUI') ? 'PASS' : 'FAIL',
        'VRChatIntegration calls updateActiveUI');

    // Must set onModeChanged callback
    log(code.includes('onModeChanged') ? 'PASS' : 'FAIL',
        'VRChatIntegration hooks onModeChanged callback');

    // Must call getActiveInteractables
    log(code.includes('getActiveInteractables()') ? 'PASS' : 'FAIL',
        'VRChatIntegration calls getActiveInteractables() for mode-filtered list');
}

// ─── Main ────────────────────────────────────────────────────

function main() {
    console.log('==============================================');
    console.log(' VR Panel Hitbox Mode Isolation Tests');
    console.log(' (Meta/SteamVR best practices)');
    console.log('==============================================');

    testHitboxModeTags();
    testGetActiveInteractables();
    testModeChangeCallback();
    testHandleUIActionModeGuard();
    testActiveUIInteractables();
    testNoStaleRaycasts();
    testIntegrationWiring();

    console.log('\n==============================================');
    console.log(` Results: \x1b[32m${passed} passed\x1b[0m, \x1b[${failed > 0 ? '31' : '32'}m${failed} failed\x1b[0m`);
    console.log('==============================================\n');

    process.exit(failed > 0 ? 1 : 0);
}

main();
