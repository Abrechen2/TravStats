// Achievement seed definitions — Part H: the POI domain, widened.
//
// Part G gave places four measures and twelve badges while flights had
// sixty-six measures and a hundred and nine. That gap was not a judgement about
// which domain deserves more; it was simply where the work had stopped. This
// part reads the measures `utils/placeStats.ts` gained alongside it — cities,
// continents, category breadth, the regular haunt, a day out, a streak, a busy
// year, ratings, trips, and how far north and south the collection reaches.
//
// TWO RULES RUN THROUGH ALL OF IT, both inherited and both worth restating.
//
// An UNDATED visit counts towards anything asking HOW MANY and towards nothing
// asking WHEN. So `place_visits_count` includes it and `place_visit_streak`
// cannot: a badge for a day that never happened is worse than a badge withheld.
//
// A FUTURE-dated visit has not happened. Both rules live in
// `shared/placeCounting.ts` and are obeyed by the statistics page through the
// same module, which is what stops a badge disagreeing with a number on screen.
//
// LATITUDE THRESHOLDS ARE ABSOLUTE DEGREES, so one requirement reads the same
// in both hemispheres — 66 is the polar circle whichever side of the equator it
// is on, and neither hemisphere is compared against the other.
//
// Copy is German (user-facing; see the language policy). English lives in
// `frontend/src/i18n/resources/en/achievements.json` under `codes.<CODE>`,
// which the achievements page prefers over the seeded name.

import type { AchievementDefinition } from '../achievements';

export const seedsPartH: AchievementDefinition[] = [
  // ── Cities ────────────────────────────────────────────────────────
  {
    code: 'PLACE_CITIES_5',
    name: 'Stadtbummler',
    description: 'Orte in 5 verschiedenen Städten besucht',
    category: 'explorer',
    domain: 'poi',
    icon: '🏙',
    tier: 'bronze',
    requirement: 5,
    requirementType: 'place_cities',
    points: 20,
  },
  {
    code: 'PLACE_CITIES_20',
    name: 'Städtesammler',
    description: 'Orte in 20 verschiedenen Städten besucht',
    category: 'explorer',
    domain: 'poi',
    icon: '🌆',
    tier: 'silver',
    requirement: 20,
    requirementType: 'place_cities',
    points: 50,
  },
  {
    code: 'PLACE_CITIES_50',
    name: 'Metropolen-Atlas',
    description: 'Orte in 50 verschiedenen Städten besucht',
    category: 'explorer',
    domain: 'poi',
    icon: '🌃',
    tier: 'gold',
    requirement: 50,
    requirementType: 'place_cities',
    points: 120,
  },

  // ── Continents ────────────────────────────────────────────────────
  {
    code: 'PLACE_CONTINENTS_3',
    name: 'Drei Kontinente',
    description: 'Orte auf 3 Kontinenten besucht',
    category: 'explorer',
    domain: 'poi',
    icon: '🌍',
    tier: 'silver',
    requirement: 3,
    requirementType: 'place_continents',
    points: 60,
  },
  {
    code: 'PLACE_CONTINENTS_5',
    name: 'Fünf Kontinente',
    description: 'Orte auf 5 Kontinenten besucht',
    category: 'explorer',
    domain: 'poi',
    icon: '🌏',
    tier: 'gold',
    requirement: 5,
    requirementType: 'place_continents',
    points: 150,
  },
  {
    code: 'PLACE_CONTINENTS_7',
    name: 'Alle Kontinente',
    description: 'Orte auf allen 7 Kontinenten besucht — Antarktis eingeschlossen',
    category: 'elite',
    domain: 'poi',
    icon: '🗺',
    tier: 'diamond',
    requirement: 7,
    requirementType: 'place_continents',
    points: 400,
  },

  // ── Category breadth ──────────────────────────────────────────────
  {
    code: 'PLACE_CATEGORIES_4',
    name: 'Vielseitig',
    description: 'Orte aus 4 verschiedenen Kategorien besucht',
    category: 'collector',
    domain: 'poi',
    icon: '🎨',
    tier: 'bronze',
    requirement: 4,
    requirementType: 'place_categories_unique',
    points: 25,
  },
  {
    code: 'PLACE_CATEGORIES_ALL',
    name: 'Nichts ausgelassen',
    description: 'Aus jeder der acht Kategorien mindestens einen Ort besucht',
    category: 'collector',
    domain: 'poi',
    icon: '🧩',
    tier: 'gold',
    requirement: 8,
    requirementType: 'place_categories_unique',
    points: 120,
  },

  // ── The regular haunt ─────────────────────────────────────────────
  {
    code: 'PLACE_REGULAR_5',
    name: 'Stammgast',
    description: '5 Besuche an ein und demselben Ort',
    category: 'kurios',
    domain: 'poi',
    icon: '☕',
    tier: 'bronze',
    requirement: 5,
    requirementType: 'place_same_repeat',
    points: 30,
  },
  {
    code: 'PLACE_REGULAR_15',
    name: 'Der übliche Platz',
    description: '15 Besuche an ein und demselben Ort',
    category: 'kurios',
    domain: 'poi',
    icon: '🪑',
    tier: 'gold',
    requirement: 15,
    requirementType: 'place_same_repeat',
    points: 100,
  },

  // ── A day out ─────────────────────────────────────────────────────
  {
    code: 'PLACES_ONE_DAY_5',
    name: 'Tagesprogramm',
    description: '5 verschiedene Orte an einem Tag besucht',
    category: 'kurios',
    domain: 'poi',
    icon: '🚶',
    tier: 'silver',
    requirement: 5,
    requirementType: 'places_one_day',
    points: 50,
  },
  {
    code: 'PLACES_ONE_DAY_10',
    name: 'Sightseeing-Marathon',
    description: '10 verschiedene Orte an einem Tag besucht',
    category: 'kurios',
    domain: 'poi',
    icon: '🏃',
    tier: 'gold',
    requirement: 10,
    requirementType: 'places_one_day',
    points: 150,
  },

  // ── Streaks ───────────────────────────────────────────────────────
  {
    code: 'PLACE_STREAK_7',
    name: 'Eine Woche unterwegs',
    description: 'An 7 Tagen hintereinander mindestens einen Ort besucht',
    category: 'explorer',
    domain: 'poi',
    icon: '📆',
    tier: 'silver',
    requirement: 7,
    requirementType: 'place_visit_streak',
    points: 60,
  },
  {
    code: 'PLACE_STREAK_14',
    name: 'Zwei Wochen am Stück',
    description: 'An 14 Tagen hintereinander mindestens einen Ort besucht',
    category: 'explorer',
    domain: 'poi',
    icon: '🗓',
    tier: 'gold',
    requirement: 14,
    requirementType: 'place_visit_streak',
    points: 140,
  },

  // ── A busy year ───────────────────────────────────────────────────
  {
    code: 'PLACE_YEAR_25',
    name: 'Gutes Jahr',
    description: '25 Besuche in einem Kalenderjahr',
    category: 'collector',
    domain: 'poi',
    icon: '📈',
    tier: 'silver',
    requirement: 25,
    requirementType: 'place_visits_in_year',
    points: 60,
  },
  {
    code: 'PLACE_YEAR_100',
    name: 'Jahr der Orte',
    description: '100 Besuche in einem Kalenderjahr',
    category: 'elite',
    domain: 'poi',
    icon: '🎯',
    tier: 'platinum',
    requirement: 100,
    requirementType: 'place_visits_in_year',
    points: 250,
  },
  {
    code: 'PLACE_COUNTRIES_YEAR_5',
    name: 'Fünf Länder in einem Jahr',
    description: 'In einem Kalenderjahr Orte in 5 Ländern besucht',
    category: 'explorer',
    domain: 'poi',
    icon: '🛂',
    tier: 'gold',
    requirement: 5,
    requirementType: 'place_countries_in_year',
    points: 120,
  },

  // ── Ratings and trips ─────────────────────────────────────────────
  {
    code: 'PLACE_RATED_10',
    name: 'Kritiker',
    description: '10 Besuche bewertet',
    category: 'collector',
    domain: 'poi',
    icon: '⭐',
    tier: 'bronze',
    requirement: 10,
    requirementType: 'place_rated_visits',
    points: 25,
  },
  {
    code: 'PLACE_RATED_50',
    name: 'Sterne vergeben',
    description: '50 Besuche bewertet',
    category: 'collector',
    domain: 'poi',
    icon: '🌟',
    tier: 'gold',
    requirement: 50,
    requirementType: 'place_rated_visits',
    points: 100,
  },
  {
    code: 'PLACE_TRIP_10',
    name: 'Teil der Reise',
    description: '10 Besuche einer Reise zugeordnet',
    category: 'planner',
    domain: 'poi',
    icon: '🧳',
    tier: 'bronze',
    requirement: 10,
    requirementType: 'place_trip_visits',
    points: 30,
  },
  {
    code: 'PLACE_TRIP_50',
    name: 'Lückenlos dokumentiert',
    description: '50 Besuche einer Reise zugeordnet',
    category: 'planner',
    domain: 'poi',
    icon: '📔',
    tier: 'gold',
    requirement: 50,
    requirementType: 'place_trip_visits',
    points: 120,
  },

  // ── How far north and south ───────────────────────────────────────
  {
    code: 'PLACE_NORTH_60',
    name: 'Hoher Norden',
    description: 'Einen Ort nördlich des 60. Breitengrads besucht',
    category: 'explorer',
    domain: 'poi',
    icon: '🧭',
    tier: 'silver',
    requirement: 60,
    requirementType: 'place_northern_lat',
    points: 60,
  },
  {
    code: 'PLACE_NORTH_66',
    name: 'Jenseits des Polarkreises',
    description: 'Einen Ort nördlich des Polarkreises besucht',
    category: 'elite',
    domain: 'poi',
    icon: '❄️',
    tier: 'gold',
    requirement: 66,
    requirementType: 'place_northern_lat',
    points: 150,
  },
  {
    code: 'PLACE_SOUTH_35',
    name: 'Weit im Süden',
    description: 'Einen Ort südlich des 35. Breitengrads besucht',
    category: 'explorer',
    domain: 'poi',
    icon: '🌡',
    tier: 'silver',
    requirement: 35,
    requirementType: 'place_southern_lat',
    points: 60,
  },
  {
    code: 'PLACE_SOUTH_54',
    name: 'Ende der Welt',
    description: 'Einen Ort südlich des 54. Breitengrads besucht — Feuerland und weiter',
    category: 'elite',
    domain: 'poi',
    icon: '🐧',
    tier: 'platinum',
    requirement: 54,
    requirementType: 'place_southern_lat',
    points: 250,
  },
];
