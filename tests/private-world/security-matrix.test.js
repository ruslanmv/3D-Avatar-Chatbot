/**
 * PW. The items of docs/qa/PRIVATE_WORLD_SECURITY_MATRIX.md that private-world.test.js and
 * scenarios.test.js do not already hold: a forged browser event (5), a stale await (8),
 * permissions (14), logs (17), reduced motion and exit (18), and tone never changing the world
 * (20). Each test names its matrix number.
 */
const { fs, path, PW, ROOT, flush, setup } = require('./harness.js');
const Reactive = require('../../src/experiences/playgrounds/PlaygroundReactiveContext.js');

const SRC = fs.readFileSync(path.join(ROOT, 'src/experiences/private/PrivateWorldAdapter.js'), 'utf8');
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // comments say what is absent

function deferred() {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
}

describe('PW security matrix — the items not covered elsewhere', () => {
    test('5. a forged nexus-world-request cannot stand in for consent', () => {
        // Anyone can dispatch the event; what it sets is only the renderer's request owner. Private
        // is open only if the activity, the consent flow and private mode are really running too.
        const forged = {
            NEXUS_VIEWER: { _worldRequest: { id: 'private-cabaret', owner: 'intimate' } },
            NEXUS_SPICY: { isEnabled: () => true },
            NEXUS_BD: { intimate: { active: false }, adult: { active: false } },
        };
        expect(Reactive.privateOpenNow(forged)).toBe(false);
        const gate = PW.evaluateGate({
            deployment: true,
            attested: true,
            privateOpen: Reactive.privateOpenNow(forged),
            world: true,
            avatarAdult: true,
        });
        expect(gate).toEqual({ ok: false, why: 'private-experience-not-active' });
        // …and the adapter itself never dispatches a world request: it cannot open a room.
        expect(code).not.toMatch(/nexus-world-request/);
    });

    test('5. the attestation is read as exactly true; a truthy string from a page script is no', () => {
        expect(
            PW.evaluateGate({ deployment: true, attested: 'true', privateOpen: true, world: true, avatarAdult: true })
                .ok
        ).toBe(false);
    });

    test('8. a dance confirmed after the world changed is stale: dropped, never narrated', async () => {
        const s = setup();
        await flush();
        const answer = deferred();
        s.setChip(answer.promise);
        const pending = s.core.act('dance');
        s.rt.activeId = 'private-cabaret-light'; // the phone variant replaced it mid-wait
        answer.resolve('started');
        expect(await pending).toMatchObject({ ok: false, why: 'stale' });
        expect(s.core.state().dancing).toBe(false);
        expect(s.core.promptSuffix('life')).not.toMatch(/dance on the stage \(confirmed\)/);
    });

    test('8. a move that lands after a revoke-and-reopen belongs to the old session', async () => {
        const s = setup();
        await flush();
        const land = deferred();
        s.rt.goToSpot.mockImplementationOnce(async (spot) => {
            await land.promise;
            s.rt.spotId = spot.id;
            return { ok: true };
        });
        expect(s.core.gate().ok).toBe(true); // a turn read the open room
        const move = s.presence.go('curtain');
        s.answers.privateOpen = false;
        s.core.gate(); // the gate closes: the room is revoked and presence forgets
        s.answers.privateOpen = true;
        s.core.gate(); // and opens again: a new session
        land.resolve();
        await move;
        await flush();
        const p = s.core.promptSuffix('life');
        expect(p).not.toMatch(/Just now you both moved/); // the turn that asked is gone
        expect(p).toMatch(/by the curtain/); // where she stands is still a fact
    });

    test('14. the room asks for no microphone, camera, tracking or storage of its own', () => {
        expect(code).not.toMatch(/getUserMedia|getDisplayMedia|requestSession|localStorage|sessionStorage|indexedDB/);
        // Its one network read is its own config; it sends nothing anywhere.
        expect(code.match(/fetch\(/g) || []).toHaveLength(1);
        expect(code).not.toMatch(/sendBeacon|XMLHttpRequest|WebSocket|method:\s*['"]POST/);
    });

    test('17. nothing the person or she says is logged', () => {
        const logs = code.match(/console\.\w+\([^)]*\)/g) || [];
        for (const line of logs) expect(line).not.toMatch(/message|reply|text|said|token/i);
    });

    test('18. under reduced motion a light change is a cut; End still works', async () => {
        const s = setup();
        await flush();
        await s.core.act('light-warm', { instant: true });
        expect(s.rt.setMood).toHaveBeenLastCalledWith(expect.any(Object), { instant: true });
        s.answers.privateOpen = false; // the person's End
        expect(s.core.gate().ok).toBe(false);
        expect(s.rt.setMood).toHaveBeenLastCalledWith(null, { instant: true });
    });

    test('20. no tone, mood or word of hers changes the world: there is nowhere to go', async () => {
        const s = setup();
        await flush();
        // Her only tag is a spot in this room; there is no place to offer.
        expect(s.core.goOffer('life')).not.toMatch(/place=/);
        s.core.observeUser('ok');
        s.core.consumeReply('Che atmosfera intensa… andiamo in discoteca? <go place="neon-discoteca"/>');
        s.core.observeUser('sì');
        await flush();
        expect(s.rt.activeId).toBe('private-cabaret');
        expect(s.presence.state().pending || null).toBeNull();
    });
});
