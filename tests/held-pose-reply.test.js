/**
 * OL2. A reply never moves a body a held position owns. Asked to lie with her knees up, she stood
 * up while speaking and lay down again after (reported 2026-11-19): the reply's mood picked a body
 * clip, and its talk mode overrode the pose. The face may follow the mood; the body may not.
 */
describe('OL2 a held position is not broken by a reply', () => {
    afterEach(() => {
        delete window.vrPoseSystem;
        jest.resetModules();
    });

    test('the procedural talk mode does not take over her body while bones are held', () => {
        window.THREE = require('../vendor/three-0.147.0/build/three.min.js');
        require('../src/ProceduralAnimator.js');
        const api = window.NEXUS_PROCEDURAL_ANIMATOR;
        api.setPoseMode(true);
        window.vrPoseSystem = { isHoldingBones: () => true };
        api.setMode('talk', 30000);
        expect(api.isAnimOverride()).toBe(false);
        window.vrPoseSystem = { isHoldingBones: () => false };
        api.setMode('talk', 30000);
        expect(api.isAnimOverride()).toBe(true);
        api.setPoseMode(false);
    });
});

test('OL2 the behaviour director picks no body clip while a position holds her', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../src/behavior/boot.js'), 'utf8');
    const at = src.indexOf('handleIntent(intent) {');
    const body = src.slice(at, src.indexOf('this.scheduler.request(', at));
    expect(body).toMatch(/isHoldingBones\(\)/);
    expect(body.indexOf('isHoldingBones')).toBeLessThan(body.indexOf('ranker.best'));
});
