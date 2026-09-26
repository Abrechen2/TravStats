/**
 * The demo account's roadtrips and tours, as geometry requests.
 *
 * One list serves two readers. `scripts/demo/generateDemoGeometry.ts` routes
 * every roadtrip leg and every recorded track through a public router ONCE and
 * writes the result to `seedData/demo/`; the seed reads the same list and the
 * written files, and never touches the network. A coordinate therefore lives
 * here and nowhere else — a station moved in one place and not the other would
 * be a stored line that no longer ends at its station.
 *
 * Coordinates of hotels, campsites and huts were looked up in OpenStreetMap
 * (Nominatim) on 2026-09-26; the trail and river waypoints are the villages
 * and summits a walker or cyclist actually passes, so the router follows the
 * signposted path instead of the shortest line between the ends.
 */

export type LatLon = readonly [number, number];

/** Where the demo traveller lives: Köln-Ehrenfeld. Start and end of every drive. */
export const HOME = { title: "Köln", lat: 50.9515, lon: 6.9175 } as const;

export type StationNight = "pass" | "free" | { lodging: string };

export interface RoadtripStationSpec {
  title: string;
  lat: number;
  lon: number;
  /** Day of the trip (0 = first day) the station is reached. */
  day: number;
  /** Day it is left, when the traveller stays; absent for a station passed through. */
  untilDay?: number;
  night: StationNight;
}

export interface RoadtripSpec {
  key: string;
  name: string;
  vehicle: "car" | "motorhome" | "motorcycle";
  vehicleName: string;
  color: string;
  startOdometerKm: number | null;
  stations: readonly RoadtripStationSpec[];
  /**
   * Legs that are ferry crossings, by the index of the station they leave. A
   * ferry is not routable, so its line is drawn through the given points.
   */
  ferries?: Readonly<Record<number, readonly LatLon[]>>;
}

export interface TrackSpec {
  key: string;
  name: string;
  /** Day of the trip the recording was made. */
  day: number;
  /** Local start time at the start point, `HH:MM`. */
  start: string;
  /** The way it went, ends included; the router fills in the path between. */
  via: readonly LatLon[];
  pace: "hike" | "bike";
  /** Pauses as `[fraction of the distance, minutes]`. */
  breaks: ReadonlyArray<readonly [number, number]>;
}

export interface TourSpec {
  key: string;
  name: string;
  activity: "hike" | "bike";
  mode: "foot" | "bike";
  /** BRouter profile the tracks were generated with. */
  profile: "hiking-mountain" | "trekking";
  color: string;
  stops: ReadonlyArray<{ title: string; lat: number; lon: number }>;
  /** One per day; track `i` covers the leg from stop `i` to stop `i + 1`, unless the tour has one track for every leg. */
  tracks: readonly TrackSpec[];
}

const at = (title: string, lat: number, lon: number) => ({ title, lat, lon });

// ---------------------------------------------------------------- roadtrips

export const USA_WEST: RoadtripSpec = {
  key: "usa-west",
  name: "USA-Westküste mit dem Mietwagen",
  vehicle: "car",
  vehicleName: "Mustang Cabrio (Mietwagen)",
  color: "#f59e0b",
  startOdometerKm: null,
  stations: [
    {
      ...at("San Francisco", 37.78543, -122.40449),
      day: 0,
      untilDay: 3,
      night: { lodging: "marriott-marquis-sf" },
    },
    {
      ...at("Yosemite Valley", 37.74326, -119.59842),
      day: 3,
      untilDay: 5,
      night: { lodging: "yosemite-valley-lodge" },
    },
    { ...at("Tioga Pass", 37.9107, -119.2583), day: 5, night: "pass" },
    {
      ...at("Mammoth Lakes", 37.65176, -119.03858),
      day: 5,
      untilDay: 6,
      night: { lodging: "mammoth-mountain-inn" },
    },
    {
      ...at("Death Valley", 36.45874, -116.87139),
      day: 6,
      untilDay: 7,
      night: { lodging: "ranch-death-valley" },
    },
    {
      ...at("Las Vegas", 36.11016, -115.17409),
      day: 7,
      untilDay: 9,
      night: { lodging: "cosmopolitan-lv" },
    },
    {
      ...at("Springdale (Zion)", 37.19877, -112.99001),
      day: 9,
      untilDay: 10,
      night: { lodging: "cable-mountain-lodge" },
    },
    {
      ...at("Page", 36.90218, -111.48279),
      day: 10,
      untilDay: 11,
      night: { lodging: "hampton-page" },
    },
    {
      ...at("Grand Canyon Village", 36.05744, -112.13762),
      day: 11,
      untilDay: 12,
      night: { lodging: "el-tovar" },
    },
    { ...at("Seligman (Route 66)", 35.3264, -112.8744), day: 12, night: "pass" },
    {
      ...at("Santa Monica", 34.0091, -118.49315),
      day: 13,
      untilDay: 16,
      night: { lodging: "meridien-santa-monica" },
    },
  ],
};

export const TUSCANY: RoadtripSpec = {
  key: "tuscany",
  name: "Toskana mit dem eigenen Auto",
  vehicle: "car",
  vehicleName: "Golf Variant",
  color: "#b45309",
  startOdometerKm: 84210,
  stations: [
    { ...HOME, day: 0, night: "pass" },
    {
      ...at("Luzern", 47.05431, 8.31017),
      day: 0,
      untilDay: 1,
      night: { lodging: "luzern-schweizerhof" },
    },
    {
      ...at("Florenz", 43.77173, 11.25588),
      day: 1,
      untilDay: 4,
      night: { lodging: "brunelleschi-florenz" },
    },
    { ...at("San Gimignano", 43.4677, 11.0432), day: 4, night: "pass" },
    { ...at("Siena", 43.31459, 11.32488), day: 4, untilDay: 6, night: { lodging: "athena-siena" } },
    {
      ...at("Val d'Orcia", 43.05732, 11.6356),
      day: 6,
      untilDay: 9,
      night: { lodging: "pienza-agriturismo" },
    },
    {
      ...at("Lucca", 43.84305, 10.50989),
      day: 9,
      untilDay: 10,
      night: { lodging: "ilaria-lucca" },
    },
    {
      ...at("Como", 45.81295, 9.08013),
      day: 10,
      untilDay: 11,
      night: { lodging: "metropole-como" },
    },
    { ...HOME, day: 11, night: "pass" },
  ],
};

export const SCANDINAVIA: RoadtripSpec = {
  key: "scandinavia",
  name: "Mit dem Wohnmobil durch Norwegen und Schweden",
  vehicle: "motorhome",
  vehicleName: "Clever Tour 600 (gemietet)",
  color: "#0ea5e9",
  startOdometerKm: 21560,
  stations: [
    { ...HOME, day: 0, night: "pass" },
    {
      ...at("Haithabu an der Schlei", 54.50139, 9.57204),
      day: 0,
      untilDay: 1,
      night: { lodging: "camp-haithabu" },
    },
    {
      ...at("Hirtshals", 57.58636, 9.94518),
      day: 1,
      untilDay: 2,
      night: { lodging: "camp-hirtshals" },
    },
    { ...at("Kristiansand", 58.1446, 7.992), day: 2, night: "pass" },
    {
      ...at("Stavanger", 58.952, 5.71626),
      day: 2,
      untilDay: 4,
      night: { lodging: "camp-mosvangen" },
    },
    {
      ...at("Lofthus (Hardanger)", 60.33618, 6.65659),
      day: 4,
      untilDay: 5,
      night: { lodging: "camp-odda" },
    },
    { ...at("Bergen", 60.4851, 5.38172), day: 5, untilDay: 7, night: { lodging: "camp-bergen" } },
    { ...at("Flåm", 60.86296, 7.10728), day: 7, untilDay: 8, night: { lodging: "camp-flam" } },
    {
      ...at("Geiranger", 62.09913, 7.20298),
      day: 8,
      untilDay: 10,
      night: { lodging: "camp-geiranger" },
    },
    { ...at("Mysuseter (Rondane)", 61.8237, 9.6812), day: 10, untilDay: 11, night: "free" },
    {
      ...at("Oslo", 59.96249, 10.64229),
      day: 11,
      untilDay: 13,
      night: { lodging: "camp-bogstad" },
    },
    {
      ...at("Göteborg", 57.62774, 11.91958),
      day: 13,
      untilDay: 15,
      night: { lodging: "camp-askim" },
    },
    {
      ...at("Malmö", 55.57179, 12.91058),
      day: 15,
      untilDay: 16,
      night: { lodging: "camp-sibbarp" },
    },
    { ...at("Rødby Færgehavn", 54.6566, 11.3526), day: 16, night: "pass" },
    { ...at("Puttgarden", 54.5003, 11.2256), day: 16, night: "pass" },
    {
      ...at("Fehmarn", 54.40504, 11.17772),
      day: 16,
      untilDay: 17,
      night: { lodging: "camp-wulfen" },
    },
    { ...HOME, day: 17, night: "pass" },
  ],
  ferries: {
    // Hirtshals -> Kristiansand across the Skagerrak.
    2: [
      [57.5955, 9.962],
      [57.72, 9.6],
      [58.0, 8.35],
      [58.1446, 7.992],
    ],
    // Rødby -> Puttgarden across the Fehmarnbelt.
    13: [
      [54.6566, 11.3526],
      [54.58, 11.29],
      [54.5003, 11.2256],
    ],
  },
};

export const ALPINE_PASSES: RoadtripSpec = {
  key: "alpine-passes",
  name: "Motorrad: Stilfser Joch und Großglockner",
  vehicle: "motorcycle",
  vehicleName: "R 1250 GS",
  color: "#dc2626",
  startOdometerKm: 18400,
  stations: [
    { ...HOME, day: 0, night: "pass" },
    {
      ...at("Lindau", 47.54422, 9.68205),
      day: 0,
      untilDay: 1,
      night: { lodging: "lindau-bayerischer-hof" },
    },
    { ...at("Reschenpass", 46.833, 10.51), day: 1, night: "pass" },
    { ...at("Stilfser Joch", 46.5287, 10.4531), day: 1, night: "pass" },
    {
      ...at("Bormio", 46.4692, 10.3715),
      day: 1,
      untilDay: 2,
      night: { lodging: "bormio-nazionale" },
    },
    { ...at("Umbrailpass", 46.5419, 10.4339), day: 2, night: "pass" },
    { ...at("Meran", 46.6713, 11.1594), day: 2, night: "pass" },
    {
      ...at("Heiligenblut", 47.03977, 12.84184),
      day: 2,
      untilDay: 3,
      night: { lodging: "heiligenblut-glocknerhof" },
    },
    { ...at("Hochtor (Großglockner)", 47.0822, 12.8413), day: 3, night: "pass" },
    { ...at("Zell am See", 47.323, 12.796), day: 3, night: "pass" },
    {
      ...at("Prien am Chiemsee", 47.8614, 12.36599),
      day: 3,
      untilDay: 4,
      night: { lodging: "prien-luitpold" },
    },
    { ...HOME, day: 4, night: "pass" },
  ],
};

export const ROADTRIPS: readonly RoadtripSpec[] = [USA_WEST, TUSCANY, SCANDINAVIA, ALPINE_PASSES];

// -------------------------------------------------------------------- tours

const KOENIGSWINTER_BF: LatLon = [50.67874, 7.19314];
const DRACHENFELS: LatLon = [50.66518, 7.21023];
const LOEWENBURG: LatLon = [50.66406, 7.25028];
const BAD_HONNEF_BF: LatLon = [50.64191, 7.22275];

export const RHEINSTEIG: TourSpec = {
  key: "rheinsteig",
  name: "Rheinsteig: Königswinter – Bad Honnef",
  activity: "hike",
  mode: "foot",
  profile: "hiking-mountain",
  color: "#16a34a",
  stops: [
    at("Bahnhof Königswinter", ...KOENIGSWINTER_BF),
    at("Drachenfels", ...DRACHENFELS),
    at("Löwenburg", ...LOEWENBURG),
    at("Bahnhof Bad Honnef", ...BAD_HONNEF_BF),
  ],
  tracks: [
    {
      key: "rheinsteig-day",
      name: "Rheinsteig Siebengebirge",
      day: 0,
      start: "09:40",
      via: [KOENIGSWINTER_BF, DRACHENFELS, LOEWENBURG, BAD_HONNEF_BF],
      pace: "hike",
      breaks: [
        [0.3, 25],
        [0.62, 50],
      ],
    },
  ],
};

const MOSEL = {
  trier: [49.75966, 6.64417],
  schweich: [49.82243, 6.75154],
  leiwen: [49.82192, 6.88134],
  trittenheim: [49.82204, 6.90002],
  neumagen: [49.86261, 6.90221],
  piesport: [49.88137, 6.91957],
  brauneberg: [49.90853, 6.98565],
  bernkastel: [49.91574, 7.07082],
  graach: [49.93523, 7.06342],
  zeltingen: [49.9557, 7.00846],
  uerzig: [49.97931, 7.00564],
  kroev: [49.97845, 7.08669],
  traben: [49.95304, 7.12332],
  enkirch: [49.98304, 7.12576],
  puenderich: [50.0403, 7.12681],
  zell: [50.02757, 7.18132],
  bullay: [50.05521, 7.13276],
  neef: [50.09046, 7.13845],
  ediger: [50.09749, 7.15209],
  beilstein: [50.11082, 7.23881],
  cochem: [50.14839, 7.16632],
  klotten: [50.16415, 7.20037],
  treis: [50.17543, 7.30087],
  moselkern: [50.19264, 7.36959],
  hatzenport: [50.22799, 7.41763],
  alken: [50.24956, 7.44676],
  kobern: [50.30699, 7.4583],
  winningen: [50.31388, 7.51822],
  koblenz: [50.365, 7.60648],
} as const satisfies Record<string, LatLon>;

const bikeBreaks: ReadonlyArray<readonly [number, number]> = [
  [0.28, 20],
  [0.55, 70],
  [0.8, 25],
];

export const MOSEL_CYCLE: TourSpec = {
  key: "mosel",
  name: "Mosel-Radweg Trier – Koblenz",
  activity: "bike",
  mode: "bike",
  profile: "trekking",
  color: "#7c3aed",
  stops: [
    at("Trier, Porta Nigra", ...MOSEL.trier),
    at("Bernkastel-Kues", ...MOSEL.bernkastel),
    at("Zell (Mosel)", ...MOSEL.zell),
    at("Cochem", ...MOSEL.cochem),
    at("Koblenz, Deutsches Eck", ...MOSEL.koblenz),
  ],
  tracks: [
    {
      key: "mosel-1",
      name: "Mosel Tag 1: Trier – Bernkastel-Kues",
      day: 0,
      start: "10:15",
      via: [
        MOSEL.trier,
        MOSEL.schweich,
        MOSEL.leiwen,
        MOSEL.trittenheim,
        MOSEL.neumagen,
        MOSEL.piesport,
        MOSEL.brauneberg,
        MOSEL.bernkastel,
      ],
      pace: "bike",
      breaks: bikeBreaks,
    },
    {
      key: "mosel-2",
      name: "Mosel Tag 2: Bernkastel-Kues – Zell",
      day: 1,
      start: "09:30",
      via: [
        MOSEL.bernkastel,
        MOSEL.graach,
        MOSEL.zeltingen,
        MOSEL.uerzig,
        MOSEL.kroev,
        MOSEL.traben,
        MOSEL.enkirch,
        MOSEL.puenderich,
        MOSEL.zell,
      ],
      pace: "bike",
      breaks: bikeBreaks,
    },
    {
      key: "mosel-3",
      name: "Mosel Tag 3: Zell – Cochem",
      day: 2,
      start: "09:45",
      via: [MOSEL.zell, MOSEL.bullay, MOSEL.neef, MOSEL.ediger, MOSEL.beilstein, MOSEL.cochem],
      pace: "bike",
      breaks: [
        [0.4, 30],
        [0.75, 60],
      ],
    },
    {
      key: "mosel-4",
      name: "Mosel Tag 4: Cochem – Koblenz",
      day: 3,
      start: "09:20",
      via: [
        MOSEL.cochem,
        MOSEL.klotten,
        MOSEL.treis,
        MOSEL.moselkern,
        MOSEL.hatzenport,
        MOSEL.alken,
        MOSEL.kobern,
        MOSEL.winningen,
        MOSEL.koblenz,
      ],
      pace: "bike",
      breaks: bikeBreaks,
    },
  ],
};

const BRAIES: LatLon = [46.69883, 12.08455];
const SENNES: LatLon = [46.6536, 12.05942];
const FANES: LatLon = [46.61219, 12.01416];
const LAGAZUOI: LatLon = [46.52775, 12.00813];
const AVERAU: LatLon = [46.49957, 12.0406];

const hutBreaks: ReadonlyArray<readonly [number, number]> = [
  [0.35, 20],
  [0.7, 40],
];

export const ALTA_VIA_1: TourSpec = {
  key: "alta-via-1",
  name: "Alta Via 1: Pragser Wildsee – Averau",
  activity: "hike",
  mode: "foot",
  profile: "hiking-mountain",
  color: "#ea580c",
  stops: [
    at("Pragser Wildsee", ...BRAIES),
    at("Sennes-Hütte", ...SENNES),
    at("Faneshütte", ...FANES),
    at("Rifugio Lagazuoi", ...LAGAZUOI),
    at("Rifugio Averau", ...AVERAU),
  ],
  tracks: [
    {
      key: "av1-1",
      name: "AV1 Etappe 1",
      day: 1,
      start: "08:10",
      via: [BRAIES, SENNES],
      pace: "hike",
      breaks: hutBreaks,
    },
    {
      key: "av1-2",
      name: "AV1 Etappe 2",
      day: 2,
      start: "08:30",
      via: [SENNES, FANES],
      pace: "hike",
      breaks: hutBreaks,
    },
    {
      key: "av1-3",
      name: "AV1 Etappe 3",
      day: 3,
      start: "07:45",
      via: [FANES, LAGAZUOI],
      pace: "hike",
      breaks: hutBreaks,
    },
    {
      key: "av1-4",
      name: "AV1 Etappe 4",
      day: 4,
      start: "08:20",
      via: [LAGAZUOI, AVERAU],
      pace: "hike",
      breaks: hutBreaks,
    },
  ],
};

const FJELLSTUE: LatLon = [58.99098, 6.13744];
const PULPIT: LatLon = [58.98514, 6.18704];

export const PREIKESTOLEN: TourSpec = {
  key: "preikestolen",
  name: "Preikestolen",
  activity: "hike",
  mode: "foot",
  profile: "hiking-mountain",
  color: "#0891b2",
  stops: [
    at("Preikestolen Fjellstue", ...FJELLSTUE),
    at("Preikestolen", ...PULPIT),
    at("Preikestolen Fjellstue", ...FJELLSTUE),
  ],
  tracks: [
    {
      key: "preikestolen-day",
      name: "Preikestolen hin und zurück",
      day: 3,
      start: "08:05",
      via: [FJELLSTUE, PULPIT, FJELLSTUE],
      pace: "hike",
      breaks: [[0.5, 45]],
    },
  ],
};

export const TOURS: readonly TourSpec[] = [RHEINSTEIG, MOSEL_CYCLE, ALTA_VIA_1, PREIKESTOLEN];

/** The file key of roadtrip leg `index` (station `index` to `index + 1`). */
export function roadtripLegKey(roadtripKey: string, index: number): string {
  return `${roadtripKey}#${index}`;
}
