class Component extends DCLogic {
  state = { S: null, menu: null, chip: 'Alle', columnsOpen: false, dense: false, col: { duration: true, aircraft: true, price: true } };
  componentDidMount() { import(new URL('ts-shared.js', location.href).href).then(S => { S.mountSprite(); this.setState({ S }); }); }
  renderVals() {
    const S = this.state.S; if (!S) return {};
    const set = p => this.setState(p); const T = S.T; const st = this.state;
    const chip = (label, meta, active, onClick) => ({ label, meta, onClick, bg: active ? T.accent : 'transparent', color: active ? T.bg : T.text, border: active ? T.accent : 'rgba(231,227,220,0.18)', metaColor: active ? 'rgba(11,13,16,0.7)' : T.muted });
    const counts = { flight: '160', cruise: '22', hotel: '0', poi: '0' };
    const F = { PL: '#c8443f', CH: '#d9453d', CN: '#c9302c', ES: '#c8a23c', CL: '#2d5f9e', TH: '#2f3b8a', JP: '#d8d2c4', IN: '#e08a3c', CA: '#c93c3c', TW: '#2f5aa8', SA: '#2f7f4f', TR: '#c93c3c', DE: '#3b3b3b', FI: '#2f5aa8' };
    const data = [
      ['SQ', 'SQ5593', 'Singapore Airlines', 'WAW', 'PL', 'GVA', 'CH', 'Warschau → Genf', 'Di 07.12.27 · 10:10', 'Di 07.12.27 · 11:39', 'scheduled', '1 h 29', 'Airbus A380-800', '—'],
      ['DL', 'DL4403', 'Delta Air Lines', 'PEK', 'CN', 'TFS', 'ES', 'Peking → Teneriffa Süd', 'Fr 26.11.27 · 21:19', 'Sa 27.11.27 · 02:17 +1', 'scheduled', '12 h 58', 'Airbus A350-900', '584 €'],
      ['EW', 'EW5297', 'Eurowings', 'SCL', 'CL', 'GVA', 'CH', 'Santiago → Genf', 'Do 28.10.27 · 05:17', 'Fr 29.10.27 · 00:04 +1', 'pending', '13 h 47', 'Airbus A319', '1 032 €'],
      ['OS', 'OS7327', 'Austrian', 'BKK', 'TH', 'KIX', 'JP', 'Bangkok → Osaka Kansai', 'Mo 23.08.27 · 10:37', 'Mo 23.08.27 · 17:30', 'scheduled', '4 h 53', 'Boeing 777-200ER', '453 €'],
      ['AY', 'AY6543', 'Finnair', 'BOM', 'IN', 'YYZ', 'CA', 'Mumbai → Toronto', 'Mo 16.08.27 · 04:08', 'Mo 16.08.27 · 09:19', 'review', '14 h 41', 'Airbus A320', '291 €'],
      ['AF', 'AF1004', 'Air France', 'TPE', 'TW', 'JED', 'SA', 'Taipeh → Dschidda', 'Mi 23.06.27 · 04:47', 'Mi 23.06.27 · 09:29', 'scheduled', '9 h 42', 'Boeing 777-300ER', '—'],
      ['TK', 'TK3150', 'Turkish Airlines', 'BCN', 'ES', 'STR', 'DE', 'Barcelona → Stuttgart', 'Mi 21.04.27 · 04:11', 'Mi 21.04.27 · 05:21', 'cancelled', '1 h 10', 'Airbus A350-900', '606 €'],
      ['AY', 'AY183', 'Finnair', 'DUS', 'DE', 'WAW', 'PL', 'Düsseldorf → Warschau', 'Do 01.04.26 · 18:43', 'Do 01.04.26 · 19:52', 'flown', '1 h 9', 'Airbus A320', '634 €'],
    ];
    const cols = ['44px', '150px', 'minmax(220px,1.6fr)', '170px', '110px', st.col.duration && '80px', st.col.aircraft && 'minmax(120px,1fr)', st.col.price && '80px', '24px'].filter(Boolean).join(' ');
    return {
      ...S.navModel('logbook', st, set), stop: e => e.stopPropagation(), noop: e => e.preventDefault(),
      domainTabs: S.DOMAINS.map(d => { const a = d.key === 'flight'; return { label: d.label, href: d.href, count: counts[d.key], iconHref: S.I(d.icon), iconColor: d.color, color: a ? T.textBright : T.muted, weight: a ? 700 : 500, bar: a ? T.accent : 'transparent' }; }),
      chips: [['Alle', '160'], ['Geplant', '15'], ['Geflogen', '142'], ['Prüfen', '2'], ['2027', '38'], ['2026', '41'], ['Langstrecke', '57']].map(([l, m]) => chip(l, m, st.chip === l, () => set({ chip: l }))),
      columnsOpen: st.menu === 'columns', toggleColumns: e => { e.stopPropagation(); set({ menu: st.menu === 'columns' ? null : 'columns' }); },
      columnOpts: [['duration', 'Flugzeit'], ['aircraft', 'Flugzeug'], ['price', 'Preis']].map(([k, label]) => ({ label, on: st.col[k], toggle: () => set(s => ({ col: { ...s.col, [k]: !s.col[k] } })), boxBg: st.col[k] ? T.accent : 'transparent', boxBorder: st.col[k] ? T.accent : 'rgba(231,227,220,0.3)' })),
      toggleDense: () => set({ dense: !st.dense }), denseLabel: st.dense ? '36 px' : '64 px',
      col: st.col, gridCols: cols, rowHeight: st.dense ? '44px' : '64px',
      rows: data.map(([mono, code, airline, from, ca, to, cb, sub, dep, arr, status, dur, aircraft, price]) => ({ mono, code, airline, from, to, sub, dep, arr, dur, aircraft, price, flagA: F[ca], flagB: F[cb], pill: status === 'flown' ? S.pill('Flug', T.domain.flight) : S.statusPill(status), dash: status === 'pending' ? 'dashed' : 'solid', priceColor: price === '—' ? T.faint : T.text })),
    };
  }
}
