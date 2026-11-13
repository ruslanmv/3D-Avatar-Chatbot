/**
 * PX12. A pairing code copied from the OllaBridge page fits in the box whole, however it arrives.
 *
 * The box held 9 characters ("ODHL-0189"); a copy with a space or a line break around it was cut
 * short before Pair was pressed, and a valid code was refused as "Invalid pairing code". The page
 * markup is read as the browser reads it; the tidy-up is read from `main.js`, where it is wired.
 */
/* global describe, test, expect */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');

describe('the OllaBridge pairing code box', () => {
    test('holds a copied code with room to spare', () => {
        const input = /<input[^>]*id="ollabridge-pair-code"[^>]*>/s.exec(html);
        expect(input).not.toBeNull();
        const max = /maxlength="(\d+)"/.exec(input[0]);
        // The longest form the cloud page offers is "XXXX-XXXX"; a copy adds spaces or a newline.
        expect(max === null || Number(max[1]) >= 16).toBe(true);
    });

    test('what arrives is tidied as it arrives, and the code sent has no dash or space', () => {
        expect(main).toMatch(/box\.addEventListener\('input'/);
        expect(main).toMatch(/replace\(\/\\s\+\/g, ''\)\.toUpperCase\(\)/);
        const llm = fs.readFileSync(path.join(root, 'src/LLMManager.js'), 'utf8');
        expect(llm).toMatch(/\.replace\(\/-\/g, ''\)/);
    });
});
