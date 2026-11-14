/**
 * MO12. Pose Studio holds the chat motion stack. Measured by the motion audit: after a chat
 * gesture, picking "sitting" in Pose Studio held for ~1.6 s, then the motion stack's queued idle
 * (neutral2.bvh) stood her back up. The browser proof is audits/motion/run.mjs (poses after
 * phrases); these pin the contract so it cannot quietly come apart.
 */
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

describe('MO12: Pose Studio holds the body against the chat idle', () => {
    test('entering and leaving pose mode tells NEXUS_MOTION to hold and release', () => {
        const s = read('src/PoseStudioPanel.js');
        const enter = s.slice(s.indexOf('prototype._enterPoseMode'), s.indexOf('prototype._exitPoseMode'));
        const exit = s.slice(s.indexOf('prototype._exitPoseMode'), s.indexOf('prototype.show'));
        expect(enter).toMatch(/NEXUS_MOTION\?\.holdForPoseStudio\?\.\(true\)/);
        expect(exit).toMatch(/NEXUS_MOTION\?\.holdForPoseStudio\?\.\(false\)/);
    });

    test('while held, no idle is scheduled and the settle-back blend does not run', () => {
        const s = read('src/xr/MotionIntegration.js');
        const sched = s.slice(s.indexOf('function _scheduleIdle'), s.indexOf('function _scheduleIdle') + 200);
        expect(sched).toMatch(/if \(_heldByPoseStudio\) return;/);
        expect(s).toMatch(/!_heldByPoseStudio && pr && pr\.isBlending/);
        expect(s).toMatch(/holdForPoseStudio,/);
    });

    test('holding also ends following and walking, so the walk cycle cannot drive the pose', () => {
        const s = read('src/xr/MotionIntegration.js');
        const hold = s.slice(s.indexOf('function holdForPoseStudio'), s.indexOf('function _scheduleIdle'));
        expect(hold).toMatch(/_follow\.active = false/);
        expect(hold).toMatch(/forceStop/);
        expect(hold).toMatch(/_stopWalk\(false\)/);
    });
});
