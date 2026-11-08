/**
 * AX12. The hero of every area: what to work on next, from quality-lab/data/hub.json, and a prompt a
 * person can paste into Claude Code to start that work with the right context. The prompt names the
 * files to read and the loop to follow; it never carries data the session should read itself.
 */
(function () {
    'use strict';

    const $ = (sel) => document.querySelector(sel);
    const COPY = {
        ai: {
            eyebrow: 'AI quality · the companion with real models',
            title: 'Does she sound like someone, on every model?',
            lede: 'Real-provider runs through the shipped app: every reply, the model that really served it, the scorer’s findings, her voice and face.',
        },
        '3d': {
            eyebrow: '3D quality · desktop, mobile, VR',
            title: 'Is every world ready on every device?',
            lede: 'Generated from assets/vr-worlds/ by the code the app runs: device availability, the phone budget, previews, measured spots, interactions.',
        },
        atlas: {
            eyebrow: 'World atlas · regions and zones',
            title: 'One world to explore, built a zone at a time.',
            lede: 'The Nexus map as regions of zones. Readiness is computed from the 3D audit; new zones start as a brief and leave with a checklist.',
        },
    };

    function el(tag, attrs, children) {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (k === 'text') n.textContent = v;
            else if (k === 'class') n.className = v;
            else n.setAttribute(k, v);
        }
        for (const c of [].concat(children || [])) if (c != null) n.append(c);
        return n;
    }

    function promptFor(a) {
        return [
            `Read CLAUDE.md, quality-lab/README.md and quality-lab/data/hub.json.`,
            `Take next action "${a.id}": ${a.title}.`,
            `Why: ${a.why}`,
            `Start with: ${a.command}`,
            `Files: ${a.files.join(', ')}.`,
            `Follow the README rules: measure before and after, never hand-edit lab data, regenerate with the tools in tools/qa/, run npm run validate, and commit the code and the regenerated lab data together.`,
        ].join('\n');
    }

    async function copy(text, btn) {
        try {
            await navigator.clipboard.writeText(text);
            btn.textContent = 'Copied';
        } catch (_) {
            btn.textContent = 'Select and copy below';
        }
        setTimeout(() => (btn.textContent = 'Copy prompt'), 1800);
    }

    let hub = null;

    function draw(area) {
        const c = COPY[area] || COPY.ai;
        $('#hero-eyebrow').textContent = c.eyebrow;
        $('#hero-title').textContent = c.title;
        $('#hero-lede').textContent = c.lede;
        document.body.dataset.area = area;
        if (!hub) return;
        const mine = hub.nextActions.filter(
            (a) => a.area === area || (area === 'atlas' && a.area === '3d' && /gateway/.test(a.id))
        );
        const list = mine.slice(0, 4);
        const box = $('#next');
        if (!list.length) {
            box.replaceChildren(el('p', { class: 'muted', text: 'No open actions in this area.' }));
            return;
        }
        box.replaceChildren(
            el('div', { class: 'next-head' }, [
                el('h2', { text: 'Next actions' }),
                el('span', { class: 'muted small', text: `${mine.length} open · ranked · from data/hub.json` }),
            ]),
            el(
                'ol',
                { class: 'next-list' },
                list.map((a) => {
                    const text = promptFor(a);
                    const pre = el('pre', { class: 'prompt' }, el('code', { text }));
                    const btn = el('button', { type: 'button', class: 'btn', text: 'Copy prompt' });
                    btn.addEventListener('click', () => copy(text, btn));
                    return el('li', { class: 'action p' + a.priority }, [
                        el('div', { class: 'action-top' }, [
                            el('span', { class: 'prio', text: 'P' + a.priority }),
                            el('span', { class: 'action-title', text: a.title }),
                        ]),
                        el('p', { class: 'muted small', text: a.why }),
                        el('details', {}, [el('summary', { text: 'Prompt for Claude Code' }), pre, btn]),
                    ]);
                })
            )
        );
    }

    window.addEventListener('lab:area', (e) => draw(e.detail));
    fetch('data/hub.json', { cache: 'no-store' })
        .then((r) => r.json())
        .then((h) => {
            hub = h;
            draw(document.body.dataset.area || 'ai');
        })
        .catch(() => $('#next').replaceChildren(el('p', { class: 'muted', text: 'hub.json did not load.' })));
})();
