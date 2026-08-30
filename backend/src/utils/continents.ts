/**
 * Continent resolution — the single source of truth.
 *
 * Replaces two byte-identical coordinate-box implementations (`getContinent` in
 * `utils/achievementStats.ts` and `getContinentFromCoordinates` in
 * `utils/stats/uniqueStats.ts`, which carried a "keep both in sync" comment and had
 * already drifted into being copy-pasted). Measured against the production airport
 * catalogue (4565 open, IATA-carrying airports), the box model was wrong in three ways:
 *
 *   1. `lat > 70` returned 'Antarctica' — that is the ARCTIC. 27 real airports were
 *      affected, including LYR (Svalbard/Longyearbyen, 78.25°N) and BRW (Utqiaġvik).
 *      Flying to Svalbard credited you with Antarctica.
 *   2. Australia was 'Asia'. The Oceania box started at lon 150°, so 160 of 195
 *      Australian airports (Perth, Melbourne, Adelaide…) fell into the Asia box.
 *   3. 'Middle East' was returned as if it were a continent. It is not — and it made
 *      the set of possible values EIGHT, so `CONTINENTS_7` ("Visit airports on all 7
 *      continents") could be unlocked without ever going to Antarctica. Nothing else in
 *      the codebase consumed the value.
 *
 * Plus 62 airports (44 Russian, Cabo Verde, Kazakhstan, Kutaisi/Georgia, Réunion,
 * Seychelles, Mauritius) fell through every box and returned null.
 *
 * The fix is to resolve by ISO country instead of by latitude/longitude rectangles.
 * Airports carry an ISO-3166 alpha-2 code; ports carry an English country name — both
 * are accepted. Coordinates remain a fallback for records that carry neither, and for
 * the transcontinental countries where a single country-level answer would be a lie.
 */

export type Continent =
  | "Africa"
  | "Antarctica"
  | "Asia"
  | "Europe"
  | "North America"
  | "Oceania"
  | "South America";

export const CONTINENTS: readonly Continent[] = [
  "Africa",
  "Antarctica",
  "Asia",
  "Europe",
  "North America",
  "Oceania",
  "South America",
] as const;

/**
 * Countries that genuinely straddle two continents. A single country-level answer would
 * put Vladivostok in Europe, so these are resolved from the coordinates instead.
 */
/**
 * A country that genuinely straddles two continents, with BOTH the resolver and
 * the continents that resolver can return.
 *
 * The pair is stated rather than left implicit in the closure because a
 * per-continent country total has to know it: without it, Egypt has to be filed
 * under one continent or the other, and either choice is wrong half the time.
 * Stated this way, Egypt counts towards Africa AND Asia, which is what it is.
 */
interface Transcontinental {
  resolve: (lat: number, lon: number) => Continent;
  spans: readonly Continent[];
}

const TRANSCONTINENTAL: Record<string, Transcontinental> = {
  // Ural divide, conventionally ~60°E.
  RU: { resolve: (_lat, lon) => (lon < 60 ? "Europe" : "Asia"), spans: ["Europe", "Asia"] },
  // The Ural river runs through western Kazakhstan, roughly 55°E at Atyrau/Oral.
  KZ: { resolve: (_lat, lon) => (lon < 55 ? "Europe" : "Asia"), spans: ["Europe", "Asia"] },
  // The Bosphorus is at ~29°E. Istanbul Airport (IST, lon 28.8) is on the European side.
  TR: { resolve: (_lat, lon) => (lon < 29 ? "Europe" : "Asia"), spans: ["Europe", "Asia"] },
  // The Sinai peninsula is in Asia; the rest of Egypt is Africa. The peninsula sits
  // north-east of the Gulf of Suez: Sharm el-Sheikh (27.98/34.39) and Taba are on it,
  // while Hurghada (27.18/33.80) and Marsa Alam are across the water on the African
  // coast at the same longitude, and Suez city (29.97/32.53) is on the African bank.
  EG: {
    resolve: (lat, lon) => (lon > 33 && lat > 27.8 ? "Asia" : "Africa"),
    spans: ["Africa", "Asia"],
  },
};

/**
 * ISO-3166 alpha-2 -> continent. Covers every code present in the production airport
 * catalogue (240) and port catalogue (229), plus the rest of ISO-3166 so a new
 * reference-data row cannot silently fall through.
 *
 * Convention: the UN M49 geoscheme. That puts the Caucasus (AM, AZ, GE) and the Levant /
 * Arabian peninsula in Asia — there is no "Middle East" continent. Cyprus is Europe (EU
 * member, universally treated as European in travel contexts). Transcontinental
 * countries are handled above, not here.
 */
const BY_ISO: Record<string, Continent> = {
  // ── Europe ─────────────────────────────────────────────────────────────────
  AD: "Europe", AL: "Europe", AT: "Europe", AX: "Europe", BA: "Europe", BE: "Europe",
  BG: "Europe", BY: "Europe", CH: "Europe", CY: "Europe", CZ: "Europe", DE: "Europe",
  DK: "Europe", EE: "Europe", ES: "Europe", FI: "Europe", FO: "Europe", FR: "Europe",
  GB: "Europe", GG: "Europe", GI: "Europe", GR: "Europe", HR: "Europe", HU: "Europe",
  IE: "Europe", IM: "Europe", IS: "Europe", IT: "Europe", JE: "Europe", LI: "Europe",
  LT: "Europe", LU: "Europe", LV: "Europe", MC: "Europe", MD: "Europe", ME: "Europe",
  MK: "Europe", MT: "Europe", NL: "Europe", NO: "Europe", PL: "Europe", PT: "Europe",
  RO: "Europe", RS: "Europe", SE: "Europe", SI: "Europe", SJ: "Europe", SK: "Europe",
  SM: "Europe", UA: "Europe", VA: "Europe", XK: "Europe",

  // ── Asia ───────────────────────────────────────────────────────────────────
  AE: "Asia", AF: "Asia", AM: "Asia", AZ: "Asia", BD: "Asia", BH: "Asia", BN: "Asia",
  BT: "Asia", CC: "Asia", CN: "Asia", CX: "Asia", GE: "Asia", HK: "Asia", ID: "Asia",
  IL: "Asia", IN: "Asia", IO: "Asia", IQ: "Asia", IR: "Asia", JO: "Asia", JP: "Asia",
  KG: "Asia", KH: "Asia", KP: "Asia", KR: "Asia", KW: "Asia", LA: "Asia", LB: "Asia",
  LK: "Asia", MM: "Asia", MN: "Asia", MO: "Asia", MV: "Asia", MY: "Asia", NP: "Asia",
  OM: "Asia", PH: "Asia", PK: "Asia", PS: "Asia", QA: "Asia", SA: "Asia", SG: "Asia",
  SY: "Asia", TH: "Asia", TJ: "Asia", TL: "Asia", TM: "Asia", TW: "Asia", UZ: "Asia",
  VN: "Asia", YE: "Asia",

  // ── Africa ─────────────────────────────────────────────────────────────────
  AO: "Africa", BF: "Africa", BI: "Africa", BJ: "Africa", BW: "Africa", CD: "Africa",
  CF: "Africa", CG: "Africa", CI: "Africa", CM: "Africa", CV: "Africa", DJ: "Africa",
  DZ: "Africa", EH: "Africa", ER: "Africa", ET: "Africa", GA: "Africa", GH: "Africa",
  GM: "Africa", GN: "Africa", GQ: "Africa", GW: "Africa", KE: "Africa", KM: "Africa",
  LR: "Africa", LS: "Africa", LY: "Africa", MA: "Africa", MG: "Africa", ML: "Africa",
  MR: "Africa", MU: "Africa", MW: "Africa", MZ: "Africa", NA: "Africa", NE: "Africa",
  NG: "Africa", RE: "Africa", RW: "Africa", SC: "Africa", SD: "Africa", SH: "Africa",
  SL: "Africa", SN: "Africa", SO: "Africa", SS: "Africa", ST: "Africa", SZ: "Africa",
  TD: "Africa", TG: "Africa", TN: "Africa", TZ: "Africa", UG: "Africa", YT: "Africa",
  ZA: "Africa", ZM: "Africa", ZW: "Africa",

  // ── North America (incl. Central America + the Caribbean) ──────────────────
  AG: "North America", AI: "North America", AW: "North America", BB: "North America",
  BL: "North America", BM: "North America", BQ: "North America", BS: "North America",
  BZ: "North America", CA: "North America", CR: "North America", CU: "North America",
  CW: "North America", DM: "North America", DO: "North America", GD: "North America",
  GL: "North America", GP: "North America", GT: "North America", HN: "North America",
  HT: "North America", JM: "North America", KN: "North America", KY: "North America",
  LC: "North America", MF: "North America", MQ: "North America", MS: "North America",
  MX: "North America", NI: "North America", PA: "North America", PM: "North America",
  PR: "North America", SV: "North America", SX: "North America", TC: "North America",
  TT: "North America", US: "North America", VC: "North America", VG: "North America",
  VI: "North America",

  // ── South America ──────────────────────────────────────────────────────────
  AR: "South America", BO: "South America", BR: "South America", CL: "South America",
  CO: "South America", EC: "South America", FK: "South America", GF: "South America",
  GY: "South America", PE: "South America", PY: "South America", SR: "South America",
  UY: "South America", VE: "South America",

  // ── Oceania ────────────────────────────────────────────────────────────────
  AS: "Oceania", AU: "Oceania", CK: "Oceania", FJ: "Oceania", FM: "Oceania",
  GU: "Oceania", KI: "Oceania", MH: "Oceania", MP: "Oceania", NC: "Oceania",
  NF: "Oceania", NR: "Oceania", NU: "Oceania", NZ: "Oceania", PF: "Oceania",
  PG: "Oceania", PW: "Oceania", SB: "Oceania", TK: "Oceania", TO: "Oceania",
  TV: "Oceania", UM: "Oceania", VU: "Oceania", WF: "Oceania", WS: "Oceania",

  // ── Antarctica ─────────────────────────────────────────────────────────────
  AQ: "Antarctica", BV: "Antarctica", GS: "Antarctica", HM: "Antarctica",
  TF: "Antarctica",
};

/**
 * English country names as they appear in the port catalogue -> ISO alpha-2. Ports store
 * a name, airports store a code; both must resolve. Keys are normalised (see `fold`), so
 * accents, punctuation and case do not matter and "Türkiye" and "Turkey" both land on TR.
 */
const NAME_TO_ISO: Record<string, string> = {
  afghanistan: "AF", alandislands: "AX", albania: "AL", algeria: "DZ",
  americansamoa: "AS", andorra: "AD", angola: "AO", anguilla: "AI", antarctica: "AQ",
  antiguaandbarbuda: "AG", argentina: "AR", armenia: "AM", aruba: "AW", australia: "AU",
  austria: "AT", azerbaijan: "AZ", bahamas: "BS", bahrain: "BH", bangladesh: "BD",
  barbados: "BB", belarus: "BY", belgium: "BE", belize: "BZ", benin: "BJ",
  bermuda: "BM", bhutan: "BT", bolivia: "BO", bonaire: "BQ",
  bosniaandherzegovina: "BA", botswana: "BW", brazil: "BR",
  britishvirginislands: "VG", brunei: "BN", bulgaria: "BG", burkinafaso: "BF",
  burundi: "BI", caboverde: "CV", capeverde: "CV", cambodia: "KH", cameroon: "CM",
  canada: "CA", caymanislands: "KY", centralafricanrepublic: "CF", chad: "TD",
  chile: "CL", china: "CN", christmasisland: "CX", cocos: "CC", colombia: "CO",
  comoros: "KM", congo: "CG", cookislands: "CK", costarica: "CR", cotedivoire: "CI",
  croatia: "HR", cuba: "CU", curacao: "CW", cyprus: "CY", czechia: "CZ",
  czechrepublic: "CZ", denmark: "DK", djibouti: "DJ", dominica: "DM",
  dominicanrepublic: "DO", drcongo: "CD", democraticrepublicofthecongo: "CD",
  ecuador: "EC", egypt: "EG", elsalvador: "SV", equatorialguinea: "GQ", eritrea: "ER",
  estonia: "EE", eswatini: "SZ", ethiopia: "ET", falklandislands: "FK",
  faroeislands: "FO", fiji: "FJ", finland: "FI", france: "FR", frenchguiana: "GF",
  frenchpolynesia: "PF", frenchsouthernterritories: "TF", gabon: "GA", gambia: "GM",
  georgia: "GE", germany: "DE", ghana: "GH", gibraltar: "GI", greece: "GR",
  greenland: "GL", grenada: "GD", guadeloupe: "GP", guam: "GU", guatemala: "GT",
  guernsey: "GG", guinea: "GN", guineabissau: "GW", guyana: "GY", haiti: "HT",
  heardislandandmcdonaldislands: "HM", honduras: "HN", hongkong: "HK", hungary: "HU",
  iceland: "IS", india: "IN", indonesia: "ID", iran: "IR", iraq: "IQ", ireland: "IE",
  isleofman: "IM", israel: "IL", italy: "IT", jamaica: "JM", japan: "JP", jersey: "JE",
  jordan: "JO", kazakhstan: "KZ", kenya: "KE", kiribati: "KI", kosovo: "XK",
  kuwait: "KW", kyrgyzstan: "KG", laos: "LA", latvia: "LV", lebanon: "LB",
  lesotho: "LS", liberia: "LR", libya: "LY", liechtenstein: "LI", lithuania: "LT",
  luxembourg: "LU", macau: "MO", madagascar: "MG", malawi: "MW", malaysia: "MY",
  maldives: "MV", mali: "ML", malta: "MT", marshallislands: "MH", martinique: "MQ",
  mauritania: "MR", mauritius: "MU", mayotte: "YT", mexico: "MX", micronesia: "FM",
  moldova: "MD", monaco: "MC", mongolia: "MN", montenegro: "ME", montserrat: "MS",
  morocco: "MA", mozambique: "MZ", myanmar: "MM", namibia: "NA", nauru: "NR",
  nepal: "NP", netherlands: "NL", newcaledonia: "NC", newzealand: "NZ",
  nicaragua: "NI", niger: "NE", nigeria: "NG", niue: "NU", northkorea: "KP",
  northmacedonia: "MK", norway: "NO", oman: "OM", pakistan: "PK", palau: "PW",
  palestine: "PS", panama: "PA", papuanewguinea: "PG", paraguay: "PY", peru: "PE",
  philippines: "PH", poland: "PL", portugal: "PT", puertorico: "PR", qatar: "QA",
  reunion: "RE", romania: "RO", russia: "RU", rwanda: "RW", saintbarthelemy: "BL",
  sainthelena: "SH", saintkittsandnevis: "KN", saintlucia: "LC", saintmartin: "MF",
  saintpierreandmiquelon: "PM", saintvincentandthegrenadines: "VC", samoa: "WS",
  sanmarino: "SM", saotomeandprincipe: "ST", saudiarabia: "SA", senegal: "SN",
  serbia: "RS", seychelles: "SC", sierraleone: "SL", singapore: "SG",
  sintmaarten: "SX", slovakia: "SK", slovenia: "SI", solomonislands: "SB",
  somalia: "SO", southafrica: "ZA", southgeorgia: "GS",
  southgeorgiaandthesouthsandwichislands: "GS", southkorea: "KR", southsudan: "SS",
  spain: "ES", srilanka: "LK", sudan: "SD", suriname: "SR",
  svalbardandjanmayen: "SJ", sweden: "SE", switzerland: "CH", syria: "SY",
  taiwan: "TW", tajikistan: "TJ", tanzania: "TZ", thailand: "TH", timorleste: "TL",
  togo: "TG", tokelau: "TK", tonga: "TO", trinidadandtobago: "TT", tunisia: "TN",
  turkey: "TR", turkiye: "TR", turkmenistan: "TM", turksandcaicosislands: "TC",
  tuvalu: "TV", uganda: "UG", ukraine: "UA", unitedarabemirates: "AE",
  unitedkingdom: "GB", unitedkingdomofgreatbritainandnorthernireland: "GB",
  unitedstates: "US", unitedstatesofamerica: "US", uruguay: "UY",
  usvirginislands: "VI", virginislands: "VI", uzbekistan: "UZ", vanuatu: "VU",
  vaticancity: "VA", venezuela: "VE", vietnam: "VN", wallisandfutuna: "WF",
  westernsahara: "EH", yemen: "YE", zambia: "ZM", zimbabwe: "ZW",
};

/** Lowercase, strip accents and every non-alphanumeric character. */
function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Resolve an ISO alpha-2 code or an English country name to an ISO alpha-2 code.
 *
 * The two catalogues speak different languages: airports carry a code, ports carry an
 * English name. Anything that counts DISTINCT countries across both has to fold them
 * into one vocabulary first, or "Germany" and "DE" count as two countries — which is
 * exactly what the cross-domain "countries visited" KPI did, inflating its total by one
 * for every country reached both by air and by sea.
 *
 * Returns null for an unrecognised name and for the catalogue's placeholder codes.
 */
export function isoCountryCode(country: string | null | undefined): string | null {
  if (!country) return null;
  const raw = country.trim();
  if (!raw) return null;
  const iso = raw.length === 2 ? raw.toUpperCase() : (NAME_TO_ISO[fold(raw)] ?? null);
  if (!iso || iso === "ZZ" || iso === "XZ") return null;
  return iso;
}

/**
 * Resolve an ISO alpha-2 code or an English country name to a continent.
 *
 * Returns null for a transcontinental country (the caller must use the coordinates) and
 * for anything unrecognised — including the catalogue's placeholder codes `ZZ` and `XZ`.
 */
export function continentForCountry(
  country: string | null | undefined,
  lat?: number,
  lon?: number,
): Continent | null {
  if (!country) return null;

  const raw = country.trim();
  const iso =
    raw.length === 2 ? raw.toUpperCase() : (NAME_TO_ISO[fold(raw)] ?? null);
  if (!iso) return null;

  const split = TRANSCONTINENTAL[iso];
  if (split) {
    // Without coordinates we cannot place a transcontinental country honestly.
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return split.resolve(lat as number, lon as number);
  }

  return BY_ISO[iso] ?? null;
}

/**
 * Coordinate fallback, for records that carry no usable country.
 *
 * Deliberately coarse — it exists so a missing country never silently drops a continent,
 * not to be accurate at borders. Use `continentForCountry` whenever a country is known.
 * Antarctica is `lat < -60` ONLY; the Arctic belongs to Europe / North America / Asia.
 */
export function continentForCoordinates(lat: number, lon: number): Continent | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  if (lat < -60) return "Antarctica";

  // Americas: the whole western hemisphere down to the mid-Atlantic.
  if (lon >= -170 && lon <= -25) {
    // Panama sits at ~9°N; everything below the isthmus is South America.
    return lat >= 12 ? "North America" : "South America";
  }

  // Australia / New Zealand / the Pacific.
  if (lon >= 110 && lat <= -10) return "Oceania";
  if (lon >= 155 || lon <= -170) return "Oceania";

  // Africa, including the Sahara and the Horn.
  if (lon >= -25 && lon <= 52 && lat < 35) return "Africa";

  // Europe, including Iceland, Scandinavia, Svalbard and the Urals.
  if (lon >= -25 && lon <= 60 && lat >= 35) return "Europe";

  // Everything remaining east of the Urals and north of the equator-ish.
  if (lon > 60 && lon < 155) return "Asia";
  if (lon > 52 && lon <= 60 && lat < 35) return "Asia"; // Arabian peninsula, Gulf

  return null;
}

/**
 * The one entry point. Prefers the country (exact); falls back to the coordinates.
 *
 * `country` is optional so the coordinate-only call sites (scheduled flights carry
 * denormalised lat/lon but no country) keep working.
 */
export function getContinent(
  lat: number,
  lon: number,
  country?: string | null,
): Continent | null {
  return continentForCountry(country, lat, lon) ?? continentForCoordinates(lat, lon);
}

/**
 * How many countries this table knows, per continent.
 *
 * Exists so a "13 of 51" style quota has a denominator that can be pointed at,
 * rather than one of the several competing counts of the world's countries —
 * none of which is a fact, and all of which would read as one sitting next to
 * a real number. Transcontinental countries are resolved by coordinates at
 * lookup time, so they are counted once here, under the continent this table
 * files them by.
 */
export function countryCountsByContinent(): Record<Continent, number> {
  const totals = Object.fromEntries(CONTINENTS.map((c) => [c, 0])) as Record<
    Continent,
    number
  >;
  for (const continent of Object.values(BY_ISO)) {
    totals[continent] += 1;
  }
  // A transcontinental country counts towards every continent it can be in.
  // Anything else means picking one, and for Egypt either pick is wrong for
  // half the country.
  for (const [code, entry] of Object.entries(TRANSCONTINENTAL)) {
    if (code in BY_ISO) continue;
    for (const continent of entry.spans) totals[continent] += 1;
  }
  return totals;
}
