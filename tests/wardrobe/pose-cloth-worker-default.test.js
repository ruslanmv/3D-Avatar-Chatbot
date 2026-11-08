const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('default worker message without solver is exactly the legacy correction', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../src/wardrobe/PoseClothWorker.js'), 'utf8');
    const sent = [];
    const correct = jest.fn(() => ({
        garments: [{
            name: 'tee',
            positions: new Float32Array([0, 1, 2]),
            before: { maxPenetrationMm: 1 },
            after: { maxPenetrationMm: 0 },
        }],
    }));
    const sandbox = {
        self: { postMessage: (message) => sent.push(message) },
        importScripts: (...files) => {
            expect(files).toEqual(['PoseClothCorrection.js']);
            sandbox.NEXUS_POSE_CLOTH_CORRECTION = { correct };
        },
        Float32Array,
        Uint8Array,
    };
    vm.runInNewContext(source, sandbox, { filename: 'PoseClothWorker.js' });
    const input = { garments: [{ name: 'tee' }] };
    sandbox.self.onmessage({ data: { id: 27, input } });
    expect(correct).toHaveBeenCalledTimes(1);
    expect(correct).toHaveBeenCalledWith(input);
    expect(sent).toHaveLength(1);
    expect(sent[0].id).toBe(27);
    expect(sent[0].ok).toBe(true);
    expect(sent[0].garments[0].name).toBe('tee');
    expect(sent[0].garments[0].after.maxPenetrationMm).toBe(0);
    expect(sent[0].garments[0].positions).toEqual(new Float32Array([0, 1, 2]));
});
