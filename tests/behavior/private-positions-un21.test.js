/**
 * UN21. Positions asked for the way people type them: digits, "in" for "a", typos. Unread, "mettiti
 * a 4 zampe" became a look to put on, and "mettiti seduta" a look called "seduta".
 */
const Commands = require('../../src/xr/PoseCommands.js');
window.NEXUS_POSE_COMMANDS = Commands;
require('../../src/experiences/private/PrivateActionIntent.js');
const Intent = window.NEXUS_PRIVATE_ACTION_INTENT;

const parse = (said) => Intent.parse(said, { lang: 'it-IT', poseHeld: false, poseCatalogue: [] });
const pose = (said) => {
    const r = parse(said);
    return r && r.name === 'avatar.pose' ? r.params.pose : r && r.name;
};

describe('UN21. positions in everyday words', () => {
    test.each([
        'mettiti a quattro zampe',
        'meti in 4 zampi',
        'mettiti a 4 zampe',
        'mettiti in quattro zampe',
        'vai a quattro zampe',
        'a 4 zampe',
        'mettiti alla pecorina',
        'mettiti carponi',
        'get on all fours',
        'on all 4s',
    ])('"%s" is all fours', (said) => expect(pose(said)).toBe('all-fours'));

    test.each(['inginocchiati', 'inginochiati', 'mettiti in ginocchio', 'meti in ginochio'])(
        '"%s" is kneeling',
        (said) => expect(pose(said)).toBe('kneel')
    );

    test.each(['mettiti seduta', 'mettiti a cavalcioni', 'mettiti in piedi'])(
        '"%s" is a posture, never clothes',
        (said) => {
            const r = parse(said);
            expect(r && r.name && r.name.startsWith('wardrobe.')).toBeFalsy();
        }
    );

    test.each([
        ['mettiti la gonna rossa', 'wardrobe.wear'],
        ['mettiti il pigiama', 'wardrobe.wear'],
        ['mettiti qualcosa di comodo', 'wardrobe.wear'],
    ])('"%s" is still clothes', (said, name) => expect(parse(said).name).toBe(name));
});
