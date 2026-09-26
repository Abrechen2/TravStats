/**
 * Every place the demo traveller slept, keyed so a trip can name it. Real
 * houses at their real addresses — looked up in OpenStreetMap (Nominatim) on
 * 2026-09-26. A house stayed in twice is one entry with two stays, which is
 * what the lodging pages count.
 *
 * `chain` is a catalogue chain by its catalogue name (`lodging_chains.csv`),
 * or `Motel One`, which the catalogue does not carry and the demo account adds
 * as its own chain — the way a user would.
 */

export type LodgingType = "hotel" | "campsite" | "guesthouse" | "apartment" | "hostel";

export interface LodgingSpec {
  name: string;
  type: LodgingType;
  chain: string | null;
  address: string;
  city: string;
  country: string;
  iso: string;
  lat: number;
  lon: number;
  stars: number | null;
}

/** The chain the demo account creates for itself. */
export const USER_CHAIN = { name: "Motel One", brandColor: "#5b6f7c" } as const;

const h = (
  name: string,
  chain: string | null,
  address: string,
  city: string,
  country: string,
  iso: string,
  lat: number,
  lon: number,
  stars: number | null,
  type: LodgingType = "hotel"
): LodgingSpec => ({ name, type, chain, address, city, country, iso, lat, lon, stars });

const camp = (
  name: string,
  address: string,
  city: string,
  country: string,
  iso: string,
  lat: number,
  lon: number
) => h(name, null, address, city, country, iso, lat, lon, null, "campsite");

const hut = (name: string, address: string, lat: number, lon: number) =>
  h(name, null, address, "Cortina d'Ampezzo", "Italien", "IT", lat, lon, null, "guesthouse");

export const LODGINGS = {
  // Great Britain & Ireland
  "premier-inn-county-hall": h(
    "Premier Inn London County Hall",
    null,
    "Belvedere Road, London SE1 7PB",
    "London",
    "Vereinigtes Königreich",
    "GB",
    51.50248,
    -0.11825,
    3
  ),
  "hilton-paddington": h(
    "Hilton London Paddington",
    "Hilton",
    "146 Praed Street, London W2 1BA",
    "London",
    "Vereinigtes Königreich",
    "GB",
    51.51581,
    -0.17606,
    4
  ),
  "motel-one-edinburgh": h(
    "Motel One Edinburgh-Princes",
    "Motel One",
    "10-15 Princes Street, Edinburgh EH2 2AN",
    "Edinburgh",
    "Vereinigtes Königreich",
    "GB",
    55.95352,
    -3.19003,
    3
  ),
  "westin-dublin": h(
    "The Westin Dublin",
    "Marriott",
    "Westmoreland Street, Dublin 2",
    "Dublin",
    "Irland",
    "IE",
    53.34561,
    -6.25843,
    5
  ),

  // Iberia & islands
  "melia-palma-bay": h(
    "Meliá Palma Bay",
    "Meliá",
    "Carrer de Felicià Fuster 4, 07006 Palma",
    "Palma",
    "Spanien",
    "ES",
    39.56319,
    2.66563,
    4
  ),
  "nh-calderon": h(
    "NH Collection Barcelona Gran Hotel Calderón",
    "NH Hotels",
    "Rambla de Catalunya 26, 08007 Barcelona",
    "Barcelona",
    "Spanien",
    "ES",
    41.38946,
    2.16634,
    4
  ),
  "memmo-alfama": h(
    "Memmo Alfama",
    null,
    "Travessa das Merceeiras 27, 1100-348 Lisboa",
    "Lissabon",
    "Portugal",
    "PT",
    38.71028,
    -9.13046,
    4
  ),
  "pestana-porto": h(
    "Pestana Vintage Porto",
    null,
    "Praça da Ribeira 1, 4050-513 Porto",
    "Porto",
    "Portugal",
    "PT",
    41.1405,
    -8.61319,
    5
  ),
  "pestana-casino-park": h(
    "Pestana Casino Park",
    null,
    "Rua Imperatriz Dona Amélia, 9004-513 Funchal",
    "Funchal",
    "Portugal",
    "PT",
    32.6438,
    -16.91734,
    5
  ),

  // Western & central Europe
  "ibis-gare-du-nord": h(
    "ibis Paris Gare du Nord Château Landon",
    "Accor",
    "197 Rue La Fayette, 75010 Paris",
    "Paris",
    "Frankreich",
    "FR",
    48.88108,
    2.36279,
    3
  ),
  "motel-one-wien-staatsoper": h(
    "Motel One Wien-Staatsoper",
    "Motel One",
    "Elisabethstraße 5, 1010 Wien",
    "Wien",
    "Österreich",
    "AT",
    48.20159,
    16.36798,
    3
  ),
  "motel-one-wien-hbf": h(
    "Motel One Wien-Hauptbahnhof",
    "Motel One",
    "Gerhard-Bronner-Straße 11, 1100 Wien",
    "Wien",
    "Österreich",
    "AT",
    48.18368,
    16.3783,
    3
  ),
  "novotel-wien-hbf": h(
    "Novotel Wien Hauptbahnhof",
    "Accor",
    "Canettistraße 6, 1100 Wien",
    "Wien",
    "Österreich",
    "AT",
    48.18567,
    16.37922,
    4
  ),
  "motel-one-zurich": h(
    "Motel One Zürich",
    "Motel One",
    "Brandschenkestrasse 25, 8002 Zürich",
    "Zürich",
    "Schweiz",
    "CH",
    47.3694,
    8.53357,
    3
  ),
  "radisson-blu-zurich": h(
    "Radisson Hotel Zurich Airport",
    "Radisson",
    "Flughofstrasse, 8153 Rümlang",
    "Zürich",
    "Schweiz",
    "CH",
    47.45099,
    8.54014,
    4
  ),
  "luzern-schweizerhof": h(
    "Hotel Schweizerhof Luzern",
    null,
    "Schweizerhofquai 3, 6004 Luzern",
    "Luzern",
    "Schweiz",
    "CH",
    47.05431,
    8.31017,
    5
  ),
  "matterhorn-focus": h(
    "Matterhorn Focus",
    null,
    "Schluhmattstrasse 131, 3920 Zermatt",
    "Zermatt",
    "Schweiz",
    "CH",
    46.014,
    7.74259,
    4
  ),
  "waldhaus-st-moritz": h(
    "Hotel Waldhaus am See",
    null,
    "Via Dimlej 6, 7500 St. Moritz",
    "St. Moritz",
    "Schweiz",
    "CH",
    46.49714,
    9.84904,
    3
  ),
  "scandic-kodbyen": h(
    "Scandic Kødbyen",
    "Scandic",
    "Skelbækgade 4, 1717 København",
    "Kopenhagen",
    "Dänemark",
    "DK",
    55.66693,
    12.55813,
    4
  ),
  "stary-krakow": h(
    "Hotel Stary",
    null,
    "Szczepańska 5, 31-011 Kraków",
    "Krakau",
    "Polen",
    "PL",
    50.06318,
    19.93656,
    5
  ),
  "aria-budapest": h(
    "Aria Hotel Budapest",
    null,
    "Hercegprímás utca 5, 1051 Budapest",
    "Budapest",
    "Ungarn",
    "HU",
    47.49985,
    19.05359,
    5
  ),
  "hotel-josef-prague": h(
    "Design Hotel Josef",
    null,
    "Rybná 20, 110 00 Praha 1",
    "Prag",
    "Tschechien",
    "CZ",
    50.09009,
    14.42644,
    4
  ),
  "excelsior-dubrovnik": h(
    "Hotel Excelsior Dubrovnik",
    null,
    "Frana Supila 12, 20000 Dubrovnik",
    "Dubrovnik",
    "Kroatien",
    "HR",
    42.64115,
    18.1193,
    5
  ),
  "dukes-palace-brugge": h(
    "Hotel Dukes' Palace",
    null,
    "Prinsenhof 8, 8000 Brugge",
    "Brügge",
    "Belgien",
    "BE",
    51.20849,
    3.21996,
    5
  ),
  "ink-amsterdam": h(
    "INK Hotel Amsterdam – MGallery",
    "Accor",
    "Nieuwezijds Voorburgwal 67, 1012 RE Amsterdam",
    "Amsterdam",
    "Niederlande",
    "NL",
    52.37551,
    4.89293,
    4
  ),
  "pera-palace": h(
    "Pera Palace Hotel",
    null,
    "Meşrutiyet Caddesi 52, 34430 Beyoğlu, İstanbul",
    "Istanbul",
    "Türkei",
    "TR",
    41.03105,
    28.97347,
    5
  ),
  "aldemar-knossos": h(
    "Aldemar Knossos Royal",
    null,
    "Agiou Georgiou, 700 14 Chersonissos",
    "Chersonissos",
    "Griechenland",
    "GR",
    35.33528,
    25.38333,
    5
  ),

  // Germany (business and the Mosel)
  "motel-one-muc": h(
    "Motel One München-Sendlinger Tor",
    "Motel One",
    "Herzog-Wilhelm-Straße 28, 80331 München",
    "München",
    "Deutschland",
    "DE",
    48.13467,
    11.56682,
    3
  ),
  "motel-one-ham": h(
    "Motel One Hamburg am Michel",
    "Motel One",
    "Ludwig-Erhard-Straße 26, 20459 Hamburg",
    "Hamburg",
    "Deutschland",
    "DE",
    53.54975,
    9.97495,
    3
  ),
  "motel-one-ber": h(
    "Motel One Berlin-Hauptbahnhof",
    "Motel One",
    "Invalidenstraße 54, 10557 Berlin",
    "Berlin",
    "Deutschland",
    "DE",
    52.52578,
    13.36599,
    3
  ),
  "nh-berlin-friedrichstrasse": h(
    "NH Collection Berlin Mitte Friedrichstraße",
    "NH Hotels",
    "Friedrichstraße 96, 10117 Berlin",
    "Berlin",
    "Deutschland",
    "DE",
    52.51958,
    13.3889,
    4
  ),
  "scandic-emporio": h(
    "Scandic Hamburg Emporio",
    "Scandic",
    "Dammtorwall 19, 20355 Hamburg",
    "Hamburg",
    "Deutschland",
    "DE",
    53.55612,
    9.98229,
    4
  ),
  "marriott-hamburg": h(
    "Hamburg Marriott Hotel",
    "Marriott",
    "ABC-Straße 52, 20354 Hamburg",
    "Hamburg",
    "Deutschland",
    "DE",
    53.5547,
    9.98731,
    4
  ),
  "bernkastel-doctor": h(
    "Hotel Doctor Weinstuben",
    null,
    "Hebegasse 5, 54470 Bernkastel-Kues",
    "Bernkastel-Kues",
    "Deutschland",
    "DE",
    49.916,
    7.0706,
    3
  ),
  "zell-gruener-kranz": h(
    "Hotel Zum Grünen Kranz",
    null,
    "Balduinstraße 13, 56856 Zell (Mosel)",
    "Zell (Mosel)",
    "Deutschland",
    "DE",
    50.02425,
    7.18197,
    3
  ),
  "cochem-germania": h(
    "Hotel Germania",
    null,
    "Moselpromenade 1, 56812 Cochem",
    "Cochem",
    "Deutschland",
    "DE",
    50.14693,
    7.16639,
    3
  ),
  "lindau-bayerischer-hof": h(
    "Hotel Bayerischer Hof",
    null,
    "Bahnhofplatz 2, 88131 Lindau",
    "Lindau",
    "Deutschland",
    "DE",
    47.54422,
    9.68205,
    4
  ),
  "prien-luitpold": h(
    "Hotel Luitpold am See",
    null,
    "Seestraße 110, 83209 Prien am Chiemsee",
    "Prien am Chiemsee",
    "Deutschland",
    "DE",
    47.8614,
    12.36599,
    3
  ),

  // Italy
  "nh-roma": h(
    "Hotel Artemide",
    null,
    "Via Nazionale 22, 00184 Roma",
    "Rom",
    "Italien",
    "IT",
    41.90083,
    12.49361,
    4
  ),
  "bormio-nazionale": h(
    "Hotel Nazionale",
    null,
    "Via al Forte 28, 23032 Bormio",
    "Bormio",
    "Italien",
    "IT",
    46.4692,
    10.3715,
    4
  ),
  "brunelleschi-florenz": h(
    "Hotel Brunelleschi",
    null,
    "Piazza Santa Elisabetta 3, 50122 Firenze",
    "Florenz",
    "Italien",
    "IT",
    43.77173,
    11.25588,
    4
  ),
  "athena-siena": h(
    "Hotel Athena",
    null,
    "Via Paolo Mascagni 55, 53100 Siena",
    "Siena",
    "Italien",
    "IT",
    43.31459,
    11.32488,
    4
  ),
  "pienza-agriturismo": h(
    "Agriturismo Il Rigo",
    null,
    "Strada Comunale di Casabianca, 53027 San Quirico d'Orcia",
    "San Quirico d'Orcia",
    "Italien",
    "IT",
    43.05732,
    11.6356,
    null,
    "guesthouse"
  ),
  "ilaria-lucca": h(
    "Hotel Ilaria",
    null,
    "Via del Fosso 26, 55100 Lucca",
    "Lucca",
    "Italien",
    "IT",
    43.84305,
    10.50989,
    4
  ),
  "metropole-como": h(
    "Hotel Metropole Suisse",
    null,
    "Piazza Cavour 19, 22100 Como",
    "Como",
    "Italien",
    "IT",
    45.81295,
    9.08013,
    4
  ),
  "hotel-lago-braies": h(
    "Hotel Lago di Braies",
    null,
    "Pragser Wildsee, 39030 Prags",
    "Prags",
    "Italien",
    "IT",
    46.69883,
    12.08455,
    3
  ),
  "rif-sennes": h(
    "Sennes-Hütte",
    null,
    "Senes 1, 39030 Enneberg",
    "Enneberg",
    "Italien",
    "IT",
    46.6536,
    12.05942,
    null,
    "guesthouse"
  ),
  "rif-fanes": h(
    "Faneshütte (Rifugio Fanes)",
    null,
    "Fanes, 39030 Enneberg",
    "Enneberg",
    "Italien",
    "IT",
    46.61219,
    12.01416,
    null,
    "guesthouse"
  ),
  "rif-lagazuoi": hut(
    "Rifugio Lagazuoi",
    "Passo Falzarego, 32043 Cortina d'Ampezzo",
    46.52775,
    12.00813
  ),
  "rif-averau": hut(
    "Rifugio Averau",
    "Forcella Averau, 32043 Cortina d'Ampezzo",
    46.49957,
    12.0406
  ),
  "cortina-poste": h(
    "Hotel de la Poste",
    null,
    "Piazza Roma 14, 32043 Cortina d'Ampezzo",
    "Cortina d'Ampezzo",
    "Italien",
    "IT",
    46.5381,
    12.1358,
    4
  ),

  // Austria (motorbike)
  "heiligenblut-glocknerhof": h(
    "Hotel Glocknerhof",
    null,
    "Hof 6, 9844 Heiligenblut am Großglockner",
    "Heiligenblut",
    "Österreich",
    "AT",
    47.03977,
    12.84184,
    4
  ),

  // Scandinavia & Iceland
  "scandic-ornen": h(
    "Scandic Ørnen",
    "Scandic",
    "Lars Hilles gate 18, 5008 Bergen",
    "Bergen",
    "Norwegen",
    "NO",
    60.38831,
    5.33171,
    4
  ),
  "scandic-kirkenes": h(
    "Scandic Kirkenes",
    "Scandic",
    "Kielland Torkildsens gate 15, 9900 Kirkenes",
    "Kirkenes",
    "Norwegen",
    "NO",
    69.7264,
    30.04427,
    3
  ),
  "canopy-reykjavik": h(
    "Canopy by Hilton Reykjavik City Centre",
    "Hilton",
    "Smiðjustígur 4, 101 Reykjavík",
    "Reykjavík",
    "Island",
    "IS",
    64.14634,
    -21.93042,
    4
  ),
  "kria-vik": h(
    "Hotel Kría",
    null,
    "Sléttuvegur 12-14, 870 Vík",
    "Vík",
    "Island",
    "IS",
    63.41808,
    -18.99344,
    3
  ),
  "hofn-hotel": h(
    "Hótel Höfn",
    null,
    "Víkurbraut 20, 780 Höfn",
    "Höfn",
    "Island",
    "IS",
    64.2575,
    -15.2126,
    3
  ),

  // Campsites of the motorhome trip
  "camp-haithabu": camp(
    "Campingplatz Haithabu",
    "Haddebyer Chaussee 15, 24866 Busdorf",
    "Busdorf",
    "Deutschland",
    "DE",
    54.50139,
    9.57204
  ),
  "camp-hirtshals": camp(
    "Hirtshals Camping",
    "Kystvejen 6, 9850 Hirtshals",
    "Hirtshals",
    "Dänemark",
    "DK",
    57.58636,
    9.94518
  ),
  "camp-mosvangen": camp(
    "Mosvangen Camping",
    "Henrik Ibsens gate 1, 4021 Stavanger",
    "Stavanger",
    "Norwegen",
    "NO",
    58.952,
    5.71626
  ),
  "camp-odda": camp(
    "Lofthus Camping",
    "Hellelandsvegen, 5781 Lofthus",
    "Lofthus",
    "Norwegen",
    "NO",
    60.33618,
    6.65659
  ),
  "camp-bergen": camp(
    "Bergen Camping Park",
    "Breistølen 11, 5111 Breistein",
    "Bergen",
    "Norwegen",
    "NO",
    60.4851,
    5.38172
  ),
  "camp-flam": camp(
    "Flåm Camping og Vandrerhjem",
    "Nedre Brekkevegen 12, 5743 Flåm",
    "Flåm",
    "Norwegen",
    "NO",
    60.86296,
    7.10728
  ),
  "camp-geiranger": camp(
    "Geiranger Camping",
    "Homlungsvegen, 6216 Geiranger",
    "Geiranger",
    "Norwegen",
    "NO",
    62.09913,
    7.20298
  ),
  "camp-bogstad": camp(
    "Bogstad Camping",
    "Ankerveien 117, 0766 Oslo",
    "Oslo",
    "Norwegen",
    "NO",
    59.96249,
    10.64229
  ),
  "camp-askim": camp(
    "Lisebergs Camping Askim Strand",
    "Marholmsvägen 124, 436 45 Askim",
    "Göteborg",
    "Schweden",
    "SE",
    57.62774,
    11.91958
  ),
  "camp-sibbarp": camp(
    "Sibbarps Camping",
    "Strandkasten 5, 216 11 Limhamn",
    "Malmö",
    "Schweden",
    "SE",
    55.57179,
    12.91058
  ),
  "camp-wulfen": camp(
    "Camping Wulfener Hals",
    "Wulfener Hals Weg 100, 23769 Fehmarn",
    "Fehmarn",
    "Deutschland",
    "DE",
    54.40504,
    11.17772
  ),

  // North America
  "marriott-marquis-sf": h(
    "San Francisco Marriott Marquis",
    "Marriott",
    "780 Mission Street, San Francisco, CA 94103",
    "San Francisco",
    "USA",
    "US",
    37.78543,
    -122.40449,
    4
  ),
  "yosemite-valley-lodge": h(
    "Yosemite Valley Lodge",
    null,
    "9006 Yosemite Lodge Drive, Yosemite Valley, CA 95389",
    "Yosemite Valley",
    "USA",
    "US",
    37.74326,
    -119.59842,
    3
  ),
  "mammoth-mountain-inn": h(
    "Mammoth Mountain Inn",
    null,
    "10400 Minaret Road, Mammoth Lakes, CA 93546",
    "Mammoth Lakes",
    "USA",
    "US",
    37.65176,
    -119.03858,
    3
  ),
  "ranch-death-valley": h(
    "The Ranch at Death Valley",
    null,
    "Highway 190, Furnace Creek, CA 92328",
    "Furnace Creek",
    "USA",
    "US",
    36.45874,
    -116.87139,
    3
  ),
  "cosmopolitan-lv": h(
    "The Cosmopolitan of Las Vegas",
    "Marriott",
    "3708 Las Vegas Boulevard South, Las Vegas, NV 89109",
    "Las Vegas",
    "USA",
    "US",
    36.11016,
    -115.17409,
    5
  ),
  "cable-mountain-lodge": h(
    "Cable Mountain Lodge",
    null,
    "147 Zion Park Boulevard, Springdale, UT 84767",
    "Springdale",
    "USA",
    "US",
    37.19877,
    -112.99001,
    3
  ),
  "hampton-page": h(
    "Hampton Inn & Suites Page – Lake Powell",
    "Hilton",
    "294 Sandhill Road, Page, AZ 86040",
    "Page",
    "USA",
    "US",
    36.90218,
    -111.48279,
    3
  ),
  "el-tovar": h(
    "El Tovar Hotel",
    null,
    "1 Village Loop Drive, Grand Canyon, AZ 86023",
    "Grand Canyon Village",
    "USA",
    "US",
    36.05744,
    -112.13762,
    3
  ),
  "meridien-santa-monica": h(
    "Loews Santa Monica Beach Hotel",
    null,
    "1700 Ocean Avenue, Santa Monica, CA 90401",
    "Santa Monica",
    "USA",
    "US",
    34.0091,
    -118.49315,
    4
  ),

  // Asia
  "marriott-surawongse": h(
    "Bangkok Marriott Hotel The Surawongse",
    "Marriott",
    "262 Surawong Road, Bangkok 10500",
    "Bangkok",
    "Thailand",
    "TH",
    13.72769,
    100.52217,
    5
  ),
  "tamarind-village": h(
    "Tamarind Village",
    null,
    "50/1 Rajdamnoen Road, Chiang Mai 50200",
    "Chiang Mai",
    "Thailand",
    "TH",
    18.78909,
    98.99005,
    4
  ),
  "jw-khao-lak": h(
    "JW Marriott Khao Lak Resort & Spa",
    "Marriott",
    "41/12 Moo 3, Khuekkhak, Takua Pa, Phang Nga 82190",
    "Khao Lak",
    "Thailand",
    "TH",
    8.70151,
    98.24046,
    5
  ),
  "tokyo-marriott": h(
    "Tokyo Marriott Hotel",
    "Marriott",
    "4-7-36 Kitashinagawa, Shinagawa-ku, Tokyo 140-0001",
    "Tokio",
    "Japan",
    "JP",
    35.62217,
    139.737,
    4
  ),
  "kanra-kyoto": h(
    "Hotel Kanra Kyoto",
    null,
    "190 Kitamachi, Shimogyo-ku, Kyoto 600-8176",
    "Kyoto",
    "Japan",
    "JP",
    34.99594,
    135.75972,
    4
  ),
  "granvia-hiroshima": h(
    "Hotel Granvia Hiroshima",
    null,
    "1-5 Matsubaracho, Minami-ku, Hiroshima 732-0822",
    "Hiroshima",
    "Japan",
    "JP",
    34.39905,
    132.4755,
    4
  ),
  "metropole-hanoi": h(
    "Sofitel Legend Metropole Hanoi",
    "Accor",
    "15 Ngô Quyền, Hoàn Kiếm, Hà Nội",
    "Hanoi",
    "Vietnam",
    "VN",
    21.02549,
    105.85598,
    5
  ),
  "marina-bay-sands": h(
    "Marina Bay Sands",
    null,
    "10 Bayfront Avenue, Singapore 018956",
    "Singapur",
    "Singapur",
    "SG",
    1.2837,
    103.86072,
    5
  ),

  // Africa
  "radisson-red-cpt": h(
    "Radisson RED Hotel V&A Waterfront",
    "Radisson",
    "Silo Square, V&A Waterfront, Cape Town 8001",
    "Kapstadt",
    "Südafrika",
    "ZA",
    -33.90929,
    18.42269,
    4
  ),
  "riad-kniza": h(
    "Riad Kniza",
    null,
    "34 Derb l'Hotel, Bab Doukala, Marrakech 40030",
    "Marrakesch",
    "Marokko",
    "MA",
    31.633,
    -7.99772,
    null,
    "guesthouse"
  ),
} satisfies Record<string, LodgingSpec>;

export type LodgingKey = keyof typeof LODGINGS;
