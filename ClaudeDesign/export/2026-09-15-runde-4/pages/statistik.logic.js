class Component extends DCLogic {
  state = { S: null, menu: null, tab: 'all', year: 2026, compare: false, measure: 'Erlebnisse', on: { flight: true, cruise: true } };
  componentDidMount() { import(new URL('ts-shared.js', location.href).href).then(S => { S.mountSprite(); this.setState({ S }); }); }
  renderVals() {
    const S = this.state.S; if (!S) return {};
    const set = p => this.setState(p); const T = S.T; const st = this.state;
    const chip = (label, active, onClick) => ({ label, onClick, bg: active ? T.accent : 'transparent', color: active ? T.bg : T.text, border: active ? T.accent : 'rgba(231,227,220,0.18)' });
    const yearsData = { 2015: [9, 0], 2016: [9, 0], 2017: [15, 4], 2018: [15, 2], 2019: [9, 3], 2020: [5, 2], 2021: [9, 3], 2022: [8, 2], 2023: [8, 0], 2024: [4, 0], 2025: [13, 3], 2026: [9, 1] };
    const max = 19; const sel = st.year;
    const series = [['flight', 'Flüge', S.T.chart[0], '142'], ['cruise', 'Kreuzfahrten', S.T.chart[1], '22'], ['hotel', 'Unterkünfte', S.T.chart[2], 'keine Daten'], ['poi', 'Orte', S.T.chart[3], 'keine Daten']];
    return {
      ...S.navModel('stats', st, set), stop: e => e.stopPropagation(),
      statTabs: [{ key: 'all', label: 'Gesamt' }, ...S.DOMAINS.map(d => ({ key: d.key, label: d.label, icon: d.icon, iconColor: d.color }))].map(t => { const a = st.tab === t.key; return { label: t.label, onClick: () => set({ tab: t.key }), hasIcon: !!t.icon, iconHref: t.icon ? S.I(t.icon) : '', iconColor: t.iconColor, color: a ? T.textBright : T.muted, weight: a ? 700 : 500, bar: a ? T.accent : 'transparent' }; }),
      years: [['Alle', 'all'], ...Object.keys(yearsData).map(y => [y, +y])].map(([l, v]) => chip(l, sel === v, () => set({ year: v }))),
      toggleCompare: () => set({ compare: !st.compare }), compareBg: st.compare ? T.accent : 'transparent', compareColor: st.compare ? T.bg : T.text, compareBorder: st.compare ? T.accent : 'rgba(231,227,220,0.18)',
      periodLabel: sel === 'all' ? 'alle Jahre · 2015–2026' : `Jahr ${sel}` + (st.compare ? ' · Vergleich 2025' : ''),
      kpis: [
        { value: '10', label: 'Erlebnisse · 9 Flüge, 1 Kreuzfahrt', delta: st.compare ? '−6 zu 2025' : '', href: 'Logbuch Fluege.dc.html', chevron: true },
        { value: '12', label: 'Länder besucht', delta: st.compare ? '+3 zu 2025' : '', href: 'Reisepass.dc.html', chevron: true },
        { value: '16', label: 'Tage unterwegs · das eine geteilte Maß', delta: st.compare ? '−9 zu 2025' : '', href: '#', chevron: false },
        { value: '83', label: 'Erfolge · 8 585 Punkte', delta: st.compare ? '+11 zu 2025' : '', href: '#', chevron: true },
      ].map(k => ({ ...k, deltaColor: k.delta.startsWith('+') ? T.good : T.muted })),
      series: series.map(([k, label, color, meta]) => { const on = st.on[k]; const has = k === 'flight' || k === 'cruise'; return { label, meta, swatch: on && has ? color : T.chartMuted, textColor: has ? (on ? T.text : T.muted) : T.faint, deco: on || !has ? 'none' : 'line-through', toggle: () => has && set(s => ({ on: { ...s.on, [k]: !s.on[k] } })) }; }),
      measures: ['Erlebnisse', 'Reisetage'].map(m => chip(m, st.measure === m, () => set({ measure: m }))),
      highlightLabel: sel === 'all' ? 'Jahr anklicken zum Hervorheben' : `${sel} hervorgehoben`,
      bars: Object.entries(yearsData).map(([y, [f, c]]) => { const yr = +y; const hi = sel === 'all' || sel === yr; const fv = st.on.flight ? f : 0, cv = st.on.cruise ? c : 0; const total = fv + cv;
        return { year: y, total: total || '', title: `${y}: ${fv} Flüge, ${cv} Kreuzfahrten`, h: `${Math.round(total / max * 100)}%`, onClick: () => set({ year: sel === yr ? 'all' : yr }),
          labelColor: sel === yr ? T.accent : T.muted, labelWeight: sel === yr ? 600 : 400, ring: sel === yr ? `0 0 0 2px ${T.accent}` : 'none',
          segs: [{ h: `${total ? cv / total * 100 : 0}%`, color: hi ? T.chart[1] : T.chartMuted }, { h: `${total ? fv / total * 100 : 0}%`, color: hi ? T.chart[0] : T.chartMuted }] }; }),
      domainCards: [
        { key: 'flight', stats: [['9', 'Flüge'], ['18 340 km', 'Distanz'], ['6', 'Airlines']] },
        { key: 'cruise', stats: [['1', 'Kreuzfahrt'], ['7', 'Nächte'], ['5', 'Häfen']] },
      ].map(c => { const d = S.DOMAINS.find(x => x.key === c.key); return { label: d.label, href: d.href, color: d.color, iconHref: S.I(d.icon), stats: c.stats.map(([v, l]) => ({ v, l })) }; }),
    };
  }
}
