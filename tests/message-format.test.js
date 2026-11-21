/**
 * MF1. Her replies drawn as formatted text: tappable links with their site, bold, lists — never
 * through innerHTML. The fixture is the reply the owner saw raw on 2026-11-21.
 */
const F = require('../src/features/chat/MessageFormat.js');

const REPLY =
    'Ecco alcune opzioni di giocattoli che ho trovato per "Ivan": 1. **Alien Stage Ivan Collectibles**: Include figures, plushies, stands, e portachiavi disponibili su Amazon. [Fonte](https://www.amazon.com/alien-stage-ivan/s?k=alien+stage+ivan) 2. **Ivan Plush su Etsy**: Alcuni dei peluche più venduti includono il peluche di Ivan Till da 10 cm con supporto in acrilico, regalo perfetto per i fan. [Fonte](https://www.etsy.com/market/ivan_plush) 3. **Ivan The Elephant Plush**: Un peluche di elefante Ivan disponibile su "Gimme Swag", con un tocco ironico nella descrizione. [Fonte](https://www.gimmeswag.com/products/ivan-the-elephant-plush?srsltid=AYCX9vKIaK1e8DBLDjUMhoU4Q0hJ8cRHsrA6638TMJjSKtYskyAIrTV8) Spero che queste opzioni ti siano utili!';

describe('MF1. message formatting', () => {
    test('a list written on one line becomes a lead, three items and a closing line', () => {
        const b = F.blocks(REPLY);
        expect(b.map((x) => x.type)).toEqual(['p', 'ol', 'p']);
        expect(b[0].text).toMatch(/^Ecco alcune opzioni.*"Ivan":$/);
        expect(b[1].items).toHaveLength(3);
        expect(b[1].items[0]).toMatch(/^\*\*Alien Stage Ivan Collectibles\*\*/);
        expect(b[2].text).toBe('Spero che queste opzioni ti siano utili!');
    });

    test('numbers inside a sentence are not a list', () => {
        expect(F.blocks('Prezzo alla versione 2. poi la 3.5 è meglio.').map((x) => x.type)).toEqual(['p']);
        expect(F.blocks('Il punto 2. e poi il punto 1. sono diversi').map((x) => x.type)).toEqual(['p']);
    });

    test('lines that start with numbers or dashes are lists', () => {
        const b = F.blocks('Ecco:\n1. Uno\n2. Due\n\n- a\n- b');
        expect(b).toEqual([
            { type: 'p', text: 'Ecco:' },
            { type: 'ol', items: ['Uno', 'Due'] },
            { type: 'ul', items: ['a', 'b'] },
        ]);
    });

    test('inline: a labelled link keeps its label and names its site; a bare link shows the site', () => {
        const t = F.inline('vedi **A** su [Fonte](https://www.amazon.com/x?y=1) o https://etsy.com/a.');
        expect(t).toEqual([
            { t: 'text', text: 'vedi ' },
            { t: 'bold', text: 'A' },
            { t: 'text', text: ' su ' },
            { t: 'link', text: 'Fonte', href: 'https://www.amazon.com/x?y=1', site: 'amazon.com' },
            { t: 'text', text: ' o ' },
            { t: 'link', text: 'etsy.com', href: 'https://etsy.com/a', site: null },
            { t: 'text', text: '.' },
        ]);
    });

    test('rendered: real elements, links open safely in a new tab, nothing raw is left', () => {
        const el = document.createElement('div');
        F.render(el, REPLY);
        expect(el.querySelectorAll('ol > li')).toHaveLength(3);
        expect(el.querySelectorAll('strong')[0].textContent).toBe('Alien Stage Ivan Collectibles');
        const links = [...el.querySelectorAll('a.nexus-msg-link')];
        expect(links.map((a) => a.textContent)).toEqual(['Fonte', 'Fonte', 'Fonte']);
        expect(links.map((a) => a.nextSibling.textContent)).toEqual(['amazon.com', 'etsy.com', 'gimmeswag.com']);
        for (const a of links) {
            expect(a.target).toBe('_blank');
            expect(a.rel).toBe('noopener noreferrer nofollow');
        }
        expect(el.textContent).not.toMatch(/\*\*|\]\(|https?:\/\//);
    });

    test('never HTML: tags in a reply stay text, and only http(s) links become anchors', () => {
        const el = document.createElement('div');
        F.render(el, '<img src=x onerror=alert(1)> [clic](javascript:alert(1)) **ok**');
        expect(el.querySelector('img')).toBeNull();
        expect(el.querySelector('a')).toBeNull();
        expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
        expect(el.querySelector('strong').textContent).toBe('ok');
    });
});
