// Achievement seed definitions — Part D
// Lodging-domain achievements (39) + cross-domain shared achievements (2).
// Requirement checkers for these types live in `utils/achievementChecks.ts`;
// the stats they read come from `calculateLodgingStats` +
// `computeFlyAndStayFlags` (both wired into the real engine in
// `utils/achievements.ts`).

import type { AchievementDefinition } from '../achievements';

export const seedsPartD: AchievementDefinition[] = [
  // First check-in
  { code: 'FIRST_CHECKIN', name: 'Eingecheckt', description: 'Erste Unterkunft gespeichert', category: 'explorer', domain: 'lodging', icon: '🏨', tier: 'bronze', requirement: 1, requirementType: 'lodgings_count', points: 10 },

  // Hotel Collector — distinct lodgings
  { code: 'HOTEL_COLLECTOR_5', name: 'Hotel-Sammler', description: '5 verschiedene Unterkünfte besucht', category: 'collector', domain: 'lodging', icon: '🏨', tier: 'bronze', requirement: 5, requirementType: 'lodgings_count', points: 25 },
  { code: 'HOTEL_COLLECTOR_10', name: 'Vielreisender Gast', description: '10 verschiedene Unterkünfte besucht', category: 'collector', domain: 'lodging', icon: '🏨', tier: 'silver', requirement: 10, requirementType: 'lodgings_count', points: 45 },
  { code: 'HOTEL_COLLECTOR_25', name: 'Unterkunfts-Kenner', description: '25 verschiedene Unterkünfte besucht', category: 'collector', domain: 'lodging', icon: '🏨', tier: 'gold', requirement: 25, requirementType: 'lodgings_count', points: 80 },
  { code: 'HOTEL_COLLECTOR_50', name: 'Herbergs-Experte', description: '50 verschiedene Unterkünfte besucht', category: 'collector', domain: 'lodging', icon: '🏨', tier: 'platinum', requirement: 50, requirementType: 'lodgings_count', points: 140 },
  { code: 'HOTEL_COLLECTOR_100', name: 'Hotel-Legende', description: '100 verschiedene Unterkünfte besucht', category: 'collector', domain: 'lodging', icon: '🏨', tier: 'diamond', requirement: 100, requirementType: 'lodgings_count', points: 260 },
  { code: 'HOTEL_COLLECTOR_200', name: 'Unterkunfts-Weltmeister', description: '200 verschiedene Unterkünfte besucht', category: 'collector', domain: 'lodging', icon: '🏨', tier: 'diamond', requirement: 200, requirementType: 'lodgings_count', points: 450 },

  // Frequent Guest — total number of stays (bookings), not distinct lodgings
  { code: 'FREQUENT_GUEST_10', name: 'Stammgast', description: '10 Aufenthalte insgesamt', category: 'collector', domain: 'lodging', icon: '🛎️', tier: 'bronze', requirement: 10, requirementType: 'lodging_stays_count', points: 30 },
  { code: 'FREQUENT_GUEST_25', name: 'Vielbucher', description: '25 Aufenthalte insgesamt', category: 'collector', domain: 'lodging', icon: '🛎️', tier: 'silver', requirement: 25, requirementType: 'lodging_stays_count', points: 60 },
  { code: 'FREQUENT_GUEST_50', name: 'Check-in-Profi', description: '50 Aufenthalte insgesamt', category: 'collector', domain: 'lodging', icon: '🛎️', tier: 'gold', requirement: 50, requirementType: 'lodging_stays_count', points: 100 },
  { code: 'FREQUENT_GUEST_100', name: 'Rezeptions-Legende', description: '100 Aufenthalte insgesamt', category: 'collector', domain: 'lodging', icon: '🛎️', tier: 'platinum', requirement: 100, requirementType: 'lodging_stays_count', points: 180 },

  // Nights tallied across all stays
  { code: 'LODGING_NIGHTS_10', name: 'Erste Nächte', description: '10 Übernachtungen gesamt', category: 'collector', domain: 'lodging', icon: '🌙', tier: 'bronze', requirement: 10, requirementType: 'lodging_nights', points: 20 },
  { code: 'LODGING_NIGHTS_50', name: 'Fünfzig Nächte', description: '50 Übernachtungen gesamt', category: 'collector', domain: 'lodging', icon: '🌙', tier: 'silver', requirement: 50, requirementType: 'lodging_nights', points: 45 },
  { code: 'LODGING_NIGHTS_100', name: 'Hundert Nächte', description: '100 Übernachtungen gesamt', category: 'collector', domain: 'lodging', icon: '🌙', tier: 'gold', requirement: 100, requirementType: 'lodging_nights', points: 80 },
  { code: 'LODGING_NIGHTS_365', name: 'Ein Jahr unterwegs', description: '365 Übernachtungen gesamt', category: 'collector', domain: 'lodging', icon: '🌙', tier: 'platinum', requirement: 365, requirementType: 'lodging_nights', points: 220 },
  { code: 'LODGING_NIGHTS_1000', name: 'Nomaden-Legende', description: '1.000 Übernachtungen gesamt', category: 'collector', domain: 'lodging', icon: '🌙', tier: 'diamond', requirement: 1000, requirementType: 'lodging_nights', points: 500 },

  // Longest single stay
  { code: 'LONG_STAY_7', name: 'Erste Woche', description: 'Ein Aufenthalt von mindestens 7 Nächten', category: 'special', domain: 'lodging', icon: '🛏️', tier: 'bronze', requirement: 7, requirementType: 'lodging_longest_stay', points: 20 },
  { code: 'LONG_STAY_14', name: 'Zwei Wochen Auszeit', description: 'Ein Aufenthalt von mindestens 14 Nächten', category: 'special', domain: 'lodging', icon: '🛏️', tier: 'silver', requirement: 14, requirementType: 'lodging_longest_stay', points: 40 },
  { code: 'LONG_STAY_30', name: 'Langzeit-Gast', description: 'Ein Aufenthalt von mindestens 30 Nächten', category: 'special', domain: 'lodging', icon: '🛏️', tier: 'gold', requirement: 30, requirementType: 'lodging_longest_stay', points: 80 },
  { code: 'LONG_STAY_60', name: 'Digitaler Nomade', description: 'Ein Aufenthalt von mindestens 60 Nächten', category: 'special', domain: 'lodging', icon: '🛏️', tier: 'platinum', requirement: 60, requirementType: 'lodging_longest_stay', points: 150 },

  // Chain Explorer — distinct hotel chains
  { code: 'CHAIN_EXPLORER_3', name: 'Marken-Entdecker', description: '3 verschiedene Hotelketten', category: 'collector', domain: 'lodging', icon: '🔗', tier: 'bronze', requirement: 3, requirementType: 'lodging_chains_unique', points: 20 },
  { code: 'CHAIN_EXPLORER_5', name: 'Ketten-Kenner', description: '5 verschiedene Hotelketten', category: 'collector', domain: 'lodging', icon: '🔗', tier: 'silver', requirement: 5, requirementType: 'lodging_chains_unique', points: 40 },
  { code: 'CHAIN_EXPLORER_10', name: 'Marken-Vielfalt', description: '10 verschiedene Hotelketten', category: 'collector', domain: 'lodging', icon: '🔗', tier: 'gold', requirement: 10, requirementType: 'lodging_chains_unique', points: 75 },
  { code: 'CHAIN_EXPLORER_20', name: 'Ketten-Meister', description: '20 verschiedene Hotelketten', category: 'collector', domain: 'lodging', icon: '🔗', tier: 'platinum', requirement: 20, requirementType: 'lodging_chains_unique', points: 140 },

  // Brand Loyalty — most stays with a single chain
  { code: 'BRAND_LOYALTY_5', name: 'Treuer Gast', description: '5 Aufenthalte bei derselben Hotelkette', category: 'collector', domain: 'lodging', icon: '🎖️', tier: 'bronze', requirement: 5, requirementType: 'lodging_chain_loyalty', points: 25 },
  { code: 'BRAND_LOYALTY_10', name: 'Markentreue', description: '10 Aufenthalte bei derselben Hotelkette', category: 'collector', domain: 'lodging', icon: '🎖️', tier: 'silver', requirement: 10, requirementType: 'lodging_chain_loyalty', points: 55 },
  { code: 'BRAND_LOYALTY_25', name: 'Kettenloyalist', description: '25 Aufenthalte bei derselben Hotelkette', category: 'collector', domain: 'lodging', icon: '🎖️', tier: 'gold', requirement: 25, requirementType: 'lodging_chain_loyalty', points: 110 },

  // Border Crosser — distinct lodging countries
  { code: 'BORDER_CROSSER_3', name: 'Grenzgänger', description: 'Unterkünfte in 3 Ländern', category: 'explorer', domain: 'lodging', icon: '🌍', tier: 'bronze', requirement: 3, requirementType: 'lodging_countries', points: 20 },
  { code: 'BORDER_CROSSER_5', name: 'Länder-Sammler', description: 'Unterkünfte in 5 Ländern', category: 'explorer', domain: 'lodging', icon: '🌍', tier: 'silver', requirement: 5, requirementType: 'lodging_countries', points: 45 },
  { code: 'BORDER_CROSSER_10', name: 'Kontinental-Gast', description: 'Unterkünfte in 10 Ländern', category: 'explorer', domain: 'lodging', icon: '🌍', tier: 'gold', requirement: 10, requirementType: 'lodging_countries', points: 90 },
  { code: 'BORDER_CROSSER_25', name: 'Weltenbürger', description: 'Unterkünfte in 25 Ländern', category: 'explorer', domain: 'lodging', icon: '🌍', tier: 'platinum', requirement: 25, requirementType: 'lodging_countries', points: 180 },

  // Points Pro — nights paid with loyalty points / award stays
  { code: 'POINTS_PRO_5', name: 'Punkte-Einsteiger', description: '5 Freinächte über Prämienpunkte', category: 'special', domain: 'lodging', icon: '🏆', tier: 'bronze', requirement: 5, requirementType: 'lodging_award_nights', points: 20 },
  { code: 'POINTS_PRO_25', name: 'Prämien-Kenner', description: '25 Freinächte über Prämienpunkte', category: 'special', domain: 'lodging', icon: '🏆', tier: 'silver', requirement: 25, requirementType: 'lodging_award_nights', points: 50 },
  { code: 'POINTS_PRO_100', name: 'Punkte-Profi', description: '100 Freinächte über Prämienpunkte', category: 'special', domain: 'lodging', icon: '🏆', tier: 'gold', requirement: 100, requirementType: 'lodging_award_nights', points: 100 },
  { code: 'POINTS_PRO_500', name: 'Bonus-Legende', description: '500 Freinächte über Prämienpunkte', category: 'special', domain: 'lodging', icon: '🏆', tier: 'platinum', requirement: 500, requirementType: 'lodging_award_nights', points: 250 },

  // Returner — most stays repeated at the same single lodging
  { code: 'RETURNER_2', name: 'Wiederkehrer', description: '2 Aufenthalte im selben Hotel', category: 'special', domain: 'lodging', icon: '🔁', tier: 'bronze', requirement: 2, requirementType: 'lodging_same_hotel_repeat', points: 15 },
  { code: 'RETURNER_3', name: 'Bekanntes Gesicht', description: '3 Aufenthalte im selben Hotel', category: 'special', domain: 'lodging', icon: '🔁', tier: 'silver', requirement: 3, requirementType: 'lodging_same_hotel_repeat', points: 35 },
  { code: 'RETURNER_5', name: 'Stammhotel', description: '5 Aufenthalte im selben Hotel', category: 'special', domain: 'lodging', icon: '🔁', tier: 'gold', requirement: 5, requirementType: 'lodging_same_hotel_repeat', points: 70 },
  { code: 'RETURNER_10', name: 'Zweites Zuhause', description: '10 Aufenthalte im selben Hotel', category: 'special', domain: 'lodging', icon: '🔁', tier: 'platinum', requirement: 10, requirementType: 'lodging_same_hotel_repeat', points: 140 },

  // Shared (domain: 'shared') — cross-domain achievements.
  { code: 'FLY_AND_STAY', name: 'Fly & Stay', description: 'Trip mit Flug UND Unterkunft', category: 'special', domain: 'shared', icon: '✈️🏨', tier: 'gold', requirement: 1, requirementType: 'fly_and_stay', points: 60 },
  { code: 'GRAND_TOUR', name: 'Grand Tour', description: 'Trip mit Flug, Kreuzfahrt UND Unterkunft', category: 'special', domain: 'shared', icon: '✈️🚢🏨', tier: 'platinum', requirement: 1, requirementType: 'grand_tour', points: 120 },
];
