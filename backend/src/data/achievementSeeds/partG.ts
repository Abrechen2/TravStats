// Achievement seed definitions — Part G: the POI domain.
//
// The first badges that ask about PLACES rather than journeys. Every threshold
// here reads off `shared/placeCounting.ts` via `utils/placeStats.ts`, so an
// undated visit counts and a future-dated one does not — the same two rules the
// stats page obeys, which is the point of routing both through one module.
//
// The checklist badges name their list INSIDE the requirement type
// (`curated_list_ticked:<key>`); `utils/achievementChecks.ts` explains why
// that beats a code→key table in a third file.
//
// Copy is German (user-facing; see the language policy). English lives in
// `frontend/src/i18n/resources/en/achievements.json` under `codes.<CODE>`,
// which the achievements page prefers over the seeded name.

import type { AchievementDefinition } from '../achievements';

export const seedsPartG: AchievementDefinition[] = [
  // ── Places visited — the ladder ───────────────────────────────────
  {
    code: 'PLACES_10',
    name: 'Ortskundig',
    description: '10 besuchte Orte im Logbuch',
    category: 'collector',
    domain: 'poi',
    icon: '📍',
    tier: 'bronze',
    requirement: 10,
    requirementType: 'places_count',
    points: 20,
  },
  {
    code: 'PLACES_50',
    name: 'Stadtplan im Kopf',
    description: '50 besuchte Orte im Logbuch',
    category: 'collector',
    domain: 'poi',
    icon: '🗺',
    tier: 'silver',
    requirement: 50,
    requirementType: 'places_count',
    points: 50,
  },
  {
    code: 'PLACES_250',
    name: 'Ortsregister',
    description: '250 besuchte Orte im Logbuch',
    category: 'collector',
    domain: 'poi',
    icon: '📚',
    tier: 'gold',
    requirement: 250,
    requirementType: 'places_count',
    points: 120,
  },

  // ── Countries with a place ────────────────────────────────────────
  {
    code: 'PLACE_COUNTRIES_10',
    name: 'Zehn Länder, zehn Orte',
    description: 'Besuchte Orte in 10 verschiedenen Ländern',
    category: 'explorer',
    domain: 'poi',
    icon: '🌐',
    tier: 'silver',
    requirement: 10,
    requirementType: 'place_countries',
    points: 60,
  },
  {
    code: 'PLACE_COUNTRIES_25',
    name: 'Überall ein Lieblingsplatz',
    description: 'Besuchte Orte in 25 verschiedenen Ländern',
    category: 'explorer',
    domain: 'poi',
    icon: '🧭',
    tier: 'gold',
    requirement: 25,
    requirementType: 'place_countries',
    points: 130,
  },

  // ── Visits, not places — the #177 distinction, as a badge ─────────
  {
    code: 'PLACE_VISITS_100',
    name: 'Stammgast',
    description: '100 erfasste Besuche — Wiederbesuche zählen einzeln',
    category: 'collector',
    domain: 'poi',
    icon: '🔁',
    tier: 'silver',
    requirement: 100,
    requirementType: 'place_visits_count',
    points: 70,
  },

  // ── One category, many pins ──────────────────────────────────────
  {
    code: 'PLACES_CATEGORY_25',
    name: 'Immer dasselbe',
    description: '25 besuchte Orte derselben Kategorie',
    category: 'kurios',
    domain: 'poi',
    icon: '🍟',
    tier: 'silver',
    requirement: 25,
    requirementType: 'places_in_category',
    points: 55,
  },

  // ── The shipped checklists ───────────────────────────────────────
  {
    code: 'WONDERS_NEW7',
    name: 'Neue 7 Weltwunder',
    description: 'Alle sieben neuen Weltwunder besucht',
    category: 'elite',
    domain: 'poi',
    icon: '🌍',
    tier: 'diamond',
    requirement: 7,
    requirementType: 'curated_list_ticked:world-wonders-new7',
    points: 250,
  },
  {
    code: 'WONDERS_ANCIENT',
    name: 'Sieben Weltwunder der Antike',
    // Six of them no longer stand — the site is what gets visited, and the
    // checklist says so. That is the joke and the reason this one is elite.
    description: 'An allen sieben antiken Weltwundern gestanden — sechs davon in Gedanken',
    category: 'elite',
    domain: 'poi',
    icon: '🏛',
    tier: 'diamond',
    requirement: 7,
    requirementType: 'curated_list_ticked:world-wonders-ancient',
    points: 250,
  },

  // ── UNESCO World Heritage — rungs, not a finish line ─────────────
  //
  // 1247 sites. Nobody completes this list, and a single badge at 1247 would be
  // a number that only ever reads as failure. Three rungs give it a shape: a
  // handful, a serious collection, and a hundred — which is already more than
  // most people will ever stand in front of.
  {
    code: 'HERITAGE_10',
    name: 'Welterbe-Sammler',
    description: '10 Stätten der UNESCO-Welterbeliste besucht',
    category: 'collector',
    domain: 'poi',
    icon: '🏺',
    tier: 'bronze',
    requirement: 10,
    requirementType: 'curated_list_ticked:world-heritage',
    points: 40,
  },
  {
    code: 'HERITAGE_50',
    name: 'Welterbe-Kenner',
    description: '50 Stätten der UNESCO-Welterbeliste besucht',
    category: 'collector',
    domain: 'poi',
    icon: '🗿',
    tier: 'gold',
    requirement: 50,
    requirementType: 'curated_list_ticked:world-heritage',
    points: 150,
  },
  {
    code: 'HERITAGE_100',
    name: 'Welterbe-Chronist',
    description: '100 Stätten der UNESCO-Welterbeliste besucht',
    category: 'collector',
    domain: 'poi',
    icon: '📜',
    tier: 'diamond',
    requirement: 100,
    requirementType: 'curated_list_ticked:world-heritage',
    points: 400,
  },

  // ── Museum warships — rungs, same reasoning as UNESCO above ──────
  //
  // The catalog can grow (more ships get added the way more sites can), so a
  // fixed "all N" badge would need editing every time the CSV does. Two rungs
  // instead of a finish line.
  {
    code: 'WARSHIPS_5',
    name: 'Deck betreten',
    description: '5 Museums-Kriegsschiffe besucht',
    category: 'collector',
    domain: 'poi',
    icon: '⚓',
    tier: 'bronze',
    requirement: 5,
    requirementType: 'curated_list_ticked:museum-warships',
    points: 40,
  },
  {
    code: 'WARSHIPS_10',
    name: 'Flottenbesuch',
    description: '10 Museums-Kriegsschiffe besucht',
    category: 'collector',
    domain: 'poi',
    icon: '🎖',
    tier: 'gold',
    requirement: 10,
    requirementType: 'curated_list_ticked:museum-warships',
    points: 120,
  },
];
