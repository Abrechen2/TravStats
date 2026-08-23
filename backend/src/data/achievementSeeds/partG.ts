// Achievement seed definitions — Part G: the POI domain.
//
// The first badges that ask about PLACES rather than journeys. Every threshold
// here reads off `shared/placeCounting.ts` via `utils/placeStats.ts`, so an
// undated visit counts and a future-dated one does not — the same two rules the
// stats page obeys, which is the point of routing both through one module.
//
// The checklist badges name their list INSIDE the requirement type
// (`curated_list_complete:<key>`); `utils/achievementChecks.ts` explains why
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
    requirementType: 'curated_list_complete:world-wonders-new7',
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
    requirementType: 'curated_list_complete:world-wonders-ancient',
    points: 250,
  },
];
