/**
 * AX9. The Quality Lab page. Reads quality-lab/data/index.json and the run files it lists, and
 * draws them. Everything model-written is inserted as text (textContent), never as HTML: a reply is
 * untrusted output from a third-party model.
 *
 * No framework and no build, like the app: a future session should be able to read this file top
 * to bottom and change one section without learning a toolchain.
 */
(function () {
    'use strict';

    const S = window.NEXUS_CHARACTER_SCORER || null;
    const $ = (sel) => document.querySelector(sel);

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

    function scoreClass(s) {
        return s >= 95 ? 'score good' : s >= 85 ? 'score warn' : 'score bad';
    }

    function secs(ms) {
        return ms == null ? '—' : (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s';
    }

    function chips(flags, cls) {
        const list = Array.isArray(flags) ? flags.map((f) => [f, 1]) : Object.entries(flags || {});
        if (!list.length) return el('span', { class: 'muted', text: '—' });
        return list.map(([f, n]) => el('span', { class: 'chip ' + (cls || ''), text: n > 1 ? `${f} ×${n}` : f }));
    }

    function option(sel, value, label) {
        sel.append(el('option', { value, text: label }));
    }

    const state = { index: null, docs: new Map(), current: null };

    async function load() {
        const index = await fetch('data/index.json', { cache: 'no-store' }).then((r) => r.json());
        state.index = index;
        await Promise.all(
            index.runs.map(async (r) => {
                const doc = await fetch('data/' + r.file, { cache: 'no-store' }).then((x) => x.json());
                state.docs.set(r.id, doc);
            })
        );
        const pick = $('#run-pick');
        for (const r of index.runs) option(pick, r.id, `${r.date.slice(0, 10)} · ${r.label}`);
        const fromQuery = new URLSearchParams(location.search).get('run');
        pick.value = fromQuery && state.docs.has(fromHash) ? fromQuery : index.runs[0] && index.runs[0].id;
        pick.addEventListener('change', () => show(pick.value));
        drawTrend();
        drawWeights();
        wireTry();
        if (pick.value) show(pick.value);
    }

    function show(id) {
        const doc = state.docs.get(id);
        state.current = doc;
        const entry = state.index.runs.find((r) => r.id === id);
        $('#run-meta').replaceChildren(
            `${doc.date} · style ${doc.style || '—'} · ${doc.runs.length} route × language runs · source `,
            el('a', { href: 'data/' + entry.file, text: entry.file })
        );
        history.replaceState(null, '', '?run=' + encodeURIComponent(id) + location.hash);
        const notes = $('#run-notes');
        notes.replaceChildren(...(doc.notes || []).map((n) => el('li', { text: n })));
        drawMatrix(doc);
        drawFilters(doc);
        drawTurns();
        drawPresentation(doc);
        drawReview(doc);
    }

    function drawMatrix(doc) {
        const body = $('#matrix tbody');
        body.replaceChildren(
            ...doc.runs.map((r) => {
                const s = r.summary;
                return el('tr', {}, [
                    el('td', { text: r.route }),
                    el('td', { text: r.lang }),
                    el(
                        'td',
                        { class: 'num' },
                        el('span', { class: scoreClass(s.meanScore), text: String(s.meanScore) })
                    ),
                    el('td', {}, chips(s.flags, 'flag')),
                    el('td', { class: 'num', text: s.questionRatio.toFixed(2) }),
                    el('td', { class: 'num', text: `${secs(s.medianMs)} / ${secs(s.maxMs)}` }),
                    el('td', { class: 'num', title: r.servedModels.join('\n'), text: String(s.distinctServedModels) }),
                    el('td', { class: 'num', text: s.meanTokens == null ? 'not reported' : String(s.meanTokens) }),
                ]);
            })
        );
    }

    function drawTrend() {
        const keys = [];
        for (const r of state.index.runs)
            for (const run of state.docs.get(r.id).runs) {
                const k = `${run.route} · ${run.lang}`;
                if (!keys.includes(k)) keys.push(k);
            }
        $('#trend thead').replaceChildren(
            el('tr', {}, [
                el('th', { scope: 'col', text: 'Run' }),
                ...keys.map((k) => el('th', { scope: 'col', class: 'num', text: k })),
            ])
        );
        $('#trend tbody').replaceChildren(
            ...state.index.runs.map((r) => {
                const doc = state.docs.get(r.id);
                return el('tr', {}, [
                    el('td', { text: `${r.date.slice(0, 16)} · ${r.label}` }),
                    ...keys.map((k) => {
                        const run = doc.runs.find((x) => `${x.route} · ${x.lang}` === k);
                        return el(
                            'td',
                            { class: 'num' },
                            run
                                ? el('span', {
                                      class: scoreClass(run.summary.meanScore),
                                      text: String(run.summary.meanScore),
                                  })
                                : '·'
                        );
                    }),
                ]);
            })
        );
    }

    function drawFilters(doc) {
        const routes = [...new Set(doc.runs.map((r) => r.route))];
        const langs = [...new Set(doc.runs.map((r) => r.lang))];
        const flags = [...new Set(doc.runs.flatMap((r) => r.turns.flatMap((t) => t.flags)))].sort();
        const fill = (sel, values, all) => {
            const s = $(sel);
            s.replaceChildren();
            option(s, '', all);
            for (const v of values) option(s, v, v);
            s.onchange = drawTurns;
        };
        fill('#f-route', routes, 'all');
        fill('#f-lang', langs, 'all');
        fill('#f-flag', ['(any flag)', ...flags], 'all');
    }

    function drawTurns() {
        const doc = state.current;
        const route = $('#f-route').value;
        const lang = $('#f-lang').value;
        const flag = $('#f-flag').value;
        const items = [];
        for (const r of doc.runs) {
            if ((route && r.route !== route) || (lang && r.lang !== lang)) continue;
            for (const t of r.turns) {
                if (flag === '(any flag)' && !t.flags.length) continue;
                if (flag && flag !== '(any flag)' && !t.flags.includes(flag)) continue;
                const reply = t.reply
                    ? el('p', { class: 'reply', text: t.reply })
                    : el('p', { class: 'reply empty', text: 'No reply' });
                const meta = [
                    `${r.route} · ${r.lang} · ${t.id}`,
                    secs(t.ms),
                    t.servedModels.length ? t.servedModels.join(', ') : 'served model not reported',
                    t.tokens == null ? null : `${t.tokens} tokens`,
                    t.recalled == null ? null : t.recalled ? 'recall check passed' : 'recall check failed',
                ]
                    .filter(Boolean)
                    .join(' · ');
                items.push(
                    el('li', { class: 'turn' }, [
                        el('div', { class: 's' }, el('span', { class: scoreClass(t.score), text: String(t.score) })),
                        el('div', { class: 'who', text: meta }),
                        el('p', { class: 'user', text: '“' + t.user + '”' }),
                        el('div', {}, [reply, el('div', {}, chips(t.flags, 'flag'))]),
                    ])
                );
            }
        }
        $('#turn-list').replaceChildren(
            ...(items.length ? items : [el('li', { class: 'muted', text: 'No replies match.' })])
        );
    }

    function drawPresentation(doc) {
        const rows = [];
        for (const r of doc.runs) {
            const p = r.presentation;
            if (!p) continue;
            for (const [moment, v] of Object.entries(p)) {
                if (!v) continue;
                rows.push(
                    el('tr', {}, [
                        el('td', { text: `${r.route} · ${r.lang}` }),
                        el('td', { text: moment }),
                        el('td', { class: 'num', text: v.level == null ? '—' : String(v.level) }),
                        el('td', { class: 'num', text: v.rate == null ? '—' : String(v.rate) }),
                        el('td', {
                            class: 'num',
                            text: v.intended ? `${v.intended.emotion} ${v.intended.intensity}` : '—',
                        }),
                        el('td', { class: 'num', text: v.faceHappy == null ? 'not readable' : String(v.faceHappy) }),
                        el('td', { text: v.applied && v.applied.light ? 'applied' : 'not applied' }),
                    ])
                );
            }
        }
        $('#pres tbody').replaceChildren(
            ...(rows.length
                ? rows
                : [el('tr', {}, el('td', { colspan: '7', class: 'muted', text: 'Not recorded in this run.' }))])
        );
    }

    function drawWeights() {
        const body = $('#weights tbody');
        if (!S || !S.WEIGHTS) {
            body.replaceChildren(
                el('tr', {}, el('td', { colspan: '2', class: 'muted', text: 'Scorer did not load.' }))
            );
            return;
        }
        body.replaceChildren(
            ...Object.entries(S.WEIGHTS)
                .sort((a, b) => b[1] - a[1])
                .map(([f, w]) =>
                    el('tr', {}, [
                        el('td', {}, el('span', { class: 'chip flag', text: f })),
                        el('td', { class: 'num', text: '−' + w }),
                    ])
                )
        );
    }

    function wireTry() {
        const run = () => {
            if (!S) return;
            const r = S.score($('#try-text').value, {
                lang: $('#try-lang').value,
                maxSentences: 4,
                askedAboutAI: $('#try-ai').checked,
            });
            $('#try-out').replaceChildren(
                el('span', { class: scoreClass(r.score), text: String(r.score) }),
                ' ',
                ...[].concat(chips(r.flags, 'flag')),
                el('span', { class: 'muted', text: ` · ${r.sentences} sentence(s) · language ${r.language}` })
            );
        };
        for (const id of ['#try-text', '#try-lang', '#try-ai']) $(id).addEventListener('input', run);
        $('#try').addEventListener('submit', (e) => e.preventDefault());
        run();
    }

    function drawReview(doc) {
        const box = $('#review-body');
        const list = doc.humanReview || [];
        if (!list.length) {
            box.replaceChildren(el('p', { class: 'muted', text: 'No human review recorded for this run.' }));
            return;
        }
        box.replaceChildren(
            ...list.map((rv) =>
                el('div', { class: 'table-scroll' }, [
                    el('p', {
                        text: `${rv.reviewer} · ${rv.date} · ${rv.route || ''} ${rv.lang || ''} · ${rv.device || ''}`,
                    }),
                    el(
                        'table',
                        {},
                        el(
                            'tbody',
                            {},
                            Object.entries(rv.scores || {}).map(([k, v]) =>
                                el('tr', {}, [
                                    el('td', { text: k }),
                                    el('td', { class: 'num', text: String(v.score) }),
                                    el('td', { text: v.evidence || '' }),
                                ])
                            )
                        )
                    ),
                ])
            )
        );
    }

    load().catch((e) => {
        document
            .querySelector('main')
            .prepend(el('p', { class: 'score bad', text: 'Could not load the lab data: ' + e.message }));
    });
})();
