import type { AchievementDefinition } from "../achievements";

/**
 * Part K — the statistics expansion (forgejo#258 lodging, #259 places, #260
 * roadtrips, #264 day tours). Measured by `utils/insightAchievements.ts` from
 * the same computation the statistics tab draws (`services/stats/insights`),
 * so a badge and the figure beside it can never disagree.
 *
 * EVERY THRESHOLD HERE IS A PRODUCT PROPOSAL from the 2026-10-08 audit and is
 * marked so; the owner confirms or changes them. Each was compared with the
 * existing catalogue first: none duplicates a rule — the nearest ones
 * (LODGING_TYPES_*, RETURNER_*, PLACE_CATEGORIES_*) count over a lifetime or
 * count stays, where these count within one trip, across calendar years, or
 * across one year's months.
 *
 * Held only while the live measure meets the rule (owner ruling 2026-09-20,
 * `achievementWrites.ts`) — nothing here is "once earned, forever".
 *
 * Copy is German (user-facing); English lives in the achievements locale.
 */
export const seedsPartK: AchievementDefinition[] = [
  {
    code: "LODGING_FOUR_WORLDS",
    name: "Vier Schlafwelten",
    description: "Vier verschiedene Unterkunftsarten auf einer abgeschlossenen Reise",
    category: "explorer",
    domain: "lodging",
    icon: "🛏️",
    tier: "silver",
    // threshold: proposal forgejo#258, owner to confirm
    requirement: 4,
    requirementType: "lodging_trip_types_max",
    points: 60,
  },
  {
    code: "LODGING_WELCOME_YEARS_5",
    name: "Jahrelang willkommen",
    description: "Dasselbe Haus in fünf verschiedenen Kalenderjahren besucht",
    category: "special",
    domain: "lodging",
    icon: "🗝️",
    tier: "gold",
    // threshold: proposal forgejo#258, owner to confirm
    requirement: 5,
    requirementType: "lodging_same_house_years",
    points: 100,
  },
  {
    code: "LODGING_FULL_CALENDAR",
    name: "Einmal durch den Kalender",
    description: "In jedem Monat eines Kalenderjahres mindestens eine Nacht auswärts geschlafen",
    category: "elite",
    domain: "lodging",
    icon: "🗓️",
    tier: "gold",
    // threshold: proposal forgejo#258, owner to confirm
    requirement: 12,
    requirementType: "lodging_months_in_year",
    points: 120,
  },
  {
    code: "PLACE_REUNION_5Y",
    name: "Wiedersehen nach Jahren",
    description: "Denselben Ort nach mindestens fünf Jahren erneut besucht",
    category: "special",
    domain: "poi",
    icon: "🔁",
    tier: "silver",
    // threshold: proposal forgejo#259, owner to confirm
    requirement: 5,
    requirementType: "place_revisit_gap_years",
    points: 60,
  },
  {
    code: "PLACE_COLOURFUL_TRIP",
    name: "Bunte Reise",
    description: "Orte aus fünf verschiedenen Kategorien auf einer Reise besucht",
    category: "explorer",
    domain: "poi",
    icon: "🎨",
    tier: "silver",
    // threshold: proposal forgejo#259, owner to confirm
    requirement: 5,
    requirementType: "place_trip_categories_max",
    points: 60,
  },
  {
    code: "PLACE_WELL_REMEMBERED_10",
    name: "Gut erinnert",
    description: "Zehn Besuche mit eigener Notiz und eigenem Foto dokumentiert",
    category: "collector",
    domain: "poi",
    icon: "📓",
    tier: "bronze",
    // threshold: proposal forgejo#259, owner to confirm
    requirement: 10,
    requirementType: "place_documented_visits",
    points: 30,
  },
  {
    code: "ROADTRIP_BASE_CAMP",
    name: "Basislager",
    description: "Drei Nächte an einer Station und von dort zwei Tagestouren unternommen",
    category: "special",
    domain: "roadtrip",
    icon: "⛺",
    tier: "silver",
    // threshold: proposal forgejo#260, owner to confirm (3 nights + 2 tours:
    // BASE_CAMP_NIGHTS / BASE_CAMP_TOURS in utils/roadtripInsights)
    requirement: 1,
    requirementType: "roadtrip_base_camp",
    points: 60,
  },
  {
    code: "ROADTRIP_LAND_AND_WATER",
    name: "Land und Wasser",
    description: "Auf einem Roadtrip sowohl Straßen- als auch Fährstrecken zurückgelegt",
    category: "explorer",
    domain: "roadtrip",
    icon: "⛴️",
    tier: "bronze",
    // threshold: proposal forgejo#260, owner to confirm
    requirement: 1,
    requirementType: "roadtrip_land_and_water",
    points: 30,
  },
  {
    code: "ROADTRIP_MUSCLE_POWER_3",
    name: "Mit Muskelkraft weiter",
    description: "Von drei verschiedenen Roadtrip-Stationen aus Tagestouren unternommen",
    category: "explorer",
    domain: "roadtrip",
    icon: "🥾",
    tier: "silver",
    // threshold: proposal forgejo#260, owner to confirm
    requirement: 3,
    requirementType: "roadtrip_tour_stations",
    points: 60,
  },
  {
    code: "TOUR_FIRST_STEPS",
    name: "Erste Schritte",
    description: "Die erste Tagestour abgeschlossen",
    category: "explorer",
    domain: "roadtrip",
    icon: "👣",
    tier: "bronze",
    // threshold: proposal forgejo#264, owner to confirm
    requirement: 1,
    requirementType: "tour_count",
    points: 10,
  },
  {
    code: "TOUR_THREE_KINDS",
    name: "Drei Arten unterwegs",
    description: "Tagestouren mit drei verschiedenen Aktivitäten abgeschlossen",
    category: "explorer",
    domain: "roadtrip",
    icon: "🚵",
    tier: "silver",
    // threshold: proposal forgejo#264, owner to confirm
    requirement: 3,
    requirementType: "tour_activities_unique",
    points: 40,
  },
  {
    code: "TOUR_ASCENT_1000",
    name: "Höhen gesammelt",
    description: "1.000 aufgezeichnete Höhenmeter im Aufstieg auf abgeschlossenen Touren",
    category: "distance",
    domain: "roadtrip",
    icon: "⛰️",
    tier: "silver",
    // threshold: proposal forgejo#264, owner to confirm
    requirement: 1000,
    requirementType: "tour_ascent_m",
    points: 50,
  },
];
