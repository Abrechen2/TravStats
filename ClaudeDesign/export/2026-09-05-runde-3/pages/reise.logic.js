class Component extends DCLogic {
  state = { S: null, menu: null, tab: 'Übersicht', deleteOpen: false };
  componentDidMount() { import(new URL('ts-shared.js', location.href).href).then(S => { S.mountSprite(); this.setState({ S }); }); this._k = e => { if (e.key === 'Escape') this.setState({ deleteOpen: false, menu: null }); }; window.addEventListener('keydown', this._k); }
  componentWillUnmount() { window.removeEventListener('keydown', this._k); }
  renderVals() {
    const S = this.state.S; if (!S) return {};
    const set = p => this.setState(p); const T = S.T; const st = this.state;
    return {
      ...S.navModel('trips', st, set), stop: e => e.stopPropagation(),
      status: S.statusPill('done'),
      countries: [['USA', '#3c3b6e'], ['Kanada', '#c93c3c'], ['Dänemark', '#c8102e']].map(([name, flag]) => ({ name, flag })),
      actionsOpen: st.menu === 'actions', toggleActions: e => { e.stopPropagation(); set({ menu: st.menu === 'actions' ? null : 'actions' }); },
      actions: [
        { label: 'Einträge zuordnen', icon: 'link-2', onClick: () => set({ menu: null }) },
        { label: 'Teilen', icon: 'upload', onClick: () => set({ menu: null }) },
        { label: 'Auf Karte', icon: 'map', onClick: () => set({ menu: null }) },
        { label: 'Löschen', icon: 'trash-2', danger: true, onClick: () => set({ menu: null, deleteOpen: true }) },
      ].map((a, i) => ({ ...a, iconHref: S.I(a.icon), color: a.danger ? T.bad : T.text, iconColor: a.danger ? T.bad : T.muted, sep: a.danger ? 'rgba(231,227,220,0.12)' : 'transparent' })),
      tabs: ['Übersicht', 'Timeline', 'Karte', 'Galerie', 'Logistik'].map(t => { const a = st.tab === t; return { label: t, onClick: () => set({ tab: t }), color: a ? T.textBright : T.muted, weight: a ? 700 : 500, bar: a ? T.accent : 'transparent' }; }),
      kpis: [['16', 'Tage unterwegs'], ['3', 'Länder'], ['3 390 €', 'Gesamtkosten']].map(([value, label]) => ({ value, label })),
      places: [['Anchorage', 'Alaska, USA', '12. Juli'], ['Denali', 'Nationalpark · Wanderung', '13. Juli'], ['Glacier Bay', 'Nationalpark · vom Schiff', '17. Juli'], ['Vancouver', 'British Columbia, Kanada', '21. Juli']].map(([name, sub, date], i, a) => ({ name, sub, date, sep: i === a.length - 1 ? 'transparent' : 'rgba(231,227,220,0.12)' })),
      travellers: [['JW', 'Jonas Weber'], ['MS', 'Mia Schmidt']].map(([mono, name]) => ({ mono, name })),
      deleteOpen: st.deleteOpen, closeDelete: () => set({ deleteOpen: false }),
    };
  }
}
