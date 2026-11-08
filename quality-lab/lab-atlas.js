/**
 * AX11. The Quality Lab's World atlas area. Reads quality-lab/data/atlas/atlas-audit.json (written
 * by tools/qa/world-audit.mjs) and draws regions of zones, each with what loads where and what
 * to build next. Data is inserted as text only.
 */
(function () {
    'use strict';

    const $ = (sel) => document.querySelector(sel);
    const DEVICES = [
        ['desktop', 'D'],
        ['mobile', 'M'],
        ['vr', 'VR'],
    ];

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

    let data = null;

    function stat(label, value, cls) {
        return el('div', { class: 'stat' }, [
            el('div', { class: 'stat-v ' + (cls || ''), text: String(value) }),
            el('div', { class: 'stat-l', text: label }),
        ]);
    }

    function drawOverview() {
        const s = data.summary;
        $('#a-stats').replaceChildren(
            stat('regions', s.regions),
            stat('zones', s.zones),
            stat('shipped', s.shipped),
            stat('planned', s.planned),
            ...DEVICES.map(([d]) => stat(`walkable from home · ${d}`, `${s.reachableFromHome[d]} / ${s.publicZones}`)),
            stat('failures', s.fails, s.fails ? 'bad' : 'good')
        );
        const gw = DEVICES.filter(([d]) => s.gateways[d].length);
        $('#a-gateways').replaceChildren(
            ...(gw.length
                ? [
                      el('b', { text: 'Highest-value 3D work: ' }),
                      ...gw.map(([d]) =>
                          el('div', {
                              text: `${d}: make ${s.gateways[d].join(', ')} load here — it is the gateway that cuts the rest of the map off from home.`,
                          })
                      ),
                  ]
                : [el('span', { class: 'muted', text: 'No gateway zone cuts the map on any device.' })])
        );
    }

    function zoneCard(z) {
        const filter = $('#a-device').value;
        const dots = el(
            'div',
            { class: 'dots' },
            DEVICES.map(([d, short]) =>
                el('span', {
                    class: 'dot ' + (z.devices[d] ? 'on' : 'off'),
                    title: `${d}: ${z.devices[d] ? 'loads' : 'not offered'}`,
                    text: short,
                })
            )
        );
        const fails = z.issues.filter((i) => i.severity === 'fail').length;
        const warns = z.issues.length - fails;
        const img =
            z.preview && z.preview.src
                ? el('img', { src: '../assets/vr-worlds/' + z.preview.src, alt: '', loading: 'lazy' })
                : el('div', { class: 'thumb-empty' });
        const body = el('div', { class: 'zone-body' }, [
            el('div', { class: 'w-title', text: z.title }),
            el('div', {
                class: 'muted small',
                text: `${z.status}${z.spots ? ` · ${z.spots} spots` : ''}${fails ? ` · ${fails} fail` : ''}${warns ? ` · ${warns} warn` : ''}`,
            }),
            dots,
        ]);
        const details = el('details', {}, [
            el('summary', { text: 'details' }),
            el('div', { class: 'small' }, [
                z.worlds.length ? el('div', { text: 'worlds: ' + z.worlds.join(', ') }) : null,
                el('div', { text: 'links: ' + (z.links.join(', ') || '—') }),
                z.brief ? el('div', { text: `purpose: ${z.brief.purpose} · mood: ${z.brief.mood}` }) : null,
                z.brief
                    ? el('div', {
                          text:
                              'spots wanted: ' +
                              z.brief.spotsWanted.join(', ') +
                              ' · assets: ' +
                              z.brief.assets.join(', '),
                      })
                    : null,
                z.issues.length
                    ? el(
                          'ul',
                          {},
                          z.issues.map((i) => el('li', { text: `${i.severity}: ${i.text}` }))
                      )
                    : null,
                z.next.length
                    ? el(
                          'ol',
                          {},
                          z.next.map((n) => el('li', { text: n }))
                      )
                    : null,
            ]),
        ]);
        const dim = filter && !z.devices[filter];
        return el('li', { class: 'zone ' + z.status + (dim ? ' dim' : '') }, [img, body, details]);
    }

    function drawMap() {
        $('#a-regions').replaceChildren(
            ...data.regions.map((r) =>
                el('div', { class: 'region' }, [
                    el('h3', { text: r.title }),
                    el('p', { class: 'muted small', text: r.summary }),
                    el('ul', { class: 'zones' }, data.zones.filter((z) => z.region === r.id).map(zoneCard)),
                ])
            )
        );
    }

    fetch('data/atlas/atlas-audit.json', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
            data = d;
            const sel = $('#a-device');
            sel.replaceChildren(
                el('option', { value: '', text: 'all devices' }),
                ...DEVICES.map(([d]) => el('option', { value: d, text: d }))
            );
            sel.onchange = drawMap;
            drawOverview();
            drawMap();
        })
        .catch((e) =>
            $('#a-stats').replaceChildren(
                el('p', { class: 'score bad', text: 'Could not load the atlas: ' + e.message })
            )
        );
})();
