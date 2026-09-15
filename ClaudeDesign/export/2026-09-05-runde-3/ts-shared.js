// Shared, non-visual helpers for the TravStats web screens: Lucide sprite, nav model, token helpers, demo data.
export const T = {
  bg:'#0b0d10', canvas:'#07090c', surface:'#14181d', surface2:'#101317', tile:'#1a1f26', border:'rgba(231,227,220,0.12)',
  text:'#e7e3dc', textBright:'#f4ece0', muted:'rgba(231,227,220,0.6)', faint:'rgba(231,227,220,0.45)' /* dekorativ: Trenner, Platzhalter, Icon-Ruhe — nie für lesbaren Text (§2.6) */,
  accent:'#f0a947', accentHover:'#f6bd66', accentPressed:'#d8952f', good:'#5ec2b2', info:'#6fa0d6', warn:'#d8952f', bad:'#e65a4f',
  paper:'#f5f1e8', paperText:'#2a2419',
  domain:{ flight:'#f0a947', cruise:'#4aa6b0', hotel:'#5ec2b2', poi:'#e7e3dc' },
  chart:['#f0a947','#6fa0d6','#5ec2b2','#bc8cff','#f778ba','#d8952f','#e65a4f','#9ec0e8'], chartMuted:'#2a2f36',
  tier:{ bronze:'#f59e0b', silver:'rgba(231,227,220,0.62)', gold:'#f0a947', platinum:'#22d3ee', diamond:'#a855f7' },
};
export const rgba = (hex, a) => { if (hex.startsWith('rgba')) return hex.replace(/[\d.]+\)$/, a + ')'); const n = parseInt(hex.slice(1), 16); return `rgba(${n>>16},${(n>>8)&255},${n&255},${a})`; };
export const pill = (label, color, dashed) => ({ label, color, bg: rgba(color, .12), border: rgba(color, .45), dash: dashed ? 'dashed' : 'solid' });
export const STATUS = { scheduled:['Geplant',T.info], pending:['Vorläufig',T.info,true], flown:['Geflogen',T.good], cancelled:['Storniert',T.bad], historical:['Historisch','rgba(231,227,220,0.62)'], review:['Prüfen',T.warn], duplicated:['Dublette',T.warn], live:['Läuft',T.good], done:['Abgeschlossen',T.good] };
export const statusPill = k => { const [l, c, d] = STATUS[k]; return pill(isEN() ? EN_STATUS[k] : l, c, d); };
export const DOMAINS = [
  { key:'flight', label:'Flüge', one:'Flug', icon:'plane', color:T.domain.flight, href:'Logbuch Fluege.dc.html' },
  { key:'cruise', label:'Kreuzfahrten', one:'Kreuzfahrt', icon:'ship', color:T.domain.cruise, href:'Logbuch Domaenen.dc.html#cruise' },
  { key:'hotel', label:'Unterkünfte', one:'Unterkunft', icon:'bed', color:T.domain.hotel, href:'Logbuch Domaenen.dc.html#hotel' },
  { key:'poi', label:'Orte', one:'Ort', icon:'map-pin', color:T.domain.poi, href:'Logbuch Domaenen.dc.html#poi' },
];
export const NAV = {
  primary: [
    { id:'dashboard', label:'Dashboard', href:'Dashboard.dc.html' },
    { id:'logbook', label:'Logbuch', href:'Logbuch Fluege.dc.html' },
    { id:'trips', label:'Reisen', href:'Reisen.dc.html' },
    { id:'stats', label:'Statistik', href:'Statistik.dc.html' },
  ],
  more: [
    { group:'Sammlungen', items:[ { id:'passport', label:'Reisepass', icon:'book-open', href:'Reisepass v2.dc.html', meta:'52 Länder' }, { id:'lists', label:'Ortslisten', icon:'list', href:'Ortslisten.dc.html', meta:'6' } ] },
    { group:'Werkzeuge', items:[ { id:'inbox', label:'Posteingang', icon:'inbox', href:'Posteingang.dc.html', meta:'6', warn:true }, { id:'importlog', label:'Import-Logbuch', icon:'upload', href:'Import-Logbuch.dc.html', meta:'212' }, { id:'search', label:'Schnellsuche', icon:'search', href:'Suche.dc.html', meta:'⌘K' }, { id:'parser', label:'Parser', icon:'mail', href:'Parser.dc.html', beta:true }, { id:'admin', label:'Admin', icon:'shield', href:'Admin v2.dc.html' } ] },
  ],
  profile: [ { id:'achievements', label:'Erfolge', icon:'trophy', href:'Erfolge.dc.html' }, { id:'companions', label:'Mitreisende', icon:'user', href:'Mitreisende.dc.html' }, { id:'settings', label:'Einstellungen', icon:'settings', href:'Einstellungen v3.dc.html' }, { id:'logout', label:'Abmelden', icon:'log-out', href:'Anmelden.dc.html' } ],
};
const isEN = () => typeof document !== 'undefined' && document.documentElement.lang === 'en';
const EN_NAV = { dashboard: 'Dashboard', logbook: 'Logbook', trips: 'Trips', stats: 'Statistics', achievements: 'Achievements', passport: 'Passport', lists: 'Place lists', inbox: 'Inbox', importlog: 'Import log', search: 'Quick search', parser: 'Parser', admin: 'Admin', settings: 'Settings', logout: 'Sign out', companions: 'Companions' };
const EN_GROUP = { 'Sammlungen': 'Collections', 'Werkzeuge': 'Tools', 'Ziele': 'Destinations' };
const tr = i => isEN() ? { ...i, label: EN_NAV[i.id] || i.label } : i;
export const EN_STATUS = { scheduled: 'Scheduled', pending: 'Tentative', flown: 'Flown', cancelled: 'Cancelled', historical: 'Historical', review: 'Review', duplicated: 'Duplicate', live: 'Live', done: 'Completed' };
export const EN_DOMAIN = { flight: ['Flights', 'Flight'], cruise: ['Cruises', 'Cruise'], hotel: ['Accommodation', 'Stay'], poi: ['Places', 'Place'] };
export const navModel = (active, state, set) => ({
  navPrimary: NAV.primary.map(tr).map(n => ({ ...n, active: n.id === active, color: n.id === active ? T.textBright : T.muted, weight: n.id === active ? 700 : 500, bar: n.id === active ? T.accent : 'transparent' })),
  moreOpen: state.menu === 'more', profileOpen: state.menu === 'profile',
  toggleMore: e => { e.stopPropagation(); set({ menu: state.menu === 'more' ? null : 'more' }); },
  toggleProfile: e => { e.stopPropagation(); set({ menu: state.menu === 'profile' ? null : 'profile' }); },
  closeMenus: () => state.menu && set({ menu: null }),
  navDisplay: isNarrow() ? 'none' : 'flex', addLabelDisplay: isNarrow() ? 'none' : 'inline', addPad: isNarrow() ? '0 12px' : '0 16px 0 12px', narrow: isNarrow() ? 'block' : 'none', isNarrow: isNarrow(),
  moreGroups: [...(isNarrow() ? [{ group: 'Ziele', items: NAV.primary.map(n => ({ ...n, icon: ({ dashboard: 'globe', logbook: 'list', trips: 'route', stats: 'bar-chart-3' })[n.id], meta: '' })) }] : []), ...NAV.more].map(g => ({ ...g, group: isEN() ? (EN_GROUP[g.group] || g.group) : g.group, items: g.items.map(tr).map(i => ({ ...i, iconHref: '#i-' + i.icon, metaColor: i.warn ? T.warn : T.muted, active: i.id === active, bg: i.id === active ? 'rgba(231,227,220,0.06)' : 'transparent' })) })),
  profileItems: NAV.profile.map(tr).map(i => ({ ...i, iconHref: '#i-' + i.icon })),
  inboxUnread: true,
});

const P = {
 plane:'<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
 ship:'<path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M12 10v4"/><path d="M12 2v3"/>',
 bed:'<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
 'map-pin':'<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
 globe:'<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
 settings:'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
 'chevron-right':'<path d="m9 18 6-6-6-6"/>', 'chevron-down':'<path d="m6 9 6 6 6-6"/>', 'chevron-up':'<path d="m18 15-6-6-6 6"/>',
 plus:'<path d="M5 12h14"/><path d="M12 5v14"/>', x:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', check:'<path d="M20 6 9 17l-5-5"/>',
 search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
 download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
 upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
 inbox:'<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
 'log-out':'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
 route:'<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
 'table-2':'<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>',
 'columns-3':'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/>',
 layers:'<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
 trophy:'<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
 'book-open':'<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
 list:'<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
 ellipsis:'<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
 user:'<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
 activity:'<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
 printer:'<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
 'arrow-left':'<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>', 'arrow-right':'<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
 'bar-chart-3':'<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
 calendar:'<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
 bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
 shield:'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
 smartphone:'<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
 'key-round':'<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
 info:'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
 'sliders-horizontal':'<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
 map:'<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
 languages:'<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
 anchor:'<path d="M12 22V8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/><circle cx="12" cy="5" r="3"/>',
 sparkles:'<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
 database:'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
 pencil:'<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
 'trash-2':'<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
 clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
 mail:'<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
 'wifi-off':'<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
 'triangle-alert':'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
 'link-2':'<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><path d="M8 12h8"/>',
 image:'<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
 'git-merge':'<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
 eye:'<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
 'eye-off':'<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
};
export function mountSprite() {
  installKeys();
  if (document.getElementById('ts-sprite')) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'ts-sprite'; svg.setAttribute('aria-hidden', 'true'); svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  svg.innerHTML = Object.entries(P).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('');
  document.body.prepend(svg);
}
export const I = n => '#i-' + n;

export const TIERS = { bronze: ['Bronze', T.tier.bronze], silver: ['Silber', T.tier.silver], gold: ['Gold', T.tier.gold], platinum: ['Platin', T.tier.platinum], diamond: ['Diamant', T.tier.diamond] };
// [id, title, category, icon, tier, points, description, goal, have, unlockedDate, rule, series]
export const ACHIEVEMENTS = [
  ['erster-flug','Erster Flug','Sammler','plane','bronze',50,'Den ersten Flug im Logbuch eingetragen.',1,1,'2015-03-12','Zählt Einträge der Domäne Flug mit Status Geflogen.','vielflieger'],
  ['vielflieger-50','Vielflieger 50','Sammler','plane','silver',150,'50 Flüge geloggt.',50,47,'','Zählt Einträge der Domäne Flug mit Status Geflogen.','vielflieger'],
  ['vielflieger-100','Vielflieger 100','Sammler','plane','gold',300,'100 Flüge geloggt.',100,47,'','Zählt Einträge der Domäne Flug mit Status Geflogen.','vielflieger'],
  ['um-die-welt','Um die Welt','Distanz','globe','gold',400,'40 075 km Gesamtdistanz — einmal um den Äquator.',40075,38210,'','Summe der Großkreis-Distanzen aller geflogenen Flüge.','distanz'],
  ['zum-mond','Zum Mond','Elite','globe','diamond',1500,'384 400 km Gesamtdistanz.',384400,38210,'','Summe der Großkreis-Distanzen aller geflogenen Flüge.','distanz'],
  ['erste-kreuzfahrt','Erste Kreuzfahrt','Entdecker','ship','bronze',50,'Die erste Kreuzfahrt eingetragen.',1,1,'2017-06-03','Zählt abgeschlossene Kreuzfahrten.','seebaer'],
  ['seebaer','Seebär','Entdecker','ship','silver',200,'30 Nächte auf See.',30,41,'2024-10-21','Summe der Nächte abgeschlossener Kreuzfahrten.','seebaer'],
  ['weltenbummler-10','Weltenbummler 10','Entdecker','book-open','bronze',100,'10 Länder im Reisepass.',10,23,'2018-08-14','Zählt Länder mit mindestens einem Stempel im Reisepass.','weltenbummler'],
  ['weltenbummler-25','Weltenbummler 25','Entdecker','book-open','silver',200,'25 Länder im Reisepass.',25,23,'','Zählt Länder mit mindestens einem Stempel im Reisepass.','weltenbummler'],
  ['sechs-kontinente','Sechs Kontinente','Elite','map','platinum',800,'Auf sechs Kontinenten gewesen.',6,6,'2026-04-02','Kontinente der Reisepass-Länder, Antarktis ausgenommen.',''],
  ['nachtschwaermer','Nachtschwärmer','Kurios','clock','bronze',75,'Ein Flug über Mitternacht.',1,1,'2019-11-30','Abflug- und Ankunftsdatum (lokal) unterscheiden sich.',''],
  ['fruehaufsteher','Frühaufsteher','Überlebenskünstler','clock','bronze',75,'Abflug vor 06:00 Uhr.',1,1,'2016-07-09','Lokale Abflugzeit vor 06:00.',''],
  ['langstrecke','Langstrecke','Spezial','route','silver',150,'Ein Flug über 10 000 km.',1,1,'2025-02-15','Einzelflug mit Großkreis-Distanz über 10 000 km.',''],
  ['airline-sammler','Airline-Sammler','Sammler','layers','gold',300,'20 verschiedene Airlines.',20,17,'','Distinkte Airline-Codes über geflogene Flüge.',''],
  ['hausmarke','Hausmarke','Sammler','layers','bronze',75,'10 Flüge mit derselben Airline.',10,10,'2020-01-19','Maximum der Flüge je Airline.',''],
  ['heimspiel','Heimspiel','Sammler','map-pin','bronze',50,'25 Abflüge vom Heimatflughafen.',25,25,'2022-05-06','Abflüge vom in den Einstellungen gesetzten Heimatflughafen.',''],
  ['puenktlichkeit','Pünktlichkeit','Spezial','check','silver',150,'10 Flüge in Folge ohne Verspätung.',10,6,'','Längste Serie geflogener Flüge mit Ankunft ≤ 15 min nach Plan.',''],
  ['parser-profi','Parser-Profi','Planer','mail','bronze',50,'10 Einträge aus E-Mail oder PDF eingelesen.',10,10,'2026-08-30','Einträge mit Quelle E-Mail-/PDF-Import, unabhängig von der Domäne.',''],
];
export const achView = (S, a) => { const [id, title, cat, icon, tier, points, desc, goal, have, date, rule, series] = a; const done = have >= goal; const [tierName, tierColor] = TIERS[tier]; const pct = Math.min(100, Math.round(have / goal * 100));
  return { id, title, cat, desc, tier: tierName, tierKey: tier, tierColor, points, icon: S.I(icon), iconColor: done ? tierColor : S.T.faint, fill: done ? S.rgba(tierColor, .12) : 'transparent', ringStyle: done ? 'solid' : 'dashed', done, goal, have, date, rule, series, pct, pctLabel: pct + '%', href: 'Erfolg Detail.dc.html#' + id,
    meta: done ? date : (have.toLocaleString('de-DE') + ' / ' + goal.toLocaleString('de-DE')) }; };

// Single source for demo counts — every screen reads from here (§2.5).
export const COUNTS = { flight: 160, flightPlanned: 15, cruise: 22, cruisePlanned: 2, hotel: 12, stays: 31, poi: 118, tours: 3, trips: 31, countries: 33, airports: 71, achievements: 83, points: 8585, inbox: 6 };
// Beta register mirror of frontend/src/config/betaFeatures.ts — a screen shows the badge iff its entry key is here (§2.4).
export const BETA = {
  tripAiSummary: { name: 'KI-Zusammenfassung einer Reise', why: 'Modellwahl und Kosten sind noch nicht entschieden.', returnsWhen: 'wenn ein lokales Modell die Zusammenfassung ohne Cloud liefert' },
  devicePairing: { name: 'Gerätekopplung', why: 'Der Companion ist noch nicht im Store.', returnsWhen: 'mit dem ersten Store-Release des Companions' },
  passport: { name: 'Reisepass', why: 'Die Zählregel wird noch mit echten Konten geprüft.', returnsWhen: 'wenn die Nachweis-Stufen an 20 Konten stabil sind' },
  domainColors: { name: 'Eigene Bereichsfarben', why: 'Farbe trägt Bedeutung in Legende, Pille, Statistik — Owner-Frage 4.', returnsWhen: 'nie, falls Frage 4 mit „streichen“ beantwortet wird' },
  poiDomain: { name: 'Orte', why: 'Datenmodell für Listen und Checklisten ist neu.', returnsWhen: 'nach der ersten Migration echter Orte' },
  tourRoutes: { name: 'Touren', why: 'Routing-Anbieter und Track-Import sind neu.', returnsWhen: 'wenn zwei Anbieter im Alltag laufen' },
  dawarich: { name: 'Dawarich', why: 'Die Dawarich-API ändert sich noch.', returnsWhen: 'mit Dawarich 1.0' },
};
export const betaPill = key => { if (betaOff()) return null; const b = BETA[key]; return b ? { label: 'Beta', color: T.warn, bg: rgba(T.warn, .12), border: rgba(T.warn, .45), dash: 'dashed', hint: b.name + ' · Beta: ' + b.why + ' Kommt zurück ' + b.returnsWhen + '.' } : null; };
// Ten named list colours (replaces free colour pickers).
export const LIST_COLORS = [['Bernstein', '#f0a947'], ['Türkis', '#4aa6b0'], ['Salbei', '#5ec2b2'], ['Himmel', '#6fa0d6'], ['Flieder', '#bc8cff'], ['Rosé', '#f778ba'], ['Ocker', '#d8952f'], ['Ziegel', '#e65a4f'], ['Nebel', '#9ec0e8'], ['Papier', '#e7e3dc']];

// Mobile rule (§6): under 640 px the primary nav folds into „Mehr“; pages call watchNarrow(this) once to re-render on resize.
export const isNarrow = () => typeof window !== 'undefined' && window.innerWidth < 640;
export const watchNarrow = (cmp) => { let t; const h = () => { clearTimeout(t); t = setTimeout(() => cmp.forceUpdate(), 80); }; window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); };

// Prototype states (§4): #z=leer|filter|laden|fehler|beta — every core page renders one of them; 'normal' otherwise.
export const zState = () => { const m = (location.hash || '').match(/z=([a-z]+)/); return m ? m[1] : 'normal'; };
export const betaOff = () => zState() === 'beta';
export const zModel = (cmp) => { const z = zState(); const opts = [['normal', 'Gefüllt'], ['leer', 'Leer · erstes Mal'], ['filter', 'Leer · Filter'], ['laden', 'Laden'], ['fehler', 'Fehler'], ['beta', 'Beta aus']];
  return { z, zNormal: z === 'normal' || z === 'beta' || z === 'filter', zEmpty: z === 'leer', zFilter: z === 'filter', zLoading: z === 'laden', zError: z === 'fehler', zBetaOff: z === 'beta', zMainDisplay: (z === 'normal' || z === 'beta' || z === 'filter') ? 'flex' : 'none',
    zChips: opts.map(([k, label]) => ({ label, onClick: () => { const h = (location.hash || '').replace(/[#&]?z=[a-z]+/, '').replace(/^#/, ''); location.hash = (h ? h + '&' : '') + 'z=' + k; cmp.forceUpdate(); }, active: z === k, color: z === k ? '#0b0d10' : 'rgba(231,227,220,0.6)', bg: z === k ? '#f0a947' : 'transparent' })) }; };
export const skeletonRows = (n, h) => Array.from({ length: n }, (_, i) => ({ i, h: (h || 64) + 'px', w1: (40 + (i * 13) % 35) + '%', w2: (25 + (i * 7) % 30) + '%', delay: (i * 60) + 'ms' }));

// Keyboard as system state (§7.6): g d/l/r/s jump, / or ⌘K search, ? help, n new. Lists own j/k/Enter/e locally.
export const KEYS = [['⌘ K', '/', 'Schnellsuche'], ['g d', '', 'Dashboard'], ['g l', '', 'Logbuch'], ['g r', '', 'Reisen'], ['g s', '', 'Statistik'], ['n', '', 'Neuer Eintrag'], ['j / k', '', 'In Listen bewegen'], ['Enter', '', 'Öffnen'], ['e', '', 'Bearbeiten'], ['Esc', '', 'Schließen / Auswahl aufheben'], ['⌘ Enter', '', 'Speichern'], ['?', '', 'Diese Liste']];
export function installKeys() {
  if (window.__tsKeys) return; window.__tsKeys = true; let g = 0;
  window.addEventListener('keydown', e => { const t = e.target; const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); location.href = 'Suche.dc.html'; return; }
    if (typing) return;
    if (e.key === '/') { e.preventDefault(); location.href = 'Suche.dc.html'; return; }
    if (e.key === '?') { location.href = 'Suche.dc.html#tastatur'; return; }
    if (e.key === 'n' && !e.metaKey) { location.href = 'Hinzufuegen.dc.html'; return; }
    if (e.key === 'g') { g = Date.now(); return; }
    if (g && Date.now() - g < 900) { const m = { d: 'Dashboard.dc.html', l: 'Logbuch Fluege.dc.html', r: 'Reisen.dc.html', s: 'Statistik.dc.html' }[e.key]; g = 0; if (m) location.href = m; }
  });
}
