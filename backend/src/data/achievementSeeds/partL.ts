import type { AchievementDefinition } from "../achievements";

/**
 * Rental, bus and cross-domain badges (forgejo#262, #263, #265).
 *
 * The domain ones are measured by `utils/rentalAchievements.ts` and
 * `utils/busAchievements.ts`, the shared ones by
 * `utils/crossDomainAchievements.ts`; `utils/domainAchievementChecks.ts`
 * hands all three to the planner. A rental or bus badge is hidden while the
 * user has its domain off (`services/achievementVisibility.ts`).
 *
 * The thresholds are the issues' product proposals, marked one by one for
 * the owner to confirm. The depth rungs (more rides, kilometres, countries,
 * operators, a long ride) are the proposal of forgejo#405 and marked the same way.
 */
export const seedsPartL: AchievementDefinition[] = [
  {
    code: "RENTAL_FIRST",
    name: "Erste Schlüssel",
    description: "Die erste Miete abgeschlossen",
    category: "explorer",
    domain: "rental",
    icon: "🔑",
    tier: "bronze",
    // threshold: proposal forgejo#262, owner to confirm
    requirement: 1,
    requirementType: "rental_count",
    points: 10,
  },
  {
    code: "RENTAL_ONE_WAY",
    name: "Anderswo abgegeben",
    description: "Einen Mietwagen an einer anderen Station zurückgegeben als abgeholt",
    category: "special",
    domain: "rental",
    icon: "↪️",
    tier: "bronze",
    // threshold: proposal forgejo#262, owner to confirm
    requirement: 1,
    requirementType: "rental_one_way",
    points: 20,
  },
  {
    code: "RENTAL_ODOMETER_5",
    name: "Kilometerbuch",
    description: "Fünf abgeschlossene Mieten mit Anfangs- und Endkilometerstand",
    category: "collector",
    domain: "rental",
    icon: "📒",
    tier: "silver",
    // threshold: proposal forgejo#262, owner to confirm
    requirement: 5,
    requirementType: "rental_odometer_documented",
    points: 40,
  },
  {
    code: "BUS_FIRST",
    name: "Erste Reihe im Logbuch",
    description: "Die erste Busfahrt abgeschlossen",
    category: "explorer",
    domain: "bus",
    icon: "🚌",
    tier: "bronze",
    // threshold: proposal forgejo#263, owner to confirm
    requirement: 1,
    requirementType: "bus_count",
    points: 10,
  },
  {
    code: "BUS_NIGHT",
    name: "Über Nacht unterwegs",
    description: "Eine Busfahrt über Nacht, belegt durch Abfahrts- und Ankunftszeit",
    category: "special",
    domain: "bus",
    icon: "🌙",
    tier: "bronze",
    // threshold: proposal forgejo#263, owner to confirm
    requirement: 1,
    requirementType: "bus_night_rides",
    points: 20,
  },
  {
    code: "BUS_TERMINALS_10",
    name: "Neue Haltestellen",
    description: "Zehn verschiedene Bus-Terminals besucht",
    category: "collector",
    domain: "bus",
    icon: "🚏",
    tier: "silver",
    // threshold: proposal forgejo#263, owner to confirm
    requirement: 10,
    requirementType: "bus_terminals",
    points: 40,
  },
  {
    code: "RENTAL_10",
    name: "Mietwagen-Stammkunde",
    description: "10 Mieten abgeschlossen",
    category: "explorer",
    domain: "rental",
    icon: "🔑",
    tier: "silver",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 10,
    requirementType: "rental_count",
    points: 50,
  },
  {
    code: "RENTAL_25",
    name: "Schlüsselbund",
    description: "25 Mieten abgeschlossen",
    category: "explorer",
    domain: "rental",
    icon: "🗝️",
    tier: "gold",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 25,
    requirementType: "rental_count",
    points: 150,
  },
  {
    code: "RENTAL_KM_5000",
    name: "Fünftausend Mietkilometer",
    description: "5.000 km mit Mietwagen gefahren, belegt durch den Tachostand",
    category: "distance",
    domain: "rental",
    icon: "🛞",
    tier: "silver",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 5000,
    requirementType: "rental_odometer_km",
    points: 60,
  },
  {
    code: "RENTAL_KM_25000",
    name: "Fünfundzwanzigtausend Mietkilometer",
    description: "25.000 km mit Mietwagen gefahren, belegt durch den Tachostand",
    category: "distance",
    domain: "rental",
    icon: "🏎️",
    tier: "gold",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 25000,
    requirementType: "rental_odometer_km",
    points: 150,
  },
  {
    code: "RENTAL_COUNTRIES_3",
    name: "Mietwagen in drei Ländern",
    description: "Mietstationen in drei Ländern genutzt",
    category: "explorer",
    domain: "rental",
    icon: "🗺️",
    tier: "bronze",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 3,
    requirementType: "rental_countries",
    points: 25,
  },
  {
    code: "RENTAL_COUNTRIES_10",
    name: "Mietwagen in zehn Ländern",
    description: "Mietstationen in zehn Ländern genutzt",
    category: "explorer",
    domain: "rental",
    icon: "🧭",
    tier: "gold",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 10,
    requirementType: "rental_countries",
    points: 100,
  },
  {
    code: "RENTAL_COMPANIES_5",
    name: "Fünf Vermieter",
    description: "Bei fünf verschiedenen Vermietern gemietet",
    category: "collector",
    domain: "rental",
    icon: "🏷️",
    tier: "silver",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 5,
    requirementType: "rental_companies",
    points: 40,
  },
  {
    code: "RENTAL_LONG_14",
    name: "Zwei Wochen am Steuer",
    description: "Eine einzelne Miete über mindestens 14 Tage",
    category: "elite",
    domain: "rental",
    icon: "📅",
    tier: "silver",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 14,
    requirementType: "rental_longest_days",
    points: 60,
  },
  {
    code: "BUS_25",
    name: "Stammgast im Bus",
    description: "25 Busfahrten abgeschlossen",
    category: "explorer",
    domain: "bus",
    icon: "🎫",
    tier: "silver",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 25,
    requirementType: "bus_count",
    points: 50,
  },
  {
    code: "BUS_100",
    name: "Busfahrer aus Leidenschaft",
    description: "100 Busfahrten abgeschlossen",
    category: "explorer",
    domain: "bus",
    icon: "🚍",
    tier: "gold",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 100,
    requirementType: "bus_count",
    points: 150,
  },
  {
    code: "BUS_KM_1000",
    name: "Tausend Kilometer Landstraße",
    description: "1.000 km mit dem Bus zurückgelegt",
    category: "distance",
    domain: "bus",
    icon: "🛣️",
    tier: "bronze",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 1000,
    requirementType: "bus_km",
    points: 30,
  },
  {
    code: "BUS_KM_10000",
    name: "Zehntausend Kilometer Asphalt",
    description: "10.000 km mit dem Bus zurückgelegt",
    category: "distance",
    domain: "bus",
    icon: "🗾",
    tier: "silver",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 10000,
    requirementType: "bus_km",
    points: 100,
  },
  {
    code: "BUS_COUNTRIES_3",
    name: "Mit dem Bus über Grenzen",
    description: "Haltestellen in drei Ländern erreicht",
    category: "explorer",
    domain: "bus",
    icon: "🗺️",
    tier: "bronze",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 3,
    requirementType: "bus_countries",
    points: 25,
  },
  {
    code: "BUS_COUNTRIES_10",
    name: "Kontinent im Bus",
    description: "Haltestellen in zehn Ländern erreicht",
    category: "explorer",
    domain: "bus",
    icon: "🧭",
    tier: "gold",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 10,
    requirementType: "bus_countries",
    points: 100,
  },
  {
    code: "BUS_CROSS_BORDER_1",
    name: "Grenzübertritt im Bus",
    description: "Eine Busfahrt über eine Landesgrenze",
    category: "special",
    domain: "bus",
    icon: "🛂",
    tier: "bronze",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 1,
    requirementType: "bus_cross_border",
    points: 20,
  },
  {
    code: "BUS_CROSS_BORDER_10",
    name: "Grenzgänger im Bus",
    description: "Zehn Busfahrten über eine Landesgrenze",
    category: "special",
    domain: "bus",
    icon: "🚧",
    tier: "silver",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 10,
    requirementType: "bus_cross_border",
    points: 80,
  },
  {
    code: "BUS_OPERATORS_5",
    name: "Fünf Busunternehmen",
    description: "Mit fünf verschiedenen Busunternehmen gefahren",
    category: "collector",
    domain: "bus",
    icon: "🏷️",
    tier: "silver",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 5,
    requirementType: "bus_operators",
    points: 40,
  },
  {
    code: "BUS_LONG_500",
    name: "Langstrecke im Bus",
    description: "Eine einzelne Busfahrt über 500 km",
    category: "elite",
    domain: "bus",
    icon: "🏁",
    tier: "silver",
    // threshold: proposal forgejo#405 (owner decision 2026-10-29), owner to confirm
    requirement: 500,
    requirementType: "bus_longest_km",
    points: 60,
  },
  // Shared trip badges (forgejo#265), measured by `utils/crossDomainAchievements.ts`.
  {
    code: "TRIP_THREE_MODES",
    name: "Drei Verkehrsmittel",
    description: "Eine abgeschlossene Reise mit drei verschiedenen Verkehrsmitteln",
    category: "special",
    domain: "shared",
    icon: "🔁",
    tier: "gold",
    // threshold: proposal forgejo#265, owner to confirm
    requirement: 1,
    requirementType: "trips_three_modes",
    points: 80,
  },
  {
    code: "TRIP_ARRIVE_DISCOVER",
    name: "Ankommen und entdecken",
    description:
      "Mit Bahn oder Bus angereist, übernachtet und einen Ort besucht – auf derselben Reise",
    category: "special",
    domain: "shared",
    icon: "🚉🏨📍",
    tier: "gold",
    // threshold: proposal forgejo#265, owner to confirm
    requirement: 1,
    requirementType: "trips_arrive_and_discover",
    points: 60,
  },
];

/**
 * Shared badges that only some domains can earn (forgejo#265): such a badge
 * is listed while at least one of its domains is visible, and hidden with all
 * of them — "Ankommen und entdecken" needs a train or a coach; three modes on
 * one trip cannot be reached with flights and cruises alone. Read by
 * `services/achievementVisibility.ts`.
 */
export const SHARED_BADGE_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  TRIP_THREE_MODES: ["rail", "bus", "roadtrip"],
  TRIP_ARRIVE_DISCOVER: ["rail", "bus"],
};
