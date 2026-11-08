/**
 * AX9. The Quality Lab site's data stays honest: every run file is schema 1, listed in the index,
 * free of token-like strings, and scored by the scorer as it is today — so a scorer change cannot
 * land without its rescoring (`node tools/qa/lab-publish.mjs --rescore-all`).
 */
const fs = require('fs');
const path = require('path');
const S = require('../tools/qa/CharacterQualityScorer.js');

const DATA = path.join(__dirname, '..', 'quality-lab', 'data');
const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
const files = fs.readdirSync(path.join(DATA, 'runs')).filter((f) => f.endsWith('.json'));
const docs = files.map((f) => [f, JSON.parse(fs.readFileSync(path.join(DATA, 'runs', f), 'utf8'))]);

describe('Quality Lab data', () => {
    test('the index lists exactly the run files, newest first', () => {
        expect(index.schema).toBe(1);
        expect(index.runs.map((r) => r.file).sort()).toEqual(files.map((f) => `runs/${f}`).sort());
        const dates = index.runs.map((r) => r.date);
        expect([...dates].sort().reverse()).toEqual(dates);
    });

    test.each(docs)('%s is schema 1 and well-formed', (file, doc) => {
        expect(doc.schema).toBe(1);
        expect(`${doc.id}.json`).toBe(file);
        expect(doc.harness).toBe('tools/qa/character-lab.mjs');
        expect(Array.isArray(doc.humanReview)).toBe(true);
        for (const r of doc.runs) {
            expect(['en', 'it']).toContain(r.lang);
            expect(Array.isArray(r.servedModels)).toBe(true);
            // the route name is never stood in for an unreported served model
            for (const t of r.turns) expect(t.servedModels).not.toContain(r.route);
        }
    });

    test.each(docs)('%s carries no token-like string', (file) => {
        const text = fs.readFileSync(path.join(DATA, 'runs', file), 'utf8');
        expect(text).not.toMatch(/[A-Za-z0-9_-]{40,}/);
    });

    test.each(docs)('%s is scored by the current scorer', (file, doc) => {
        for (const r of doc.runs) {
            const previous = [];
            for (const t of r.turns) {
                const s = S.score(t.reply || '', {
                    lang: r.lang,
                    maxSentences: 4,
                    askedAboutAI: t.id === 'truth',
                    previous: previous.slice(),
                });
                if (t.reply) previous.push(t.reply);
                expect({ id: t.id, score: t.score, flags: t.flags }).toEqual({
                    id: t.id,
                    score: s.score,
                    flags: s.flags,
                });
            }
            const mean = Math.round(r.turns.reduce((a, t) => a + t.score, 0) / r.turns.length);
            expect(r.summary.meanScore).toBe(mean);
        }
    });

    test('the page draws model text as text, never as HTML', () => {
        const js = fs.readFileSync(path.join(__dirname, '..', 'quality-lab', 'lab.js'), 'utf8');
        expect(js).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
    });
});
