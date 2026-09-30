import { JULIA, TOBIAS, BONVOY, ALL_ACCOR, fl, note, place, rail, stay } from "./build";
import type { TripSpec } from "./types";

/**
 * Five to two years ago: Japan in the cherry blossom (with the one upgrade),
 * the Mosel by bike, a diverted flight home from Istanbul, an aurora charter
 * from Düsseldorf, Iceland, the Hurtigruten in winter, three weeks in a
 * motorhome through Norway and Sweden, the Glacier Express, Vietnam and the
 * Alta Via 1 from hut to hut.
 */

const JAPAN = ["Japan", "Japan", "JP"] as const;
const MOSEL = ["Mosel", "Deutschland", "DE"] as const;
const ISTANBUL = ["Istanbul", "Türkei", "TR"] as const;
const PARIS = ["Paris", "Frankreich", "FR"] as const;
const DUBROVNIK = ["Dubrovnik", "Kroatien", "HR"] as const;
const ICELAND = ["Island", "Island", "IS"] as const;
const NORTH_NORWAY = ["Nordnorwegen", "Norwegen", "NO"] as const;
const NORWAY = ["Norwegen", "Norwegen", "NO"] as const;
const SWEDEN = ["Schweden", "Schweden", "SE"] as const;
const SIEBENGEBIRGE = ["Königswinter", "Deutschland", "DE"] as const;
const KRAKOW = ["Krakau", "Polen", "PL"] as const;
const SWISS = ["Graubünden", "Schweiz", "CH"] as const;
const VIETNAM = ["Vietnam", "Vietnam", "VN"] as const;
const SINGAPORE = ["Singapur", "Singapur", "SG"] as const;
const DOLOMITES = ["Dolomiten", "Italien", "IT"] as const;
const BUDAPEST = ["Budapest", "Ungarn", "HU"] as const;

export const MIDDLE_TRIPS: readonly TripSpec[] = [
  {
    key: "japan",
    name: "Japan zur Kirschblüte",
    anchor: { yearsAgo: 5, month: 3, day: 27 },
    days: 17,
    category: "vacation",
    color: "#ec4899",
    icon: "🌸",
    origin: "Köln",
    destination: "Tokio",
    companions: [JULIA],
    tags: ["Fernreise", "Kirschblüte"],
    rail: [
      rail(
        5,
        "JR Central",
        "Shinkansen",
        "Nozomi 21",
        "tokyo",
        "kyoto",
        "08:00",
        "10:15",
        "second",
        {
          price: 14170,
          currency: "JPY",
          coach: "7",
          seat: "12E",
        }
      ),
      rail(
        10,
        "JR West",
        "Shinkansen",
        "Nozomi 97",
        "kyoto",
        "hiroshima",
        "09:30",
        "11:10",
        "second",
        {
          price: 11620,
          currency: "JPY",
        }
      ),
      rail(
        12,
        "JR West",
        "Shinkansen",
        "Nozomi 24",
        "hiroshima",
        "tokyo",
        "10:07",
        "14:03",
        "second",
        {
          price: 19760,
          currency: "JPY",
          delay: 0,
        }
      ),
    ],
    flights: [
      fl(0, "LH 2005", "DUS", "MUC", "09:00", "10:10", "A320neo", {
        reg: "D-AINM",
        seat: "8C",
        delay: 0,
      }),
      fl(0, "LH 714", "MUC", "HND", "11:55", "+1 06:55", "A350-900", {
        reg: "D-AIXQ",
        seat: "33K",
        delay: 0,
        price: 540,
      }),
      fl(16, "NH 217", "HND", "MUC", "10:50", "18:10", "B787-9", {
        reg: "JA830A",
        seat: "8A",
        cls: "business",
        delay: 0,
        price: 540,
        notes: "Mit Meilen auf Business hochgestuft – der Unterschied nach 14 Stunden ist enorm.",
      }),
      fl(16, "LH 2020", "MUC", "DUS", "19:25", "20:35", "A320neo", {
        reg: "D-AINR",
        seat: "3A",
        delay: 9,
      }),
    ],
    stays: [
      stay("tokyo-marriott", 1, 4, 148000, "JPY", "breakfast", 4, { loyalty: BONVOY }),
      stay("kanra-kyoto", 5, 5, 212000, "JPY", "breakfast", 5),
      stay("granvia-hiroshima", 10, 2, 46000, "JPY", "none", 4),
      stay("tokyo-marriott", 12, 4, 152000, "JPY", "breakfast", 4, { loyalty: BONVOY }),
    ],
    places: [
      place("Shibuya Crossing", "landmark", 35.6595, 139.7005, JAPAN, 2, 4),
      place("Sensō-ji", "landmark", 35.7148, 139.7967, JAPAN, 3, 5),
      place("Historisches Kyōto", "landmark", 35.0116, 135.7681, JAPAN, 6, 5, {
        curated: "world-heritage:688",
      }),
      place("Fushimi Inari-Taisha", "landmark", 34.9671, 135.7727, JAPAN, 6, 5),
      place("Nara", "landmark", 34.6851, 135.843, JAPAN, 8, 5, { curated: "world-heritage:870" }),
      place("Burg Himeji", "landmark", 34.8394, 134.6939, JAPAN, 9, 5, {
        curated: "world-heritage:661",
      }),
      place("Friedensdenkmal Hiroshima", "museum", 34.3955, 132.4536, JAPAN, 10, 5, {
        curated: "world-heritage:775",
      }),
      place("Itsukushima-Schrein", "landmark", 34.2959, 132.3199, JAPAN, 11, 5, {
        curated: "world-heritage:776",
      }),
      place("Fuji", "nature", 35.3606, 138.7274, JAPAN, null, undefined, {
        curated: "world-heritage:1418",
        notes: "Diesmal nur aus dem Zug gesehen.",
      }),
    ],
    journal: [
      note(
        6,
        "Fushimi Inari um sieben",
        "Vor dem Frühstück durch die Tore, oben am Berg fast allein. Auf dem Rückweg kamen uns die Gruppen entgegen.",
        "wach und glücklich",
        "klar, 12 °C"
      ),
      note(
        10,
        "Hiroshima",
        "Im Museum lange still gewesen. Abends Okonomiyaki, der Koch hat uns die Schichten erklärt.",
        "nachdenklich",
        "bewölkt, 16 °C"
      ),
      note(
        16,
        "Upgrade",
        "Am Check-in hieß es: Business. Flachbett, Miso zum Frühstück, ausgeruht in München gelandet.",
        "verwöhnt"
      ),
    ],
  },
  {
    key: "mosel",
    name: "Mosel-Radweg von Trier nach Koblenz",
    anchor: { yearsAgo: 5, month: 6, day: 11 },
    days: 4,
    category: "vacation",
    color: "#7c3aed",
    icon: "🚴",
    origin: "Köln",
    destination: "Koblenz",
    companions: [TOBIAS],
    tags: ["Radtour", "Wein"],
    rail: [
      rail(0, "DB Regio", "RE", "12", "koeln", "trier", "06:55", "09:52", "second", {
        price: 38.5,
        notes: "Mit Fahrradkarte.",
        delay: 6,
      }),
      rail(3, "DB Regio", "RE", "5", "koblenz", "koeln", "17:48", "19:24", "second", {
        price: 29.9,
      }),
    ],
    tours: [{ tour: "mosel" }],
    stays: [
      stay("bernkastel-doctor", 0, 1, 128, "EUR", "breakfast", 4),
      stay("zell-gruener-kranz", 1, 1, 118, "EUR", "breakfast", 4),
      stay("cochem-germania", 2, 1, 139, "EUR", "breakfast", 3),
    ],
    places: [
      place("Porta Nigra", "landmark", 49.7597, 6.6441, ["Trier", "Deutschland", "DE"], 0, 5, {
        curated: "world-heritage:367",
      }),
      place("Marktplatz Bernkastel", "landmark", 49.9158, 7.0716, MOSEL, 0, 4),
      place("Calmont", "viewpoint", 50.085, 7.1545, MOSEL, 2, 5),
      place("Reichsburg Cochem", "landmark", 50.1453, 7.16, MOSEL, 2, 4),
      place("Deutsches Eck", "landmark", 50.365, 7.6065, ["Koblenz", "Deutschland", "DE"], 3, 4),
      place("Burg Eltz", "landmark", 50.2053, 7.3367, MOSEL, null, undefined, {
        notes: "Beim nächsten Mal den Abstecher machen.",
      }),
    ],
    journal: [
      note(
        1,
        "Moselschleifen",
        "Zwischen Kröv und Traben-Trarbach jede Schleife mitgenommen. Mittags Flammkuchen am Ufer, Tobias hat Riesling für drei gekauft.",
        "zufrieden",
        "sonnig, 24 °C"
      ),
      note(
        2,
        "Calmont",
        "Den Aussichtspunkt über Bremm zu Fuß hoch, die Räder unten angeschlossen. Steilster Weinberg Europas – man glaubt es sofort.",
        "beeindruckt",
        "heiter, 26 °C"
      ),
    ],
  },
  {
    key: "istanbul",
    name: "Istanbul",
    anchor: { yearsAgo: 5, month: 10, day: 2 },
    days: 5,
    category: "vacation",
    color: "#e11d48",
    icon: "🕌",
    origin: "Köln",
    destination: "Istanbul",
    companions: [JULIA],
    tags: ["Städtetrip"],
    flights: [
      fl(0, "TK 1672", "CGN", "IST", "11:40", "16:05", "A321neo", {
        reg: "TC-LSC",
        seat: "14A",
        delay: 0,
        price: 189,
      }),
      fl(4, "TK 1671", "IST", "DUS", "07:55", "10:25", "A321neo", {
        reg: "TC-LSG",
        seat: "16F",
        delay: 55,
        price: 176,
        notes:
          "Eigentlich nach Köln/Bonn – wegen Nebel nach Düsseldorf umgeleitet, weiter mit dem Bus.",
      }),
    ],
    stays: [stay("pera-palace", 0, 4, 760, "EUR", "breakfast", 5)],
    places: [
      place("Historische Bereiche von Istanbul", "landmark", 41.0086, 28.9802, ISTANBUL, 1, 5, {
        curated: "world-heritage:356",
      }),
      place("Blaue Moschee", "landmark", 41.0054, 28.9768, ISTANBUL, 1, 5),
      place("Großer Basar", "shopping", 41.0107, 28.9681, ISTANBUL, 2, 4),
      place("Galataturm", "viewpoint", 41.0256, 28.9742, ISTANBUL, 2, 4),
    ],
  },
  {
    key: "polarlichtflug",
    name: "Polarlichtflug ab Düsseldorf",
    anchor: { yearsAgo: 4, month: 2, day: 11 },
    days: 2,
    category: "other",
    color: "#22d3ee",
    icon: "🌌",
    origin: "Düsseldorf",
    destination: "Nordnorwegen",
    companions: [JULIA],
    tags: ["Sonderflug"],
    flights: [
      fl(0, "DE 7400", "DUS", "DUS", "20:30", "+1 01:40", "A330-200", {
        reg: "D-AFYR",
        seat: "31A",
        price: 399,
        notes:
          "Charter mit gedimmtem Kabinenlicht, der Kapitän hat über dem Nordkap eine Schleife geflogen.",
        special: {
          type: "aurora",
          eventLat: 69.6,
          eventLon: 19.0,
          eventLabel: "Polarlicht über Nordnorwegen",
        },
      }),
    ],
    journal: [
      note(
        0,
        "Grüne Vorhänge aus 11 Kilometern",
        "Kurz nach Mitternacht wurde es grün, erst ein Band, dann über den ganzen Himmel. Alle standen an den Fenstern der linken Seite.",
        "sprachlos",
        "klar über den Wolken"
      ),
    ],
  },
  {
    key: "paris",
    name: "Paris mit dem Thalys",
    anchor: { yearsAgo: 4, month: 5, day: 1 },
    days: 4,
    category: "weekend",
    color: "#6366f1",
    icon: "🗼",
    origin: "Köln",
    destination: "Paris",
    companions: [JULIA],
    tags: ["Städtetrip", "Bahnreise"],
    rail: [
      rail(0, "Thalys", "THA", "9408", "koeln", "parisNord", "08:44", "12:05", "second", {
        price: 69,
        coach: "14",
        seat: "65",
      }),
      rail(3, "Thalys", "THA", "9447", "parisNord", "koeln", "18:25", "21:46", "second", {
        price: 59,
        delay: 14,
      }),
    ],
    stays: [stay("ibis-gare-du-nord", 0, 3, 402, "EUR", "none", 3, { loyalty: ALL_ACCOR })],
    places: [
      place("Louvre", "museum", 48.8606, 2.3376, PARIS, 1, 5),
      place("Sacré-Cœur", "viewpoint", 48.8867, 2.3431, PARIS, 1, 5),
      place("Musée d'Orsay", "museum", 48.86, 2.3266, PARIS, 2, 5),
      place("Seineufer", "landmark", 48.8566, 2.3522, PARIS, 2, 4, {
        curated: "world-heritage:600",
      }),
      place("L'As du Fallafel", "restaurant", 48.8574, 2.359, PARIS, 2, 5),
    ],
  },
  {
    key: "dubrovnik",
    name: "Dubrovnik und die Bucht von Kotor",
    anchor: { yearsAgo: 4, month: 6, day: 12 },
    days: 7,
    category: "vacation",
    color: "#f97316",
    icon: "🏰",
    origin: "Köln",
    destination: "Dubrovnik",
    companions: [JULIA],
    tags: ["Badeurlaub"],
    flights: [
      fl(0, "EW 9730", "CGN", "DBV", "10:15", "12:25", "A320", {
        reg: "D-AEWR",
        seat: "8F",
        delay: 0,
        price: 149,
      }),
      fl(6, "EW 9731", "DBV", "CGN", "13:10", "15:30", "A320", {
        reg: "D-AEWR",
        seat: "10A",
        delay: 36,
        price: 159,
      }),
    ],
    stays: [stay("excelsior-dubrovnik", 0, 6, 1980, "EUR", "breakfast", 5)],
    places: [
      place("Altstadt von Dubrovnik", "landmark", 42.6407, 18.1077, DUBROVNIK, 1, 5, {
        curated: "world-heritage:95",
      }),
      place("Stadtmauer Dubrovnik", "viewpoint", 42.6414, 18.1077, DUBROVNIK, 1, 5),
      place("Bucht von Kotor", "nature", 42.4247, 18.7712, ["Kotor", "Montenegro", "ME"], 3, 5, {
        curated: "world-heritage:125",
      }),
      place("Lokrum", "nature", 42.6258, 18.121, DUBROVNIK, 4, 4),
    ],
  },
  {
    key: "island",
    name: "Island im Spätsommer",
    anchor: { yearsAgo: 4, month: 8, day: 18 },
    days: 8,
    category: "vacation",
    color: "#38bdf8",
    icon: "🌋",
    origin: "Düsseldorf",
    destination: "Reykjavík",
    companions: [JULIA],
    tags: ["Natur"],
    flights: [
      fl(0, "EW 7964", "DUS", "KEF", "12:40", "14:25", "A320", {
        reg: "D-AEWT",
        seat: "11A",
        delay: 0,
        price: 189,
      }),
      fl(7, "EW 7965", "KEF", "DUS", "15:25", "20:50", "A320", {
        reg: "D-AEWT",
        seat: "9D",
        delay: 12,
        price: 199,
      }),
    ],
    stays: [
      stay("canopy-reykjavik", 0, 2, 78000, "ISK", "breakfast", 4),
      stay("kria-vik", 2, 2, 52000, "ISK", "breakfast", 4),
      stay("hofn-hotel", 4, 2, 48000, "ISK", "breakfast", 3),
      stay("canopy-reykjavik", 6, 1, 39000, "ISK", "breakfast", 4),
    ],
    places: [
      place("Þingvellir", "nature", 64.2559, -21.1299, ICELAND, 1, 5, {
        curated: "world-heritage:1152",
      }),
      place("Gullfoss", "nature", 64.3271, -20.1199, ICELAND, 1, 5),
      place("Seljalandsfoss", "nature", 63.6156, -19.9886, ICELAND, 2, 5),
      place("Reynisfjara", "nature", 63.4044, -19.045, ICELAND, 3, 4),
      place("Jökulsárlón", "nature", 64.0784, -16.2306, ICELAND, 4, 5),
      place("Vatnajökull-Nationalpark", "nature", 64.4, -16.8, ICELAND, 4, 5, {
        curated: "world-heritage:1604",
      }),
      place("Hallgrímskirkja", "landmark", 64.1417, -21.9266, ICELAND, 6, 4),
    ],
    journal: [
      note(
        4,
        "Jökulsárlón",
        "Eisberge, die sich langsam zum Meer drehen, und Robben dazwischen. Am Diamond Beach liegen die Brocken wie Glas im schwarzen Sand.",
        "staunend",
        "wolkig, 9 °C"
      ),
    ],
  },
  {
    key: "hurtigruten",
    name: "Hurtigruten im Winter: Bergen – Kirkenes",
    anchor: { yearsAgo: 3, month: 2, day: 24 },
    days: 9,
    category: "vacation",
    color: "#1d4ed8",
    icon: "❄️",
    origin: "Düsseldorf",
    destination: "Kirkenes",
    companions: [JULIA],
    tags: ["Kreuzfahrt", "Polarlicht"],
    flights: [
      fl(0, "KL 1856", "DUS", "AMS", "06:30", "07:25", "E175", {
        reg: "PH-EXV",
        seat: "3A",
        delay: 0,
        price: 110,
      }),
      fl(0, "KL 1193", "AMS", "BGO", "09:25", "11:00", "B737-800", {
        reg: "PH-BXE",
        seat: "21F",
        delay: 8,
        price: 150,
      }),
      fl(8, "SK 4403", "KKN", "OSL", "11:15", "13:30", "B737-800", {
        reg: "LN-RRW",
        seat: "12A",
        price: 140,
      }),
      fl(8, "SK 1629", "OSL", "DUS", "15:10", "17:05", "A320neo", {
        reg: "SE-ROM",
        seat: "7C",
        delay: 0,
        price: 120,
      }),
    ],
    stays: [
      stay("scandic-ornen", 0, 1, 1890, "NOK", "breakfast", 4),
      stay("scandic-kirkenes", 7, 1, 1450, "NOK", "breakfast", 3),
    ],
    cruise: {
      ship: { override: "MS Richard With", line: "Hurtigruten" },
      d: 1,
      embark: "20:30",
      disembark: "09:00",
      stops: [
        { locode: "NOBGO" },
        { locode: "NOAES" },
        { locode: "NOTRD", note: "Nidarosdom" },
        { locode: "NOBOO" },
        { locode: "NOTOS", note: "Mitternachtskonzert in der Eismeerkathedrale" },
        { locode: "NOHVG", note: "Nordkap-Ausflug" },
        { locode: "NOKKN" },
      ],
      cabinType: "oceanview",
      cabin: "532",
      deck: 5,
      price: 3290,
      bookingReference: "HRX4417",
    },
    places: [
      place("Nidarosdom", "landmark", 63.4269, 10.3969, NORTH_NORWAY, 3, 4),
      place("Eismeerkathedrale", "landmark", 69.648, 18.9874, NORTH_NORWAY, 5, 4),
      place("Nordkap", "viewpoint", 71.1685, 25.7837, NORTH_NORWAY, 6, 5),
    ],
    journal: [
      note(
        5,
        "Polarlicht über Tromsø",
        "Die Durchsage kam um 23 Uhr, alle in Jacke an Deck. Diesmal nicht aus dem Flugzeug, sondern direkt über uns.",
        "überwältigt",
        "klar, −9 °C"
      ),
      note(
        6,
        "Nordkap bei minus zwölf Grad",
        "Mit dem Bus durch den Schnee hoch, oben pfiff der Wind. Fünf Minuten draußen, eine Stunde im Café.",
        "durchgefroren",
        "Schneetreiben, −12 °C"
      ),
    ],
  },
  {
    key: "skandinavien-womo",
    name: "Drei Wochen Wohnmobil: Norwegen und Schweden",
    anchor: { yearsAgo: 3, month: 7, day: 5 },
    days: 18,
    category: "vacation",
    color: "#0ea5e9",
    icon: "🚐",
    origin: "Köln",
    destination: "Nordkap-Route",
    companions: [JULIA],
    tags: ["Wohnmobil", "Fjorde", "Camping"],
    roadtrip: "scandinavia",
    tours: [{ tour: "preikestolen", anchorStation: 4 }],
    stays: [
      stay("camp-haithabu", 0, 1, 38, "EUR", "none", 4),
      stay("camp-hirtshals", 1, 1, 290, "DKK", "none", 3),
      stay("camp-mosvangen", 2, 2, 820, "NOK", "none", 4),
      stay("camp-odda", 4, 1, 390, "NOK", "none", 5, {
        notes: "Stellplatz direkt am Hardangerfjord.",
      }),
      stay("camp-bergen", 5, 2, 780, "NOK", "none", 3),
      stay("camp-flam", 7, 1, 420, "NOK", "none", 4),
      stay("camp-geiranger", 8, 2, 860, "NOK", "none", 4),
      stay("camp-bogstad", 11, 2, 900, "NOK", "none", 3),
      stay("camp-askim", 13, 2, 780, "SEK", "none", 4),
      stay("camp-sibbarp", 15, 1, 420, "SEK", "none", 3),
      stay("camp-wulfen", 16, 1, 46, "EUR", "none", 4),
    ],
    places: [
      place("Preikestolen", "viewpoint", 58.9863, 6.1904, NORWAY, 3, 5),
      place("Bryggen", "landmark", 60.3975, 5.3245, NORWAY, 6, 4, { curated: "world-heritage:59" }),
      place("Stegastein", "viewpoint", 60.9076, 7.2109, NORWAY, 7, 5),
      place("Flåmsbana", "entertainment", 60.8636, 7.1136, NORWAY, 7, 4),
      place("Geirangerfjord", "nature", 62.1049, 7.0947, NORWAY, 9, 5, {
        curated: "world-heritage:1195",
      }),
      place("Dalsnibba", "viewpoint", 62.0496, 7.2716, NORWAY, 9, 5),
      place("Vigelandpark", "landmark", 59.927, 10.7009, NORWAY, 11, 4),
      place("Holmenkollen", "viewpoint", 59.9636, 10.6676, NORWAY, 12, 4),
      place("Haga", "landmark", 57.6983, 11.953, SWEDEN, 14, 4),
      place("Turning Torso", "landmark", 55.6131, 12.9766, SWEDEN, 15, 3),
    ],
    journal: [
      note(
        2,
        "Fähre nach Kristiansand",
        "Drei Stunden über den Skagerrak, das Womo unten im Bauch der Fähre. Julia hat auf dem Sonnendeck geschlafen.",
        "entspannt",
        "sonnig, 19 °C"
      ),
      note(
        3,
        "Preikestolen",
        "Um acht los, oben noch fast allein. 600 Meter unter uns der Lysefjord – ich bin nicht bis an die Kante.",
        "begeistert",
        "klar, 17 °C"
      ),
      note(
        9,
        "Geiranger zum zweiten Mal",
        "Vom Schiff kannte ich den Fjord, jetzt von oben: Dalsnibba am Morgen, Adlerkehre am Nachmittag. Beide Blickwinkel lohnen sich.",
        "glücklich",
        "heiter, 16 °C"
      ),
      note(
        10,
        "Frei stehen in der Rondane",
        "Keine Nachbarn, nur Rentiere am Hang. Abends Nudeln aus dem Topf und bis elf hell.",
        "ruhig",
        "windig, 11 °C"
      ),
    ],
  },
  {
    key: "rheinsteig",
    name: "Rheinsteig durchs Siebengebirge",
    anchor: { yearsAgo: 3, month: 10, day: 3 },
    days: 1,
    category: "weekend",
    color: "#16a34a",
    icon: "🥾",
    origin: "Köln",
    destination: "Siebengebirge",
    companions: [JULIA],
    tags: ["Wandern"],
    tours: [{ tour: "rheinsteig" }],
    places: [
      place("Drachenfels", "viewpoint", 50.6652, 7.2102, SIEBENGEBIRGE, 0, 5),
      place("Schloss Drachenburg", "landmark", 50.6679, 7.2085, SIEBENGEBIRGE, 0, 4),
    ],
  },
  {
    key: "krakau",
    name: "Krakau",
    anchor: { yearsAgo: 3, month: 11, day: 9 },
    days: 4,
    category: "weekend",
    color: "#be123c",
    icon: "🏰",
    origin: "Köln",
    destination: "Krakau",
    companions: [TOBIAS],
    tags: ["Städtetrip"],
    flights: [
      fl(0, "EW 2786", "CGN", "KRK", "09:30", "11:20", "A319", {
        reg: "D-AGWK",
        seat: "6A",
        delay: 0,
        price: 79,
      }),
      fl(3, "EW 2787", "KRK", "CGN", "12:05", "14:00", "A319", {
        reg: "D-AGWK",
        seat: "8C",
        delay: 18,
        price: 89,
      }),
    ],
    stays: [stay("stary-krakow", 0, 3, 2100, "PLN", "breakfast", 5)],
    places: [
      place("Altstadt von Krakau", "landmark", 50.0617, 19.9373, KRAKOW, 0, 5, {
        curated: "world-heritage:29",
      }),
      place("Wawel", "landmark", 50.054, 19.9354, KRAKOW, 1, 5),
      place(
        "Gedenkstätte Auschwitz-Birkenau",
        "museum",
        50.0343,
        19.1784,
        ["Oświęcim", "Polen", "PL"],
        2,
        undefined,
        {
          curated: "world-heritage:31",
          notes: "Kein Ort für Sterne.",
        }
      ),
      place("Plac Nowy", "restaurant", 50.0515, 19.9446, KRAKOW, 1, 4),
    ],
  },
  {
    key: "glacier-express",
    name: "Glacier Express im Winter",
    anchor: { yearsAgo: 2, month: 1, day: 14 },
    days: 5,
    category: "vacation",
    color: "#dc2626",
    icon: "🚂",
    origin: "Köln",
    destination: "St. Moritz",
    companions: [JULIA],
    tags: ["Bahnreise", "Winter"],
    rail: [
      rail(0, "DB Fernverkehr", "ICE", "5", "koeln", "basel", "06:48", "10:51", "second", {
        price: 59.9,
        delay: 9,
      }),
      rail(0, "SBB", "IC", "1071", "basel", "visp", "11:28", "13:08", "second", {
        price: 72,
        currency: "CHF",
      }),
      rail(
        0,
        "Matterhorn Gotthard Bahn",
        "R",
        "231",
        "visp",
        "zermatt",
        "13:36",
        "14:44",
        "second",
        {
          price: 42,
          currency: "CHF",
        }
      ),
      rail(2, "Glacier Express", "GEX", "902", "zermatt", "stMoritz", "08:52", "16:45", "first", {
        price: 268,
        currency: "CHF",
        coach: "4",
        seat: "23",
        notes: "Mit Mittagessen am Platz über den Oberalppass.",
      }),
      rail(4, "Rhätische Bahn", "RE", "1136", "stMoritz", "chur", "09:02", "11:00", "second", {
        price: 42,
        currency: "CHF",
      }),
      rail(4, "SBB", "IC", "3", "chur", "basel", "11:09", "13:33", "second", {
        price: 58,
        currency: "CHF",
      }),
      rail(4, "DB Fernverkehr", "ICE", "76", "basel", "koeln", "14:13", "18:12", "second", {
        price: 59.9,
        delay: 31,
      }),
    ],
    stays: [
      stay("matterhorn-focus", 0, 2, 980, "CHF", "breakfast", 5),
      stay("waldhaus-st-moritz", 2, 2, 540, "CHF", "half", 4),
    ],
    places: [
      place("Gornergrat", "viewpoint", 45.9833, 7.7847, ["Zermatt", "Schweiz", "CH"], 1, 5),
      place("Landwasserviadukt", "landmark", 46.6809, 9.676, SWISS, 2, 5),
      place("Albula- und Berninalinie", "landmark", 46.58, 9.85, SWISS, 2, 5, {
        curated: "world-heritage:1276",
      }),
      place("Muottas Muragl", "viewpoint", 46.5236, 9.903, SWISS, 3, 5),
    ],
    journal: [
      note(
        2,
        "Acht Stunden Glacier Express",
        "Langsamster Schnellzug der Welt, und keine Minute zu lang. Das Matterhorn im Rückspiegel, der Oberalppass tief verschneit.",
        "selig",
        "Schnee, −4 °C"
      ),
    ],
  },
  {
    key: "vietnam",
    name: "Hanoi, die Ha-Long-Bucht und Singapur",
    anchor: { yearsAgo: 2, month: 3, day: 2 },
    days: 10,
    category: "vacation",
    color: "#059669",
    icon: "🛶",
    origin: "Düsseldorf",
    destination: "Singapur",
    companions: [JULIA],
    tags: ["Fernreise"],
    flights: [
      fl(0, "TK 1524", "DUS", "IST", "11:35", "16:10", "A321neo", {
        reg: "TC-LSK",
        seat: "18A",
        delay: 0,
        price: 180,
      }),
      fl(0, "TK 164", "IST", "HAN", "19:05", "+1 08:25", "A350-900", {
        reg: "TC-LGD",
        seat: "31A",
        delay: 26,
        price: 330,
      }),
      fl(5, "VN 661", "HAN", "SIN", "11:00", "15:40", "A350-900", {
        reg: "VN-A886",
        seat: "25A",
        delay: 0,
        price: 160,
      }),
      fl(8, "TK 55", "SIN", "IST", "23:55", "+1 07:30", "A350-900", {
        reg: "TC-LGH",
        seat: "33K",
        price: 330,
      }),
      fl(9, "TK 1525", "IST", "DUS", "08:45", "09:55", "A321neo", {
        reg: "TC-LSP",
        seat: "20F",
        delay: 0,
        price: 180,
      }),
    ],
    stays: [
      stay("metropole-hanoi", 1, 4, 26000000, "VND", "breakfast", 5, { loyalty: ALL_ACCOR }),
      stay("marina-bay-sands", 5, 3, 2100, "SGD", "none", 4),
    ],
    places: [
      place("Hoan-Kiem-See", "landmark", 21.0288, 105.8525, VIETNAM, 2, 4),
      place("Ha-Long-Bucht", "nature", 20.9101, 107.1839, VIETNAM, 3, 5, {
        curated: "world-heritage:672",
      }),
      place("Gardens by the Bay", "nature", 1.2816, 103.8636, SINGAPORE, 6, 5),
      place("Maxwell Food Centre", "restaurant", 1.2803, 103.8448, SINGAPORE, 6, 5),
    ],
    journal: [
      note(
        3,
        "Ha-Long-Bucht",
        "Mit dem Kajak zwischen die Kalkfelsen, abends Tintenfisch vom Grill an Deck.",
        "friedlich",
        "diesig, 24 °C"
      ),
    ],
  },
  {
    key: "alta-via-1",
    name: "Alta Via 1: von Hütte zu Hütte",
    anchor: { yearsAgo: 2, month: 8, day: 19 },
    days: 7,
    category: "vacation",
    color: "#ea580c",
    icon: "⛰️",
    origin: "Köln",
    destination: "Cortina d'Ampezzo",
    companions: [TOBIAS],
    tags: ["Wandern", "Hüttentour"],
    rail: [
      rail(0, "DB Fernverkehr", "ICE", "527", "koeln", "muenchen", "05:55", "10:30", "second", {
        price: 69.9,
        delay: 12,
      }),
      rail(0, "ÖBB", "EC", "85", "muenchen", "franzensfeste", "11:31", "15:12", "second", {
        price: 49.9,
      }),
    ],
    flights: [
      fl(6, "EW 9851", "VCE", "DUS", "13:55", "15:45", "A320", {
        reg: "D-AEWO",
        seat: "16A",
        delay: 0,
        price: 129,
      }),
    ],
    tours: [{ tour: "alta-via-1" }],
    stays: [
      stay("hotel-lago-braies", 0, 1, 210, "EUR", "half", 4),
      stay("rif-sennes", 1, 1, 138, "EUR", "half", 4, {
        notes: "Lager, zwölf Betten, bar bezahlt.",
      }),
      stay("rif-fanes", 2, 1, 142, "EUR", "half", 5),
      stay("rif-lagazuoi", 3, 1, 165, "EUR", "half", 5),
      stay("rif-averau", 4, 1, 155, "EUR", "half", 5),
      stay("cortina-poste", 5, 1, 260, "EUR", "breakfast", 4),
    ],
    places: [
      place("Pragser Wildsee", "nature", 46.6943, 12.0853, DOLOMITES, 0, 5),
      place("Dolomiten", "nature", 46.61, 12.0, DOLOMITES, 2, 5, {
        curated: "world-heritage:1237",
      }),
      place("Kriegsstollen am Lagazuoi", "museum", 46.5289, 12.0092, DOLOMITES, 3, 4),
      place("Cinque Torri", "viewpoint", 46.5094, 12.0525, DOLOMITES, 4, 5),
    ],
    journal: [
      note(
        1,
        "Etappe 1",
        "Vom Pragser Wildsee steil hoch zur Forcella Sora Forno, dann über die Hochfläche zur Sennes. 870 Höhenmeter zum Einrollen.",
        "müde",
        "sonnig, 19 °C"
      ),
      note(
        3,
        "Lagazuoi",
        "Sonnenaufgang an der Hütte auf 2750 Metern, der Blick bis zur Marmolada. Tobias hat für den Moment den Wecker gestellt.",
        "ergriffen",
        "klar, 4 °C"
      ),
      note(
        4,
        "Letzte Etappe",
        "Durch die Stellungen des Ersten Weltkriegs zu den Cinque Torri. Abends auf der Averau Spaghetti und ein Radler.",
        "zufrieden",
        "wolkig, 15 °C"
      ),
    ],
  },
  {
    key: "budapest",
    name: "Budapest",
    anchor: { yearsAgo: 2, month: 10, day: 2 },
    days: 4,
    category: "weekend",
    color: "#15803d",
    icon: "♨️",
    origin: "Köln",
    destination: "Budapest",
    companions: [JULIA],
    tags: ["Städtetrip"],
    flights: [
      fl(0, "EW 7702", "CGN", "BUD", "12:45", "14:35", "A320", {
        reg: "D-AEWJ",
        seat: "12A",
        delay: 0,
        price: 99,
      }),
      fl(3, "EW 7703", "BUD", "CGN", "15:20", "17:25", "A320", {
        reg: "D-AEWJ",
        seat: "14C",
        price: 109,
      }),
    ],
    stays: [stay("aria-budapest", 0, 3, 290000, "HUF", "breakfast", 5)],
    places: [
      place("Budapest mit Donau-Ufern", "landmark", 47.4969, 19.0402, BUDAPEST, 1, 5, {
        curated: "world-heritage:400",
      }),
      place("Parlament", "landmark", 47.5071, 19.0456, BUDAPEST, 1, 5),
      place("Széchenyi-Bad", "entertainment", 47.5186, 19.0823, BUDAPEST, 1, 5),
      place("Fischerbastei", "viewpoint", 47.5022, 19.0347, BUDAPEST, 2, 5),
      place("Große Markthalle", "shopping", 47.487, 19.0586, BUDAPEST, 2, 4),
    ],
  },
];
