/**
 * German exonym + local-endonym expansion for port search and import.
 *
 * The port catalog stores English/UN-LOCODE names ("Lisbon", "Venice"),
 * but two sources disagree with that spelling:
 *  - the primary user base types German exonyms ("Lissabon", "Venedig"),
 *  - cruise booking confirmations sometimes print the local endonym
 *    ("Lisboa", "Roma", "Napoli", "Venezia").
 * Both previously returned zero hits — pushing users into duplicate
 * custom ports, and leaving imported cruise stops unmatched.
 * `expandPortSearchTerms` maps a (possibly partial) query onto the
 * matching English catalog names so the search route can OR them into its
 * contains-search and the cruise resolver can match them to a port.
 *
 * Matching is prefix-based in both directions so suggestions appear
 * while the user is still typing ("Lissab" → "Lisbon").
 */

const GERMAN_PORT_EXONYMS: Record<string, string> = {
  lissabon: "Lisbon",
  // Local endonyms printed on booking confirmations (non-German).
  lisboa: "Lisbon",
  // Rome/Florence have no Italian catalog port of that name — the cruise
  // ports are Civitavecchia and Livorno respectively. Map both the local
  // endonym and the German exonym (below) to the real port of call.
  roma: "Civitavecchia",
  napoli: "Naples",
  venezia: "Venice",
  firenze: "Livorno",
  genova: "Genoa",
  københavn: "Copenhagen",
  kopenhagen: "Copenhagen",
  venedig: "Venice",
  genua: "Genoa",
  neapel: "Naples",
  rom: "Civitavecchia",
  athen: "Athens",
  piräus: "Piraeus",
  korfu: "Corfu",
  kreta: "Crete",
  rhodos: "Rhodes",
  santorin: "Santorini",
  antwerpen: "Antwerp",
  brügge: "Bruges",
  seebrügge: "Zeebrugge",
  göteborg: "Gothenburg",
  danzig: "Gdansk",
  stettin: "Szczecin",
  kapstadt: "Cape Town",
  havanna: "Havana",
  singapur: "Singapore",
  tanger: "Tangier",
  teneriffa: "Tenerife",
  "sankt petersburg": "Saint Petersburg",
  "st. petersburg": "Saint Petersburg",
  sevilla: "Seville",
  triest: "Trieste",
  tarent: "Taranto",
  apulien: "Taranto",
  sardinien: "Sardinia",
  korsika: "Corsica",
  edinburg: "Edinburgh",
  mailand: "Milan",
  florenz: "Livorno",
  livorno: "Livorno",
  syrakus: "Syracuse",
  messina: "Messina",
  palermo: "Palermo",
  nizza: "Nice",
  marseille: "Marseille",
  algier: "Algiers",
  alexandria: "Alexandria",
  istanbul: "Istanbul",
  akaba: "Aqaba",
  dschidda: "Jeddah",
  maskat: "Muscat",
  bombay: "Mumbai",
  kalkutta: "Kolkata",
  rangun: "Yangon",
  kanton: "Guangzhou",
  schanghai: "Shanghai",
  peking: "Beijing",
  tokio: "Tokyo",
  seoul: "Seoul",
  hongkong: "Hong Kong",
  honolulu: "Honolulu",
  "neu-york": "New York",
  neufundland: "Newfoundland",
  grönland: "Greenland",
  reykjavik: "Reykjavik",
  warschau: "Warsaw",
  moskau: "Moscow",
  archangelsk: "Arkhangelsk",
  odessa: "Odesa",
  konstanza: "Constanta",
  bukarest: "Bucharest",
  saloniki: "Thessaloniki",
  thessaloniki: "Thessaloniki",
  dubrovnik: "Dubrovnik",
  ragusa: "Dubrovnik",
  spalato: "Split",
  zara: "Zadar",
  kairo: "Cairo",
  thorshavn: "Torshavn",
  färöer: "Faroe",
  azoren: "Azores",
  kanaren: "Canary",
  madeira: "Madeira",
};

/** Normalise for lookup: lowercase + trim. Umlauts stay as typed. */
const normalise = (s: string): string => s.toLowerCase().trim();

/**
 * Returns additional English search terms for a (partial) German port
 * query. Empty when nothing matches — the caller always searches the
 * original query too.
 */
export function expandPortSearchTerms(query: string): string[] {
  const q = normalise(query);
  if (q.length < 3) return [];

  const expansions = new Set<string>();
  for (const [exonym, english] of Object.entries(GERMAN_PORT_EXONYMS)) {
    // Prefix match both ways: a partial query matches the exonym
    // ("lissab" → lissabon), and an over-typed query still matches
    // ("lissabon hafen" startsWith is false — but exonym-prefix covers
    // the common typing flow).
    if (exonym.startsWith(q) || q.startsWith(exonym)) {
      expansions.add(english);
    }
  }
  return Array.from(expansions);
}
