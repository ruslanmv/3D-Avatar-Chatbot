/**
 * AX10. The Quality Lab's area switch and its 3D area. Reads quality-lab/data/3d/worlds-audit.json
 * (written by tools/qa/world-audit.mjs) and draws it. Kept apart from lab.js so the AI area and
 * the 3D area can each be changed without reading the other.
 */
(function () {
    'use strict';

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

    // ── area switch ─────────────────────────────────────────────────────────
    function areaFromUrl() {
        const q = new URLSearchParams(location.search).get('area');
        if (q === '3d' || q === 'ai' || q === 'atlas') return q;
        if (/^#w-/.test(location.hash)) return '3d';
        return /^#a-/.test(location.hash) ? 'atlas' : 'ai';
    }

    function setArea(area) {
        // body carries data-area too (for the accent colour); it is never hidden
        for (const n of document.querySelectorAll('[data-area]:not(body)'))
            n.hidden = n.getAttribute('data-area') !== area;
        for (const a of document.querySelectorAll('.area'))
            a.setAttribute('aria-selected', String(a.dataset.go === area));
        document.body.dataset.area = area;
        window.dispatchEvent(new CustomEvent('lab:area', { detail: area }));
        const q = new URLSearchParams(location.search);
        q.set('area', area);
        history.replaceState(null, '', '?' + q.toString() + location.hash);
    }

    for (const a of document.querySelectorAll('.area'))
        a.addEventListener('click', (e) => {
            e.preventDefault();
            setArea(a.dataset.go);
        });
    setArea(areaFromUrl());

    // ── 3D area ─────────────────────────────────────────────────────────────
    const DEVICES = ['desktop', 'mobile', 'vr'];
    let audit = null;

    function stat(label, value, cls) {
        return el('div', { class: 'stat' }, [
            el('div', { class: 'stat-v ' + (cls || ''), text: String(value) }),
            el('div', { class: 'stat-l', text: label }),
        ]);
    }

    function drawStats() {
        const s = audit.summary;
        $('#w-stats').replaceChildren(
            stat('worlds', s.worlds),
            stat('places', s.places),
            stat('phone stand-ins', s.standIns),
            stat('offered on desktop', s.offered.desktop),
            stat('offered on mobile', s.offered.mobile),
            stat('offered in VR', s.offered.vr),
            stat('places with spots', s.withSpots),
            stat('failures', s.fails, s.fails ? 'bad' : 'good'),
            stat('warnings', s.warns, s.warns ? 'warn' : 'good'),
            stat('phone triangle budget', s.mobileTriangleBudget.toLocaleString('en'))
        );
    }

    function fillSelect(sel, values, all) {
        const s = $(sel);
        s.replaceChildren(
            el('option', { value: '', text: all }),
            ...values.map((v) => el('option', { value: v, text: v }))
        );
        s.onchange = drawTable;
    }

    function worldCell(w) {
        const img =
            w.preview && w.preview.exists
                ? el('img', {
                      src: '../assets/vr-worlds/' + w.preview.src,
                      alt: '',
                      loading: 'lazy',
                      width: '64',
                      height: '48',
                  })
                : el('div', { class: 'thumb-empty' });
        const sub = [w.kind, w.rating, w.category, w.look].filter(Boolean).join(' · ');
        return el(
            'td',
            {},
            el('div', { class: 'world' }, [
                img,
                el('div', {}, [
                    el('div', { class: 'w-title', text: w.title }),
                    el('code', { text: w.id }),
                    el('div', { class: 'muted small', text: sub }),
                ]),
            ])
        );
    }

    function triCell(w) {
        const budget = audit.summary.mobileTriangleBudget;
        const pct = Math.min(100, Math.round((w.triangles / budget) * 100));
        return el('td', { class: 'num' }, [
            el('div', { text: w.triangles.toLocaleString('en') }),
            el(
                'div',
                { class: 'tri', title: `${pct}% of the phone budget` },
                el('span', { class: w.triangles > budget ? 'over' : '', style: `width:${pct}%` })
            ),
        ]);
    }

    function deviceCell(d) {
        return el('td', { class: 'dev ' + (d.ok ? 'ok' : 'no'), title: d.why, text: d.ok ? '✓' : '·' });
    }

    function drawTable() {
        const kind = $('#w-kind').value;
        const missing = $('#w-device').value;
        const onlyIssues = $('#w-issues').checked;
        const order = { place: 0, 'stand-in': 1, 'activity world': 2 };
        const rows = [...audit.worlds]
            .sort((a, b) => order[a.kind] - order[b.kind])
            .filter(
                (w) =>
                    (!kind || w.kind === kind) &&
                    (!missing || !w.devices[missing].ok) &&
                    (!onlyIssues || w.issues.length)
            )
            .map((w) =>
                el('tr', {}, [
                    worldCell(w),
                    triCell(w),
                    ...DEVICES.map((d) => deviceCell(w.devices[d])),
                    el(
                        'td',
                        { class: 'small' },
                        w.spots
                            ? `${w.spots.verified}/${w.spots.total} verified${w.spots.matchesScene ? '' : ' · stale'}`
                            : '—'
                    ),
                    el('td', { class: 'small' }, [
                        w.template
                            ? el('div', { text: 'chips: ' + (w.template.actions.join(', ') || w.template.id) })
                            : null,
                        w.privateConfig
                            ? el('div', { text: `private config: ${w.privateConfig.interactions} interactions` })
                            : null,
                        w.activities.length ? el('div', { text: 'activities: ' + w.activities.join(', ') }) : null,
                        !w.template && !w.privateConfig && !w.activities.length
                            ? el('span', { class: 'muted', text: '—' })
                            : null,
                    ]),
                    el(
                        'td',
                        {},
                        w.issues.length
                            ? w.issues.map((i) =>
                                  el('span', {
                                      class: 'chip ' + (i.severity === 'fail' ? 'flag' : 'warnchip'),
                                      text: i.text,
                                  })
                              )
                            : el('span', { class: 'muted', text: '—' })
                    ),
                ])
            );
        $('#w-table tbody').replaceChildren(
            ...(rows.length
                ? rows
                : [el('tr', {}, el('td', { colspan: '8', class: 'muted', text: 'No worlds match.' }))])
        );
    }

    function drawQueue() {
        const items = [];
        for (const sev of ['fail', 'warn'])
            for (const w of audit.worlds)
                for (const i of w.issues.filter((x) => x.severity === sev))
                    items.push(
                        el('li', {}, [
                            el('span', { class: 'chip ' + (sev === 'fail' ? 'flag' : 'warnchip'), text: sev }),
                            ' ',
                            el('code', { text: w.id }),
                            ' — ' + i.text,
                        ])
                    );
        $('#w-queue-list').replaceChildren(
            ...(items.length ? items : [el('li', { class: 'muted', text: 'Nothing to fix.' })])
        );
    }

    function drawAnimations(doc) {
        const s = doc.summary || {};
        const box = $('#w-anim-stats');
        if (!box) return;
        box.replaceChildren(
            stat('avatars', s.avatars),
            stat('poses', s.poses),
            stat('clips', s.clips),
            stat('categories', s.categories),
            stat('intents ok', (s.intentsOk || 0) + '/' + (s.intents || 0), s.intentsOk === s.intents ? 'good' : 'bad'),
            stat('experimental', s.experimentalClips || 0, s.experimentalClips ? 'warn' : 'good'),
            stat('failures', s.fails, s.fails ? 'bad' : 'good'),
            stat('warnings', s.warns, s.warns ? 'warn' : 'good'),
            stat('matrix cells', (s.matrixCells || 0).toLocaleString('en'))
        );

        const intents = doc.intentCoverage || [];
        $('#w-anim-intents tbody').replaceChildren(
            ...intents.map((i) =>
                el('tr', {}, [
                    el('td', { text: i.utterance }),
                    el('td', {}, el('code', { text: i.intent })),
                    el('td', { text: i.fastPath || '—' }),
                    el('td', { class: 'num', text: String(i.existing) + '/' + String(i.candidates) }),
                    el('td', { class: i.ok ? 'good' : 'bad', text: i.ok ? 'yes' : 'no' }),
                    el('td', { text: i.why || '' }),
                ])
            )
        );

        $('#w-anim-cats').replaceChildren(
            ...(doc.categories || []).map((c) =>
                el('li', {
                    text: (c.label || c.id) + ' — ' + c.count + ' file(s)' + (c.experimental ? ' (experimental)' : ''),
                })
            )
        );

        const issues = doc.issues || [];
        $('#w-anim-issues').replaceChildren(
            ...(issues.length
                ? issues.map((i) =>
                      el('li', {}, [
                          el('span', {
                              class: 'chip ' + (i.severity === 'fail' ? 'flag' : 'warnchip'),
                              text: i.severity,
                          }),
                          ' ' + i.text,
                      ])
                  )
                : [el('li', { class: 'muted', text: 'No inventory issues.' })])
        );
    }

    fetch('data/3d/worlds-audit.json', { cache: 'no-store' })
        .then((r) => r.json())
        .then((data) => {
            audit = data;
            drawStats();
            fillSelect('#w-kind', [...new Set(audit.worlds.map((w) => w.kind))], 'all');
            fillSelect('#w-device', DEVICES, 'any');
            $('#w-issues').onchange = drawTable;
            drawTable();
            drawQueue();
        })
        .catch((e) =>
            $('#w-stats').replaceChildren(
                el('p', { class: 'score bad', text: 'Could not load the world audit: ' + e.message })
            )
        );

    fetch('data/3d/animations-audit.json', { cache: 'no-store' })
        .then((r) => r.json())
        .then(drawAnimations)
        .catch((e) => {
            const box = $('#w-anim-stats');
            if (box)
                box.replaceChildren(
                    el('p', {
                        class: 'score bad',
                        text: 'Could not load the animations audit: ' + e.message,
                    })
                );
        });
})();
