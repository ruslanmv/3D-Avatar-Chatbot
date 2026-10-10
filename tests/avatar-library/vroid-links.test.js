/**
 * V1. VRoid Hub links in the Avatar Library's search box.
 *
 * Pasting a model's address used to find nothing: it was matched as words, sent to VRoid
 * Hub's keyword search, and the direct lookup it should have used asked the local proxy for
 * an action it did not have and unwrapped the answer one level too shallow.
 */

/* global describe, test, expect */

const fs = require('fs');
const path = require('path');
const Links = require('../../src/avatar-library/VroidLinks.js');

const ROOT = path.join(__dirname, '..', '..');

// What was actually pasted: names and notes between the links, one per line.
const PASTED = `AvatarSample_O, by 雨衣 ネモ
https://hub.vroid.com/en/characters/2082401201932290880/models/3390783334862270831
Model Girl, by 羅銥.
https://hub.vroid.com/en/characters/7589991019940102131/models/3353341336249445361
Celeste, by JustAPal. Its extra terms point to PhasePal.com.
https://hub.vroid.com/en/characters/6685370406885124983/models/5295951488219248595
Free To Use Vtuber Model, by x {Egg} x
https://hub.vroid.com/en/characters/5737518450371164595/models/3345334325262507560
Jeanne-Adélaïde, by Notes inégales
https://hub.vroid.com/en/characters/7699621891420705936/models/7169770912101796294
Helen, by Mhiyamin
https://hub.vroid.com/en/characters/7682221189425995874/models/3591428810231326281
Auralithis, by JustAPal. Its extra terms point to a mega.nz folder.
https://hub.vroid.com/en/characters/7336219413778584953/models/1332383967291184475
Azary Sheelal, by Azary Sheelal
https://hub.vroid.com/en/characters/3029694345334753371/models/2128557970269162780
Boy G, by 漢字
https://hub.vroid.com/en/characters/4858331292246007456/models/892080065338290893`;

const NINE = [
    '3390783334862270831',
    '3353341336249445361',
    '5295951488219248595',
    '3345334325262507560',
    '7169770912101796294',
    '3591428810231326281',
    '1332383967291184475',
    '2128557970269162780',
    '892080065338290893',
];

describe('finding model ids in what was typed', () => {
    test('one link gives its model id, not its character id', () => {
        expect(
            Links.parseModelIds('https://hub.vroid.com/en/characters/7682221189425995874/models/3591428810231326281')
        ).toEqual(['3591428810231326281']);
    });

    test('the whole pasted list, with names and notes between the links, gives all nine in order', () => {
        expect(Links.parseModelIds(PASTED)).toEqual(NINE);
    });

    test('a multi-line paste into an <input> loses its newlines; the links still split', () => {
        expect(Links.parseModelIds(PASTED.replace(/\n/g, ''))).toEqual(NINE);
    });

    test('other shapes of the same link', () => {
        for (const link of [
            'hub.vroid.com/characters/7682221189425995874/models/3591428810231326281',
            'https://hub.vroid.com/ja/characters/7682221189425995874/models/3591428810231326281?tab=x',
            'https://hub.vroid.com/models/3591428810231326281',
            'HTTPS://HUB.VROID.COM/EN/CHARACTERS/7682221189425995874/MODELS/3591428810231326281',
        ]) {
            expect(Links.parseModelIds(link)).toEqual(['3591428810231326281']);
        }
    });

    test('bare ids count only when the text is nothing but ids', () => {
        expect(Links.parseModelIds('3591428810231326281, 892080065338290893')).toEqual([
            '3591428810231326281',
            '892080065338290893',
        ]);
        expect(Links.parseModelIds('girl 3591428810231326281')).toEqual([]);
        expect(Links.parseModelIds('12345')).toEqual([]); // short numbers are not model ids
    });

    test('words are a keyword search, not a lookup; repeats collapse; a flood is capped', () => {
        expect(Links.isLinkQuery('helen')).toBe(false);
        expect(Links.isLinkQuery('')).toBe(false);
        expect(Links.parseModelIds(`${PASTED}\n${PASTED}`)).toEqual(NINE);
        const many = Array.from({ length: 40 }, (_, i) => `hub.vroid.com/models/${1000000000 + i}`).join(' ');
        expect(Links.parseModelIds(many)).toHaveLength(Links.MAX_IDS);
    });
});

describe('reading VRoid Hub answers', () => {
    test('detail nests the model in data.character_model; search results are the model', () => {
        const model = { id: '3591428810231326281', name: 'Helen' };
        expect(Links.unwrapDetail({ data: { character_model: model, description: '' } })).toBe(model);
        expect(Links.unwrapDetail({ data: model })).toBe(model);
        expect(Links.unwrapDetail(model)).toBe(model);
        expect(Links.unwrapDetail({ data: { description: 'no model' } })).toBeNull();
        expect(Links.unwrapDetail(null)).toBeNull();
    });

    test("a VRM 1.0 model's terms come from its VRM meta, in the Library's vocabulary", () => {
        // Helen's meta, as VRoid Hub reports it.
        const helen = {
            license: { redistribution: null, modification: null },
            latest_character_model_version: {
                spec_version: '1.0',
                vrm_meta: {
                    avatarPermission: 'everyone',
                    commercialUsage: 'corporation',
                    allowRedistribution: true,
                    modification: 'allowModificationRedistribution',
                    allowExcessivelySexualUsage: true,
                    allowExcessivelyViolentUsage: true,
                    creditNotation: 'unnecessary',
                },
            },
        };
        expect(Links.conditionsFromVrmMeta(helen)).toEqual({
            avatarUse: 'everyone',
            violentExpression: 'allow',
            sexualExpression: 'allow',
            corporateCommercialUse: 'allow',
            personalCommercialUse: 'profit',
            redistribution: 'allow',
            modification: 'allow',
            credit: 'unnecessary',
        });
    });

    test('a restrictive VRM 1.0 meta maps to disallow, and VRM 0.0 has none to read', () => {
        const strict = {
            latest_character_model_version: {
                vrm_meta: {
                    avatarPermission: 'onlyAuthor',
                    commercialUsage: 'personalNonProfit',
                    allowRedistribution: false,
                    modification: 'prohibited',
                    allowExcessivelySexualUsage: false,
                    creditNotation: 'required',
                },
            },
        };
        expect(Links.conditionsFromVrmMeta(strict)).toMatchObject({
            avatarUse: 'author',
            corporateCommercialUse: 'disallow',
            personalCommercialUse: 'nonprofit',
            redistribution: 'disallow',
            modification: 'disallow',
            sexualExpression: 'disallow',
            credit: 'necessary',
        });
        expect(Links.conditionsFromVrmMeta({ license: { redistribution: 'allow' } })).toBeNull();
    });
});

describe('wiring', () => {
    const manager = fs.readFileSync(path.join(ROOT, 'vrm-manager.js'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'vrm-manager.html'), 'utf8');

    test('the helper loads before the Library that reads it', () => {
        const helper = html.indexOf('src/avatar-library/VroidLinks.js');
        expect(helper).toBeGreaterThan(-1);
        expect(helper).toBeLessThan(html.indexOf('src="vrm-manager.js"'));
    });

    test('a link search is matched by model id and never sent to the keyword search', () => {
        expect(manager).toMatch(/if \(linkIds\.length\) return linkIdSet\.has/);
        const lookup = manager.indexOf('this._resolveVroidLinks(linkIds, rawSearch)');
        const keyword = manager.indexOf('this._triggerVroidHubSearch(search)');
        expect(lookup).toBeGreaterThan(-1);
        expect(lookup).toBeLessThan(keyword); // and it returns before reaching it
    });

    test('a found model is appended, never replacing what is there', () => {
        const body = manager.slice(manager.indexOf('_resolveVroidLinks(ids, query) {'));
        const fn = body.slice(0, body.indexOf('\n    },'));
        expect(fn).toMatch(/allItems\.push\(item\)/);
        expect(fn).not.toMatch(/allItems\s*=|allItems\.splice|allItems\.length\s*=/);
    });

    test('the direct lookup works signed out and unwraps character_model', () => {
        const body = manager.slice(manager.indexOf('async _fetchVroidModelById(modelId) {'));
        const fn = body.slice(0, body.indexOf('\n    },'));
        expect(fn).not.toMatch(/if \(!token\) return null/);
        expect(fn).toMatch(/unwrapDetail/);
    });
});

describe('both proxies answer detail, signed out included', () => {
    const local = fs.readFileSync(path.join(ROOT, 'nexus-proxy', 'server.js'), 'utf8');
    const vercel = fs.readFileSync(path.join(ROOT, 'api', 'vroid-hub.js'), 'utf8');

    test('npm start has the detail action (only Vercel did)', () => {
        expect(local).toMatch(/action === 'detail'/);
    });

    test('detail is handled before the sign-in check, in both', () => {
        const localDetail = local.indexOf("if (action === 'detail')");
        expect(localDetail).toBeGreaterThan(-1);
        expect(localDetail).toBeLessThan(local.indexOf('if (!token) return res.status(401)'));
        const vercelDetail = vercel.indexOf("if (action === 'detail' && !token)");
        expect(vercelDetail).toBeGreaterThan(-1);
        expect(vercelDetail).toBeLessThan(vercel.indexOf('if (!token) {'));
    });

    test('the model id reaches VRoid Hub only as digits', () => {
        expect(local).toMatch(/\^\\d\{1,25\}\$/);
        expect(vercel).toMatch(/\^\\d\{1,25\}\$/);
    });

    test('everything else still needs the token', () => {
        expect(local).toMatch(/if \(!token\) return res\.status\(401\)/);
        for (const action of ['download_license', 'download', 'search', 'account']) {
            expect(local.indexOf(`action === '${action}'`)).toBeGreaterThan(
                local.indexOf('if (!token) return res.status(401)')
            );
        }
    });
});
