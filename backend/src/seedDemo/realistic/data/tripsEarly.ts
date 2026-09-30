import { JULIA, LENA, TOBIAS, BONVOY, ALL_ACCOR, fl, note, place, rail, stay } from "./build";
import type { TripSpec } from "./types";

/**
 * The first four years of the demo traveller's logbook (nine to six years
 * ago): city breaks from Köln/Bonn and Düsseldorf, a first long-haul road trip
 * through the American West, a fjord cruise reached by train, three weeks in
 * Thailand, and the motorbike over the Alpine passes.
 */

const LONDON = ["London", "Vereinigtes Königreich", "GB"] as const;
const PALMA = ["Palma", "Spanien", "ES"] as const;
const CA = ["Kalifornien", "USA", "US"] as const;
const BCN = ["Barcelona", "Spanien", "ES"] as const;
const DUBLIN = ["Dublin", "Irland", "IE"] as const;
const CRETE = ["Kreta", "Griechenland", "GR"] as const;
const VIENNA = ["Wien", "Österreich", "AT"] as const;
const LISBON = ["Lissabon", "Portugal", "PT"] as const;
const NORWAY = ["Westnorwegen", "Norwegen", "NO"] as const;
const THAILAND = ["Thailand", "Thailand", "TH"] as const;
const BRUGES = ["Brügge", "Belgien", "BE"] as const;
const AMSTERDAM = ["Amsterdam", "Niederlande", "NL"] as const;
const ROME = ["Rom", "Italien", "IT"] as const;
const ALPS = ["Alpen", "Italien", "IT"] as const;
const CPH = ["Kopenhagen", "Dänemark", "DK"] as const;
const PRAGUE = ["Prag", "Tschechien", "CZ"] as const;

export const EARLY_TRIPS: readonly TripSpec[] = [
  {
    key: "london",
    name: "London verlängertes Wochenende",
    anchor: { yearsAgo: 9, month: 3, day: 17 },
    days: 4,
    category: "weekend",
    color: "#ef4444",
    icon: "🎡",
    origin: "Köln",
    destination: "London",
    companions: [JULIA],
    tags: ["Städtetrip"],
    flights: [
      fl(0, "EW 460", "CGN", "LHR", "07:10", "07:35", "A320", {
        reg: "D-AEWM",
        seat: "7A",
        delay: 4,
        price: 89,
        terminal: "1",
      }),
      fl(3, "EW 461", "LHR", "CGN", "19:55", "22:15", "A320", {
        reg: "D-AEWS",
        seat: "9C",
        delay: 32,
        price: 104,
        notes: "Slot in Heathrow, eine halbe Stunde auf dem Vorfeld gestanden.",
      }),
    ],
    stays: [stay("premier-inn-county-hall", 0, 3, 489, "GBP", "none", 4, { room: "Doppelzimmer" })],
    places: [
      place("Tower of London", "landmark", 51.5081, -0.0759, LONDON, 1, 5, {
        curated: "world-heritage:488",
      }),
      place("Westminster Abbey", "landmark", 51.4993, -0.1273, LONDON, 0, 4, {
        curated: "world-heritage:426",
      }),
      place("Borough Market", "restaurant", 51.5055, -0.091, LONDON, 1, 5),
      place("British Museum", "museum", 51.5194, -0.127, LONDON, 2, 5),
      place("Sky Garden", "viewpoint", 51.5112, -0.0835, LONDON, 2, 4),
    ],
    journal: [
      note(
        1,
        "Tower und Borough Market",
        "Morgens direkt zum Tower, die Kronjuwelen gingen schneller als gedacht. Mittags durch den Borough Market gegessen – ein zweiter Magen wäre praktisch gewesen.",
        "zufrieden",
        "bewölkt, 11 °C"
      ),
    ],
  },
  {
    key: "mallorca",
    name: "Mallorca mit Tobias und Lena",
    anchor: { yearsAgo: 9, month: 6, day: 10 },
    days: 8,
    category: "vacation",
    color: "#f97316",
    icon: "🏖️",
    origin: "Düsseldorf",
    destination: "Palma",
    companions: [JULIA, TOBIAS, LENA],
    tags: ["Badeurlaub", "Freunde"],
    flights: [
      fl(0, "EW 7582", "DUS", "PMI", "06:25", "08:35", "A320", {
        reg: "D-AEWG",
        seat: "12F",
        delay: 0,
        price: 139,
      }),
      fl(7, "EW 7583", "PMI", "DUS", "09:20", "11:40", "A320", {
        reg: "D-AEWG",
        seat: "14A",
        delay: 9,
        price: 159,
      }),
    ],
    stays: [
      stay("melia-palma-bay", 0, 7, 1260, "EUR", "breakfast", 4, { room: "Superior Meerblick" }),
    ],
    places: [
      place("Kathedrale La Seu", "landmark", 39.5675, 2.6484, PALMA, 1, 5),
      place("Cap de Formentor", "viewpoint", 39.9622, 3.2131, PALMA, 3, 5),
      place("Sa Calobra", "nature", 39.8505, 2.8011, PALMA, 4, 4),
      place("Valldemossa", "landmark", 39.7106, 2.6222, PALMA, 5, 4),
    ],
    journal: [
      note(
        3,
        "Formentor",
        "Mit dem Mietwagen früh zum Leuchtturm, bevor die Busse kamen. Tobias wollte in jeder Kurve ein Foto.",
        "ausgelassen",
        "sonnig, 27 °C"
      ),
    ],
  },
  {
    key: "usa-west",
    name: "USA-Westküste: San Francisco bis Los Angeles",
    anchor: { yearsAgo: 9, month: 9, day: 2 },
    days: 18,
    category: "vacation",
    color: "#f59e0b",
    icon: "🏜️",
    origin: "Köln",
    destination: "Los Angeles",
    companions: [JULIA],
    tags: ["Roadtrip", "Nationalparks", "Fernreise"],
    flights: [
      fl(0, "LH 2001", "DUS", "MUC", "06:00", "07:10", "A320neo", {
        reg: "D-AINC",
        seat: "12A",
        delay: 0,
      }),
      fl(0, "LH 458", "MUC", "SFO", "09:55", "12:45", "A350-900", {
        reg: "D-AIXE",
        seat: "34K",
        delay: 18,
        price: 612,
        terminal: "2",
      }),
      fl(8, null, "LAS", "LAS", "10:30", "14:00", "EC130 B4", {
        airline: "Maverick Helicopters",
        seat: "vorne links",
        price: 419,
        notes: "Mit Landung im Canyon und Sekt am Colorado.",
        special: {
          type: "sightseeing",
          eventLat: 36.0125,
          eventLon: -113.811,
          eventLabel: "Grand Canyon West Rim",
        },
      }),
      fl(16, "LH 453", "LAX", "MUC", "16:00", "+1 11:50", "A380", {
        reg: "D-AIMK",
        seat: "82A",
        delay: 0,
        price: 598,
      }),
      fl(17, "LH 2016", "MUC", "DUS", "13:30", "14:40", "A320neo", {
        reg: "D-AINL",
        seat: "18C",
        delay: 6,
      }),
    ],
    roadtrip: "usa-west",
    stays: [
      stay("marriott-marquis-sf", 0, 3, 897, "USD", "none", 4, { loyalty: BONVOY }),
      stay("yosemite-valley-lodge", 3, 2, 598, "USD", "none", 4),
      stay("mammoth-mountain-inn", 5, 1, 189, "USD", "none", 3),
      stay("ranch-death-valley", 6, 1, 279, "USD", "none", 4),
      stay("cosmopolitan-lv", 7, 2, 412, "USD", "none", 5, {
        loyalty: BONVOY,
        room: "Terrace Studio",
      }),
      stay("cable-mountain-lodge", 9, 1, 219, "USD", "none", 4),
      stay("hampton-page", 10, 1, 189, "USD", "breakfast", 3),
      stay("el-tovar", 11, 1, 312, "USD", "none", 5),
      stay("meridien-santa-monica", 13, 3, 1146, "USD", "none", 4),
    ],
    places: [
      place("Golden Gate Bridge", "landmark", 37.8199, -122.4783, CA, 1, 5),
      place("Alcatraz", "museum", 37.8267, -122.423, CA, 2, 4),
      place("Yosemite-Nationalpark", "nature", 37.8651, -119.5383, CA, 3, 5, {
        curated: "nationalparks-us:Q180402",
      }),
      place("Tunnel View", "viewpoint", 37.7156, -119.677, CA, 4, 5),
      place("Death-Valley-Nationalpark", "nature", 36.5054, -117.0794, CA, 6, 4, {
        curated: "nationalparks-us:Q242111",
      }),
      place("Zabriskie Point", "viewpoint", 36.4203, -116.8124, CA, 7, 5),
      place("Zion-Nationalpark", "nature", 37.2982, -113.0263, ["Utah", "USA", "US"], 9, 5, {
        curated: "nationalparks-us:Q205325",
      }),
      place("Horseshoe Bend", "viewpoint", 36.8791, -111.5104, ["Arizona", "USA", "US"], 10, 5),
      place(
        "Grand-Canyon-Nationalpark",
        "nature",
        36.0544,
        -112.1401,
        ["Arizona", "USA", "US"],
        11,
        5,
        {
          curated: "nationalparks-us:Q220289",
        }
      ),
      place("Santa Monica Pier", "entertainment", 34.0086, -118.4986, CA, 14, 3),
      place("Griffith Observatory", "viewpoint", 34.1184, -118.3004, CA, 15, 4),
    ],
    journal: [
      note(
        4,
        "Tunnel View",
        "Früh raus, um vor den Bussen am Tunnel View zu stehen. El Capitan links, Bridalveil Fall rechts, und Half Dome im Morgenlicht. Wir haben kaum etwas gesagt.",
        "ergriffen",
        "klar, 9 °C"
      ),
      note(
        8,
        "Mit dem Helikopter in den Canyon",
        "Teuer, aber jeden Dollar wert. Der Pilot hat vor dem Rand extra tief angesetzt – Julia hat meinen Arm nicht mehr losgelassen.",
        "begeistert",
        "sonnig, 34 °C"
      ),
      note(
        11,
        "Sonnenuntergang am Mather Point",
        "Die Farben ändern sich jede Minute. Danach im El Tovar gegessen, das Hotel steht fast an der Kante.",
        "glücklich",
        "sonnig, 26 °C"
      ),
    ],
  },
  {
    key: "barcelona",
    name: "Barcelona im Frühling",
    anchor: { yearsAgo: 8, month: 4, day: 20 },
    days: 4,
    category: "weekend",
    color: "#eab308",
    icon: "⛪",
    origin: "Düsseldorf",
    destination: "Barcelona",
    companions: [JULIA],
    tags: ["Städtetrip"],
    flights: [
      fl(0, "EW 9582", "DUS", "BCN", "10:05", "12:15", "A320", {
        reg: "D-AEWK",
        seat: "8A",
        delay: 11,
        price: 98,
      }),
      fl(3, "EW 9583", "BCN", "DUS", "18:40", "20:55", "A320", {
        reg: "D-AEWK",
        seat: "10D",
        price: 121,
      }),
    ],
    stays: [stay("nh-calderon", 0, 3, 540, "EUR", "breakfast", 4)],
    places: [
      place("Sagrada Família", "landmark", 41.4036, 2.1744, BCN, 1, 5, {
        curated: "world-heritage:320",
      }),
      place("Park Güell", "landmark", 41.4145, 2.1527, BCN, 1, 4),
      place("Mercat de la Boqueria", "restaurant", 41.3817, 2.1716, BCN, 2, 4),
      place("Bunkers del Carmel", "viewpoint", 41.419, 2.162, BCN, 2, 5),
    ],
  },
  {
    key: "dublin",
    name: "Dublin und die Cliffs of Moher",
    anchor: { yearsAgo: 8, month: 5, day: 25 },
    days: 4,
    category: "weekend",
    color: "#22c55e",
    icon: "☘️",
    origin: "Düsseldorf",
    destination: "Dublin",
    companions: [TOBIAS],
    tags: ["Städtetrip"],
    flights: [
      fl(0, "EI 695", "DUS", "DUB", "14:05", "14:50", "A320", {
        reg: "EI-DEO",
        seat: "15A",
        delay: 0,
        price: 112,
      }),
      fl(3, "EI 694", "DUB", "DUS", "09:40", "12:25", "A320", {
        reg: "EI-DVM",
        seat: "11F",
        price: 96,
      }),
    ],
    stays: [stay("westin-dublin", 0, 3, 690, "EUR", "breakfast", 4, { loyalty: BONVOY })],
    places: [
      place("Trinity College", "museum", 53.3438, -6.2546, DUBLIN, 1, 4),
      place("Guinness Storehouse", "entertainment", 53.3419, -6.2867, DUBLIN, 1, 4),
      place(
        "Cliffs of Moher",
        "viewpoint",
        52.9715,
        -9.4309,
        ["County Clare", "Irland", "IE"],
        2,
        5
      ),
      place("Temple Bar", "restaurant", 53.3455, -6.2641, DUBLIN, 0, 3),
    ],
  },
  {
    key: "kreta",
    name: "Kreta",
    anchor: { yearsAgo: 8, month: 9, day: 8 },
    days: 11,
    category: "vacation",
    color: "#06b6d4",
    icon: "🏛️",
    origin: "Düsseldorf",
    destination: "Heraklion",
    companions: [JULIA],
    tags: ["Badeurlaub"],
    flights: [
      fl(0, "DE 1582", "DUS", "HER", "06:00", "10:25", "A321", {
        reg: "D-AIAD",
        seat: "21A",
        delay: 14,
        price: 219,
      }),
      fl(10, "DE 1583", "HER", "DUS", "11:25", "14:05", "A321", {
        reg: "D-AIAC",
        seat: "19F",
        delay: 0,
        price: 239,
      }),
    ],
    stays: [stay("aldemar-knossos", 0, 10, 2150, "EUR", "half", 4)],
    places: [
      place("Palast von Knossos", "landmark", 35.298, 25.1632, CRETE, 2, 4),
      place("Samaria-Schlucht", "nature", 35.2939, 23.9608, CRETE, 5, 5),
      place("Elafonisi", "nature", 35.271, 23.541, CRETE, 6, 5),
      place("Spinalonga", "landmark", 35.2977, 25.7385, CRETE, 8, 4),
    ],
    journal: [
      note(
        5,
        "Samaria-Schlucht",
        "16 Kilometer bergab, am Ende die Füße im Libyschen Meer. Mit der Fähre nach Sougia und dem Bus zurück – ein langer, guter Tag.",
        "erschöpft, aber glücklich",
        "sonnig, 29 °C"
      ),
    ],
  },
  {
    key: "wien-nightjet",
    name: "Wien: hin mit dem Nightjet, zurück mit dem Flieger",
    anchor: { yearsAgo: 8, month: 10, day: 12 },
    days: 4,
    category: "weekend",
    color: "#a855f7",
    icon: "🎻",
    origin: "Köln",
    destination: "Wien",
    companions: [JULIA],
    tags: ["Städtetrip", "Nachtzug"],
    rail: [
      rail(0, "ÖBB", "NJ", "421", "koeln", "wien", "21:26", "+1 09:14", "sleeper", {
        price: 169,
        coach: "131",
        seat: "Abteil 3",
        delay: 22,
      }),
    ],
    flights: [
      fl(3, "OS 207", "VIE", "DUS", "17:25", "19:00", "A320", {
        reg: "OE-LBM",
        seat: "6A",
        delay: 12,
        price: 129,
      }),
    ],
    stays: [stay("motel-one-wien-staatsoper", 1, 2, 238, "EUR", "none", 4)],
    places: [
      place("Schloss Schönbrunn", "landmark", 48.1845, 16.3122, VIENNA, 1, 5, {
        curated: "world-heritage:786",
      }),
      place("Historisches Zentrum Wien", "landmark", 48.2086, 16.373, VIENNA, 2, 4, {
        curated: "world-heritage:1033",
      }),
      place("Café Sperl", "restaurant", 48.1983, 16.3622, VIENNA, 2, 5),
      place("Naschmarkt", "shopping", 48.1985, 16.3637, VIENNA, 1, 4),
    ],
    journal: [
      note(
        1,
        "Aufgewacht vor Linz",
        "Im Schlafwagen überraschend gut geschlafen. Das Frühstück kam kurz vor Linz, in Wien dann direkt ins Kaffeehaus.",
        "ausgeruht",
        "neblig, 8 °C"
      ),
    ],
  },
  {
    key: "amsterdam",
    name: "Amsterdam im Advent",
    anchor: { yearsAgo: 8, month: 12, day: 1 },
    days: 3,
    category: "weekend",
    color: "#f43f5e",
    icon: "🚲",
    origin: "Köln",
    destination: "Amsterdam",
    companions: [JULIA],
    tags: ["Städtetrip", "Bahnreise"],
    rail: [
      rail(0, "DB Fernverkehr", "ICE", "105", "koeln", "amsterdam", "09:48", "12:40", "second", {
        price: 39.9,
      }),
      rail(2, "DB Fernverkehr", "ICE", "126", "amsterdam", "koeln", "17:04", "19:52", "second", {
        price: 39.9,
        delay: 7,
      }),
    ],
    stays: [stay("ink-amsterdam", 0, 2, 412, "EUR", "breakfast", 4, { loyalty: ALL_ACCOR })],
    places: [
      place("Amsterdamer Grachtengürtel", "landmark", 52.3702, 4.8852, AMSTERDAM, 0, 5, {
        curated: "world-heritage:1349",
      }),
      place("Rijksmuseum", "museum", 52.36, 4.8852, AMSTERDAM, 1, 5),
      place("Anne Frank Huis", "museum", 52.3752, 4.884, AMSTERDAM, 1, 5),
    ],
  },
  {
    key: "lissabon",
    name: "Lissabon",
    anchor: { yearsAgo: 7, month: 3, day: 8 },
    days: 5,
    category: "vacation",
    color: "#eab308",
    icon: "🚋",
    origin: "Düsseldorf",
    destination: "Lissabon",
    companions: [JULIA],
    tags: ["Städtetrip"],
    flights: [
      fl(0, "TP 573", "DUS", "LIS", "13:10", "15:10", "A320neo", {
        reg: "CS-TVF",
        seat: "16A",
        delay: 0,
        price: 169,
      }),
      fl(4, "TP 572", "LIS", "DUS", "07:05", "11:00", "A320neo", {
        reg: "CS-TVD",
        seat: "18C",
        delay: 21,
        price: 149,
      }),
    ],
    stays: [stay("memmo-alfama", 0, 4, 780, "EUR", "breakfast", 5)],
    places: [
      place("Hieronymuskloster und Torre de Belém", "landmark", 38.6979, -9.2068, LISBON, 1, 5, {
        curated: "world-heritage:263",
      }),
      place("Sintra", "landmark", 38.7876, -9.3905, LISBON, 2, 5, {
        curated: "world-heritage:723",
      }),
      place("Time Out Market", "restaurant", 38.707, -9.1459, LISBON, 1, 4),
      place("Miradouro da Senhora do Monte", "viewpoint", 38.7191, -9.1327, LISBON, 3, 5),
      place("Cabo da Roca", "viewpoint", 38.7804, -9.4989, LISBON, 2, 4),
    ],
  },
  {
    key: "aida-norwegen",
    name: "Norwegens Fjorde mit AIDA",
    anchor: { yearsAgo: 7, month: 6, day: 13 },
    days: 8,
    category: "vacation",
    color: "#0ea5e9",
    icon: "🚢",
    origin: "Köln",
    destination: "Kiel",
    companions: [JULIA],
    tags: ["Kreuzfahrt", "Fjorde"],
    rail: [
      rail(0, "DB Fernverkehr", "ICE", "1024", "koeln", "hamburg", "06:48", "10:52", "second", {
        price: 49.9,
        delay: 8,
      }),
      rail(0, "DB Regio", "RE", "70", "hamburg", "kiel", "11:13", "12:28", "second", { price: 0 }),
      rail(7, "DB Regio", "RE", "70", "kiel", "hamburg", "10:40", "11:56", "second", { price: 0 }),
      rail(7, "DB Fernverkehr", "ICE", "1025", "hamburg", "koeln", "12:46", "16:50", "second", {
        price: 49.9,
        delay: 23,
      }),
    ],
    cruise: {
      ship: { catalogue: "AIDAsol" },
      d: 0,
      embark: "17:00",
      disembark: "08:00",
      stops: [
        { locode: "DEKEL" },
        { atSea: true },
        { locode: "NOBGO", note: "Fløibanen und Bryggen" },
        { locode: "NOOLD", note: "Wanderung zum Briksdalsbreen" },
        { locode: "NOGEI", note: "Adlerstraße und Dalsnibba" },
        { locode: "NOAES" },
        { atSea: true },
        { locode: "DEKEL" },
      ],
      cabinType: "balcony",
      cabin: "8214",
      deck: 8,
      price: 2398,
      bookingReference: "AI7K2Q",
    },
    places: [
      place("Bryggen", "landmark", 60.3975, 5.3245, NORWAY, 2, 4, { curated: "world-heritage:59" }),
      place("Briksdalsbreen", "nature", 61.6622, 6.8131, NORWAY, 3, 5),
      place("Geirangerfjord", "nature", 62.1049, 7.0947, NORWAY, 4, 5, {
        curated: "world-heritage:1195",
      }),
      place("Aksla", "viewpoint", 62.4744, 6.1627, NORWAY, 5, 4),
    ],
    journal: [
      note(
        4,
        "Einfahrt in den Geirangerfjord",
        "Um halb sieben an Deck, Kaffee in der Hand, links und rechts nur Fels und Wasserfälle. Die Sieben Schwestern führten richtig Wasser.",
        "ergriffen",
        "klar, 14 °C"
      ),
    ],
  },
  {
    key: "bruegge",
    name: "Brügge mit dem Zug",
    anchor: { yearsAgo: 7, month: 8, day: 12 },
    days: 3,
    category: "weekend",
    color: "#84cc16",
    icon: "🍫",
    origin: "Köln",
    destination: "Brügge",
    companions: [JULIA],
    tags: ["Bahnreise"],
    rail: [
      rail(0, "DB Fernverkehr", "ICE", "10", "koeln", "bruxellesMidi", "08:43", "10:35", "second", {
        price: 29.9,
      }),
      rail(0, "SNCB", "IC", "1832", "bruxellesMidi", "brugge", "11:02", "12:03", "second", {
        price: 16.5,
      }),
      rail(2, "SNCB", "IC", "1839", "brugge", "bruxellesMidi", "15:58", "16:57", "second", {
        price: 16.5,
        delay: 4,
      }),
      rail(2, "DB Fernverkehr", "ICE", "17", "bruxellesMidi", "koeln", "17:25", "19:15", "second", {
        price: 29.9,
      }),
    ],
    stays: [stay("dukes-palace-brugge", 0, 2, 498, "EUR", "breakfast", 5)],
    places: [
      place("Altstadt von Brügge", "landmark", 51.2093, 3.2247, BRUGES, 0, 5, {
        curated: "world-heritage:996",
      }),
      place("Belfried", "viewpoint", 51.2085, 3.2248, BRUGES, 1, 4),
    ],
  },
  {
    key: "thailand",
    name: "Drei Wochen Thailand",
    anchor: { yearsAgo: 7, month: 11, day: 8 },
    days: 22,
    category: "vacation",
    color: "#10b981",
    icon: "🐘",
    origin: "Düsseldorf",
    destination: "Khao Lak",
    companions: [JULIA],
    tags: ["Fernreise"],
    flights: [
      fl(0, "EK 56", "DUS", "DXB", "22:05", "+1 07:05", "A380", {
        reg: "A6-EOP",
        seat: "44K",
        delay: 0,
        price: 380,
      }),
      fl(1, "EK 384", "DXB", "BKK", "09:30", "18:45", "A380", {
        reg: "A6-EUD",
        seat: "47A",
        delay: 15,
        price: 380,
      }),
      fl(12, "FD 3161", "CNX", "HKT", "12:15", "14:20", "A320", {
        reg: "HS-BBU",
        seat: "4F",
        delay: 25,
        price: 58,
      }),
      fl(20, "EK 379", "HKT", "DXB", "21:30", "+1 01:05", "B777-300ER", {
        reg: "A6-EGR",
        seat: "31K",
        price: 360,
      }),
      fl(21, "EK 55", "DXB", "DUS", "03:25", "07:40", "A380", {
        reg: "A6-EOB",
        seat: "45A",
        delay: 0,
        price: 360,
      }),
    ],
    rail: [
      rail(
        7,
        "State Railway of Thailand",
        "SP EXP",
        "9",
        "bangkok",
        "chiangMai",
        "18:40",
        "+1 07:15",
        "sleeper",
        {
          price: 1453,
          currency: "THB",
          coach: "11",
          seat: "7 unten",
          delay: 35,
          notes: "Nachtzug, oberes und unteres Bett, morgens Reissuppe.",
        }
      ),
    ],
    stays: [
      stay("marriott-surawongse", 1, 6, 21000, "THB", "breakfast", 5, { loyalty: BONVOY }),
      stay("tamarind-village", 8, 4, 21200, "THB", "breakfast", 5),
      stay("jw-khao-lak", 12, 8, 86000, "THB", "half", 5, { loyalty: BONVOY }),
    ],
    places: [
      place("Wat Pho", "landmark", 13.7465, 100.4927, THAILAND, 2, 5),
      place("Großer Palast", "landmark", 13.75, 100.4913, THAILAND, 2, 4),
      place("Geschichtspark Ayutthaya", "landmark", 14.3559, 100.5585, THAILAND, 4, 5, {
        curated: "world-heritage:576",
      }),
      place("Doi Suthep", "viewpoint", 18.8048, 98.9216, THAILAND, 8, 5),
      place("Elephant Nature Park", "nature", 19.2141, 98.8608, THAILAND, 10, 5),
      place("Bucht von Phang Nga", "nature", 8.275, 98.501, THAILAND, 15, 5),
    ],
    journal: [
      note(
        4,
        "Ayutthaya mit dem Rad",
        "Mit gemieteten Rädern zwischen den Tempelruinen, der Buddha-Kopf im Baum ist kleiner als auf den Fotos und eindrucksvoller.",
        "neugierig",
        "schwül, 33 °C"
      ),
      note(
        10,
        "Elephant Nature Park",
        "Kein Reiten, nur Füttern und Zuschauen. Julia hat einen Lieblingselefanten, er heißt Faa Mai.",
        "glücklich",
        "sonnig, 29 °C"
      ),
      note(
        15,
        "Phang Nga",
        "Mit dem Longtail-Boot durch die Karstfelsen, abends Gewitter über dem Meer.",
        "entspannt",
        "Gewitter, 28 °C"
      ),
    ],
  },
  {
    key: "rom",
    name: "Rom",
    anchor: { yearsAgo: 6, month: 4, day: 10 },
    days: 5,
    category: "vacation",
    color: "#dc2626",
    icon: "🏛️",
    origin: "Köln",
    destination: "Rom",
    companions: [JULIA],
    tags: ["Städtetrip"],
    flights: [
      fl(0, "EW 874", "CGN", "FCO", "07:15", "09:20", "A320", {
        reg: "D-AEWB",
        seat: "9A",
        delay: 0,
        price: 119,
      }),
      fl(4, "EW 875", "FCO", "CGN", "10:05", "12:20", "A320", {
        reg: "D-AEWB",
        seat: "11C",
        delay: 17,
        price: 129,
      }),
    ],
    stays: [stay("nh-roma", 0, 4, 820, "EUR", "breakfast", 4)],
    places: [
      place("Kolosseum", "landmark", 41.8902, 12.4922, ROME, 1, 5, {
        curated: "world-heritage:91",
      }),
      place("Vatikanstadt", "landmark", 41.9022, 12.4539, ROME, 2, 5, {
        curated: "world-heritage:286",
      }),
      place("Pantheon", "landmark", 41.8986, 12.4768, ROME, 1, 5),
      place("Da Enzo al 29", "restaurant", 41.8888, 12.4776, ROME, 2, 5),
      place("Gianicolo", "viewpoint", 41.8918, 12.4613, ROME, 3, 4),
    ],
  },
  {
    key: "alpenpaesse",
    name: "Motorrad: Stilfser Joch und Großglockner",
    anchor: { yearsAgo: 6, month: 6, day: 18 },
    days: 5,
    category: "vacation",
    color: "#dc2626",
    icon: "🏍️",
    origin: "Köln",
    destination: "Großglockner",
    tags: ["Motorrad", "Pässe"],
    roadtrip: "alpine-passes",
    stays: [
      stay("lindau-bayerischer-hof", 0, 1, 149, "EUR", "breakfast", 4),
      stay("bormio-nazionale", 1, 1, 132, "EUR", "breakfast", 4),
      stay("heiligenblut-glocknerhof", 2, 1, 118, "EUR", "half", 5),
      stay("prien-luitpold", 3, 1, 139, "EUR", "breakfast", 3),
    ],
    places: [
      place("Kirchturm im Reschensee", "landmark", 46.833, 10.5383, ALPS, 1, 4),
      place("Stilfser Joch", "viewpoint", 46.5287, 10.4531, ALPS, 1, 5),
      place(
        "Kaiser-Franz-Josefs-Höhe",
        "viewpoint",
        47.0747,
        12.752,
        ["Großglockner", "Österreich", "AT"],
        3,
        5
      ),
    ],
    journal: [
      note(
        1,
        "48 Kehren",
        "Von Prad aus hoch, Kehre um Kehre gezählt. Oben eine Bratwurst am Stand – die beste der Welt, jedes Jahr wieder.",
        "euphorisch",
        "sonnig, 8 °C am Pass"
      ),
      note(
        3,
        "Großglockner im Nebel",
        "Am Hochtor nichts gesehen, an der Franz-Josefs-Höhe riss es für zehn Minuten auf.",
        "zufrieden",
        "Nebel, 6 °C"
      ),
    ],
  },
  {
    key: "kopenhagen",
    name: "Kopenhagen mit Tobias und Lena",
    anchor: { yearsAgo: 6, month: 9, day: 4 },
    days: 4,
    category: "weekend",
    color: "#e11d48",
    icon: "🧜",
    origin: "Düsseldorf",
    destination: "Kopenhagen",
    companions: [TOBIAS, LENA],
    tags: ["Städtetrip", "Freunde"],
    flights: [
      fl(0, "SK 1638", "DUS", "CPH", "07:00", "08:25", "A320neo", {
        reg: "SE-ROH",
        seat: "4A",
        delay: 0,
        price: 142,
      }),
      fl(3, "SK 1633", "CPH", "DUS", "19:25", "20:55", "A320neo", {
        reg: "SE-ROK",
        seat: "6C",
        price: 138,
      }),
    ],
    stays: [stay("scandic-kodbyen", 0, 3, 4350, "DKK", "breakfast", 4)],
    places: [
      place("Nyhavn", "landmark", 55.6798, 12.5907, CPH, 0, 4),
      place("Tivoli", "entertainment", 55.6737, 12.5681, CPH, 1, 5),
      place(
        "Schloss Kronborg",
        "landmark",
        56.0391,
        12.6211,
        ["Helsingør", "Dänemark", "DK"],
        2,
        4,
        {
          curated: "world-heritage:696",
        }
      ),
      place("Torvehallerne", "restaurant", 55.6838, 12.5696, CPH, 1, 5),
    ],
  },
  {
    key: "prag",
    name: "Prag im Advent",
    anchor: { yearsAgo: 6, month: 12, day: 3 },
    days: 4,
    category: "weekend",
    color: "#b91c1c",
    icon: "🎄",
    origin: "Düsseldorf",
    destination: "Prag",
    companions: [JULIA],
    tags: ["Städtetrip", "Weihnachtsmarkt"],
    flights: [
      fl(0, "EW 9750", "DUS", "PRG", "09:05", "10:20", "A319", {
        reg: "D-AGWQ",
        seat: "5F",
        delay: 0,
        price: 89,
      }),
      fl(3, "EW 9751", "PRG", "DUS", "18:30", "19:50", "A319", {
        reg: "D-AGWQ",
        seat: "7A",
        delay: 44,
        price: 99,
      }),
    ],
    stays: [stay("hotel-josef-prague", 0, 3, 450, "EUR", "breakfast", 4)],
    places: [
      place("Historisches Zentrum von Prag", "landmark", 50.0875, 14.4213, PRAGUE, 0, 5, {
        curated: "world-heritage:616",
      }),
      place("Karlsbrücke", "landmark", 50.0865, 14.4114, PRAGUE, 1, 5),
      place("Prager Burg", "landmark", 50.0909, 14.4005, PRAGUE, 1, 5),
    ],
  },
];
