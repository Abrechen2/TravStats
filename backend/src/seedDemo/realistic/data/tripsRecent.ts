import { JULIA, LENA, TOBIAS, fl, note, place, rail, stay } from "./build";
import type { TripSpec } from "./types";

/**
 * Last year, the last weeks and what is booked. Last year's trips are pinned
 * to calendar days and all end before November, so the few trips placed
 * relative to TODAY (at most 55 days back) can never overlap them, whatever
 * day the seed runs on. The planned trips are 4, 11 and 21 weeks ahead.
 */

const CAPE_TOWN = ["Kapstadt", "Südafrika", "ZA"] as const;
const MED = ["Mittelmeer", "Italien", "IT"] as const;
const PORTO = ["Porto", "Portugal", "PT"] as const;
const TUSCANY = ["Toskana", "Italien", "IT"] as const;
const MARRAKECH = ["Marrakesch", "Marokko", "MA"] as const;
const EDINBURGH = ["Edinburgh", "Vereinigtes Königreich", "GB"] as const;

export const RECENT_TRIPS: readonly TripSpec[] = [
  {
    key: "kapstadt",
    name: "Kapstadt und die Kap-Halbinsel",
    anchor: { yearsAgo: 1, month: 2, day: 20 },
    days: 15,
    category: "vacation",
    color: "#0d9488",
    icon: "🐧",
    origin: "Köln",
    destination: "Kapstadt",
    companions: [JULIA],
    tags: ["Fernreise"],
    rail: [
      rail(
        0,
        "DB Fernverkehr",
        "ICE",
        "121",
        "koeln",
        "frankfurtAirport",
        "15:18",
        "16:12",
        "second",
        {
          notes: "Lufthansa Express Rail",
        }
      ),
      rail(
        14,
        "DB Fernverkehr",
        "ICE",
        "120",
        "frankfurtAirport",
        "koeln",
        "08:20",
        "09:15",
        "second",
        { delay: 5 }
      ),
    ],
    flights: [
      fl(0, "LH 576", "FRA", "CPT", "22:25", "+1 10:05", "A350-900", {
        reg: "D-AIXL",
        seat: "34A",
        delay: 0,
        price: 520,
      }),
      fl(13, "LH 577", "CPT", "FRA", "19:35", "+1 06:05", "A350-900", {
        reg: "D-AIXM",
        seat: "31K",
        delay: 17,
        price: 520,
      }),
    ],
    stays: [stay("radisson-red-cpt", 1, 12, 28800, "ZAR", "breakfast", 4)],
    places: [
      place("Tafelberg", "viewpoint", -33.9628, 18.4098, CAPE_TOWN, 2, 5),
      place("Kap der Guten Hoffnung", "nature", -34.3568, 18.474, CAPE_TOWN, 4, 5),
      place("Boulders Beach", "nature", -34.1975, 18.4513, CAPE_TOWN, 4, 5),
      place("Robben Island", "museum", -33.8067, 18.3662, CAPE_TOWN, 6, 4),
      place("Kirstenbosch", "nature", -33.9875, 18.4327, CAPE_TOWN, 7, 5),
      place(
        "Stellenbosch",
        "restaurant",
        -33.9321,
        18.8602,
        ["Stellenbosch", "Südafrika", "ZA"],
        9,
        4
      ),
    ],
    journal: [
      note(
        4,
        "Pinguine und das Kap",
        "Morgens bei den Pinguinen am Boulders Beach, nachmittags zum Kap. Der Wind hat uns fast vom Leuchtturm geweht.",
        "begeistert",
        "windig, 24 °C"
      ),
    ],
  },
  {
    key: "msc-mittelmeer",
    name: "Mittelmeer-Kreuzfahrt mit der MSC World Europa",
    anchor: { yearsAgo: 1, month: 5, day: 10 },
    days: 9,
    category: "vacation",
    color: "#2563eb",
    icon: "🛳️",
    origin: "Düsseldorf",
    destination: "Barcelona",
    companions: [JULIA, TOBIAS, LENA],
    tags: ["Kreuzfahrt", "Freunde"],
    flights: [
      fl(0, "EW 9580", "DUS", "BCN", "08:40", "10:55", "A320", {
        reg: "D-AEWP",
        seat: "10A",
        delay: 0,
        price: 129,
      }),
      fl(8, "EW 9581", "BCN", "DUS", "13:05", "15:15", "A320", {
        reg: "D-AEWP",
        seat: "12D",
        delay: 28,
        price: 149,
      }),
    ],
    cruise: {
      ship: { catalogue: "MSC World Europa" },
      d: 0,
      embark: "18:00",
      disembark: "08:00",
      stops: [
        { locode: "ESBCN" },
        { locode: "FRMRS" },
        { locode: "ITGOA" },
        { locode: "ITCVV", note: "Auf eigene Faust nach Rom" },
        { locode: "ITNAP", note: "Pompeji" },
        { locode: "ITMSN", note: "Taormina" },
        { locode: "MTMLA" },
        { atSea: true },
        { locode: "ESBCN" },
      ],
      cabinType: "balcony",
      cabin: "12147",
      deck: 12,
      price: 2180,
      bookingReference: "MSC88Q1",
    },
    places: [
      place("Altstadt von Genua", "landmark", 44.4072, 8.934, MED, 2, 4),
      place("Pompeji", "landmark", 40.7489, 14.4848, MED, 4, 5, { curated: "world-heritage:829" }),
      place("Taormina", "landmark", 37.8516, 15.2853, MED, 5, 5),
      place("Valletta", "landmark", 35.8989, 14.5146, ["Valletta", "Malta", "MT"], 6, 5, {
        curated: "world-heritage:131",
      }),
    ],
  },
  {
    key: "porto",
    name: "Porto",
    anchor: { yearsAgo: 1, month: 7, day: 3 },
    days: 4,
    category: "weekend",
    color: "#1e40af",
    icon: "🍷",
    origin: "Düsseldorf",
    destination: "Porto",
    companions: [JULIA],
    tags: ["Städtetrip"],
    flights: [
      fl(0, "EW 9540", "DUS", "OPO", "09:55", "11:40", "A320", {
        reg: "D-AEWV",
        seat: "6A",
        delay: 0,
        price: 119,
      }),
      fl(3, "EW 9541", "OPO", "DUS", "12:25", "16:05", "A320", {
        reg: "D-AEWV",
        seat: "8F",
        delay: 6,
        price: 135,
      }),
    ],
    stays: [stay("pestana-porto", 0, 3, 690, "EUR", "breakfast", 5)],
    places: [
      place("Historisches Zentrum von Porto", "landmark", 41.1407, -8.611, PORTO, 0, 5, {
        curated: "world-heritage:755",
      }),
      place("Livraria Lello", "shopping", 41.1469, -8.6149, PORTO, 1, 4),
      place("Ponte Dom Luís I", "viewpoint", 41.14, -8.6094, PORTO, 1, 5),
      place("Graham's Port Lodge", "entertainment", 41.1339, -8.6132, PORTO, 2, 5),
    ],
  },
  {
    key: "toskana",
    name: "Mit dem Auto in die Toskana",
    anchor: { yearsAgo: 1, month: 9, day: 6 },
    days: 12,
    category: "vacation",
    color: "#b45309",
    icon: "🍇",
    origin: "Köln",
    destination: "Toskana",
    companions: [JULIA],
    tags: ["Roadtrip", "Wein"],
    roadtrip: "tuscany",
    stays: [
      stay("luzern-schweizerhof", 0, 1, 420, "CHF", "breakfast", 5),
      stay("brunelleschi-florenz", 1, 3, 690, "EUR", "breakfast", 4),
      stay("athena-siena", 4, 2, 290, "EUR", "breakfast", 4),
      stay("pienza-agriturismo", 6, 3, 540, "EUR", "half", 5, {
        notes: "Abends Pecorino und Wein vom Hof.",
      }),
      stay("ilaria-lucca", 9, 1, 150, "EUR", "breakfast", 4),
      stay("metropole-como", 10, 1, 240, "EUR", "breakfast", 4),
    ],
    places: [
      place("Altstadt von Florenz", "landmark", 43.7696, 11.2558, TUSCANY, 2, 5, {
        curated: "world-heritage:174",
      }),
      place("Uffizien", "museum", 43.7678, 11.2553, TUSCANY, 2, 5),
      place("San Gimignano", "landmark", 43.4677, 11.0432, TUSCANY, 4, 5, {
        curated: "world-heritage:550",
      }),
      place("Historisches Zentrum von Siena", "landmark", 43.3188, 11.3308, TUSCANY, 5, 5, {
        curated: "world-heritage:717",
      }),
      place("Val d'Orcia", "nature", 43.07, 11.62, TUSCANY, 7, 5, {
        curated: "world-heritage:1026",
      }),
      place("Pienza", "landmark", 43.0766, 11.6789, TUSCANY, 7, 5, {
        curated: "world-heritage:789",
      }),
      place("Cappella della Madonna di Vitaleta", "viewpoint", 43.0515, 11.6311, TUSCANY, 8, 5),
      place("Stadtmauer von Lucca", "landmark", 43.8429, 10.5027, TUSCANY, 9, 4),
    ],
    journal: [
      note(
        7,
        "Val d'Orcia",
        "Zypressenalleen, die man von Postern kennt, und trotzdem hält man an jeder. Mittags in Pienza Pecorino gekauft.",
        "glücklich",
        "sonnig, 27 °C"
      ),
      note(
        11,
        "Über den Gotthard nach Hause",
        "780 Kilometer, der Golf hat nicht gemurrt. Am Gotthard noch einmal angehalten und in den Süden zurückgeschaut.",
        "wehmütig",
        "wechselhaft, 15 °C"
      ),
    ],
  },
  {
    key: "marrakesch",
    name: "Marrakesch und der Hohe Atlas",
    anchor: { yearsAgo: 1, month: 10, day: 16 },
    days: 5,
    category: "vacation",
    color: "#c2410c",
    icon: "🕌",
    origin: "Köln",
    destination: "Marrakesch",
    companions: [JULIA],
    tags: ["Städtetrip"],
    flights: [
      fl(0, "FR 1686", "CGN", "RAK", "06:30", "09:20", "B737 MAX 8-200", {
        reg: "EI-IHK",
        seat: "3A",
        delay: 0,
        price: 89,
      }),
      fl(4, "FR 1687", "RAK", "CGN", "10:20", "15:00", "B737 MAX 8-200", {
        reg: "EI-IHK",
        seat: "5F",
        delay: 19,
        price: 94,
      }),
    ],
    stays: [stay("riad-kniza", 0, 4, 7200, "MAD", "breakfast", 5)],
    places: [
      place("Medina von Marrakesch", "landmark", 31.6295, -7.9811, MARRAKECH, 0, 5, {
        curated: "world-heritage:331",
      }),
      place("Jemaa el-Fna", "landmark", 31.6258, -7.9891, MARRAKECH, 0, 5),
      place("Jardin Majorelle", "nature", 31.6417, -8.0033, MARRAKECH, 1, 5),
      place("Imlil", "nature", 31.137, -7.9194, ["Hoher Atlas", "Marokko", "MA"], 2, 5),
    ],
  },
  {
    key: "edinburgh",
    name: "Edinburgh mit Tobias und Lena",
    anchor: { daysFromNow: -55 },
    days: 4,
    category: "weekend",
    color: "#7c3aed",
    icon: "🏴",
    origin: "Düsseldorf",
    destination: "Edinburgh",
    companions: [TOBIAS, LENA],
    tags: ["Städtetrip", "Freunde"],
    flights: [
      fl(0, "EW 9350", "DUS", "EDI", "10:30", "11:20", "A320neo", {
        reg: "D-AENB",
        seat: "7A",
        delay: 0,
        price: 99,
      }),
      fl(3, "EW 9351", "EDI", "DUS", "12:05", "14:50", "A320neo", {
        reg: "D-AENB",
        seat: "9C",
        delay: 13,
        price: 109,
      }),
    ],
    stays: [stay("motel-one-edinburgh", 0, 3, 510, "GBP", "none", 4)],
    places: [
      place("Alt- und Neustadt von Edinburgh", "landmark", 55.9504, -3.1883, EDINBURGH, 0, 5, {
        curated: "world-heritage:728",
      }),
      place("Arthur's Seat", "viewpoint", 55.9441, -3.1618, EDINBURGH, 1, 5),
      place("Edinburgh Castle", "landmark", 55.9486, -3.1999, EDINBURGH, 1, 4),
      place("The Scotch Whisky Experience", "museum", 55.9488, -3.196, EDINBURGH, 2, 4),
      place("Scott Monument", "landmark", 55.9524, -3.1933, EDINBURGH, null, undefined, {
        notes: "Direkt vor dem Hotel – hochgestiegen? Weiß ich nicht mehr.",
      }),
    ],
    journal: [
      note(
        1,
        "Arthur's Seat",
        "Vor dem Frühstück hoch, oben Wind von allen Seiten und die ganze Stadt unter uns. Lena hat Scones für alle mitgebracht.",
        "fröhlich",
        "windig, 12 °C"
      ),
    ],
  },
  {
    key: "wien-geplant",
    name: "Wieder nach Wien, diesmal hin und zurück im Nightjet",
    anchor: { daysFromNow: 28 },
    days: 5,
    category: "weekend",
    color: "#a855f7",
    icon: "🎻",
    origin: "Köln",
    destination: "Wien",
    companions: [JULIA],
    tags: ["Nachtzug", "Städtetrip"],
    rail: [
      rail(0, "ÖBB", "NJ", "421", "koeln", "wien", "21:26", "+1 09:14", "sleeper", {
        price: 189,
        coach: "131",
        seat: "Abteil 2",
      }),
      rail(3, "ÖBB", "NJ", "420", "wien", "koeln", "20:40", "+1 09:02", "sleeper", {
        price: 179,
        coach: "132",
      }),
    ],
    stays: [stay("motel-one-wien-hbf", 1, 2, 258, "EUR", "none")],
  },
  {
    key: "kanaren-geplant",
    name: "Kanaren-Kreuzfahrt mit AIDAnova",
    anchor: { daysFromNow: 74 },
    days: 9,
    category: "vacation",
    color: "#0284c7",
    icon: "🌴",
    origin: "Düsseldorf",
    destination: "Gran Canaria",
    companions: [JULIA],
    tags: ["Kreuzfahrt"],
    flights: [
      fl(0, "DE 1446", "DUS", "LPA", "07:20", "11:00", "A321neo", { seat: "14A", price: 289 }),
      fl(8, "DE 1447", "LPA", "DUS", "12:10", "17:50", "A321neo", { seat: "16C", price: 299 }),
    ],
    cruise: {
      ship: { catalogue: "AIDAnova" },
      d: 0,
      embark: "20:00",
      disembark: "08:00",
      stops: [
        { locode: "ESLPA" },
        { locode: "ESSCT" },
        { locode: "ESSPC" },
        { locode: "PTFNC" },
        { atSea: true },
        { locode: "ESACE" },
        { locode: "ESFUE" },
        { locode: "ESLPA" },
      ],
      cabinType: "balcony",
      cabin: "11318",
      deck: 11,
      price: 2890,
      bookingReference: "AI3N8W",
    },
  },
  {
    key: "madeira-geplant",
    name: "Madeira: Levadas wandern",
    anchor: { daysFromNow: 150 },
    days: 8,
    category: "vacation",
    color: "#16a34a",
    icon: "🥾",
    origin: "Düsseldorf",
    destination: "Funchal",
    companions: [JULIA],
    tags: ["Wandern"],
    flights: [
      fl(0, "EW 1754", "DUS", "FNC", "06:40", "09:50", "A320", { seat: "10A", price: 189 }),
      fl(7, "EW 1755", "FNC", "DUS", "10:35", "16:25", "A320", { seat: "12F", price: 199 }),
    ],
    stays: [stay("pestana-casino-park", 0, 7, 1540, "EUR", "breakfast")],
  },
];
