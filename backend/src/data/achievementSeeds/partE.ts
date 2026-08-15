// Achievement seed definitions — Part E
//
// The lodging domain shipped 39 achievements drawn from nine counters: number
// of houses, stays, nights, countries, chains, award nights, chain loyalty,
// longest stay, same-hotel repeats. Every one of the 39 was a tier of one of
// those nine, so a tenth tier added nothing a user could feel.
//
// These read the measures the 2.7 statistics expansion added — stars, board,
// the four rating columns, coordinates, the run of nights away, programme
// years, the chain/independent split — plus one cross-domain badge for a trip
// that is documented end to end.
//
// Copy is German (user-facing; see the language policy). English lives in
// `frontend/src/i18n/resources/en/achievements.json` under `codes.<CODE>`,
// which the achievements page prefers over the seeded name.

import type { AchievementDefinition } from '../achievements';

export const seedsPartE: AchievementDefinition[] = [
  // --- Collector: variety rather than volume ---
  { code: 'LODGING_TYPES_3', name: 'Nicht wählerisch', description: 'In 3 verschiedenen Unterkunftsarten übernachtet', category: 'collector', domain: 'lodging', icon: '🏕️', tier: 'bronze', requirement: 3, requirementType: 'lodging_types_unique', points: 30 },
  { code: 'LODGING_TYPES_5', name: 'Hauptsache ein Bett', description: 'In allen 5 Unterkunftsarten übernachtet', category: 'collector', domain: 'lodging', icon: '🛖', tier: 'gold', requirement: 5, requirementType: 'lodging_types_unique', points: 90 },

  { code: 'LODGING_CITIES_10', name: 'Zehn Städte', description: 'In 10 verschiedenen Städten übernachtet', category: 'collector', domain: 'lodging', icon: '🏙️', tier: 'bronze', requirement: 10, requirementType: 'lodging_cities_unique', points: 30 },
  { code: 'LODGING_CITIES_25', name: 'Städtesammler', description: 'In 25 verschiedenen Städten übernachtet', category: 'collector', domain: 'lodging', icon: '🏙️', tier: 'silver', requirement: 25, requirementType: 'lodging_cities_unique', points: 60 },
  { code: 'LODGING_CITIES_50', name: 'Überall zuhause', description: 'In 50 verschiedenen Städten übernachtet', category: 'collector', domain: 'lodging', icon: '🏙️', tier: 'gold', requirement: 50, requirementType: 'lodging_cities_unique', points: 120 },
  { code: 'LODGING_CITIES_100', name: 'Hundert Betten, hundert Städte', description: 'In 100 verschiedenen Städten übernachtet', category: 'collector', domain: 'lodging', icon: '🏙️', tier: 'diamond', requirement: 100, requirementType: 'lodging_cities_unique', points: 280 },

  // --- Explorer: continents, resolved by country ---
  { code: 'LODGING_CONTINENTS_2', name: 'Zwei Kontinente', description: 'Auf 2 Kontinenten übernachtet', category: 'explorer', domain: 'lodging', icon: '🌍', tier: 'bronze', requirement: 2, requirementType: 'lodging_continents', points: 30 },
  { code: 'LODGING_CONTINENTS_4', name: 'Vier Kontinente', description: 'Auf 4 Kontinenten übernachtet', category: 'explorer', domain: 'lodging', icon: '🌏', tier: 'gold', requirement: 4, requirementType: 'lodging_continents', points: 110 },
  { code: 'LODGING_CONTINENTS_6', name: 'Sechs Kontinente', description: 'Auf 6 Kontinenten übernachtet', category: 'explorer', domain: 'lodging', icon: '🌎', tier: 'diamond', requirement: 6, requirementType: 'lodging_continents', points: 300 },

  // --- Elite: what the house was, and what it delivered ---
  { code: 'FIVE_STAR_10', name: 'Fünf Sterne', description: '10 Nächte in Fünf-Sterne-Häusern', category: 'elite', domain: 'lodging', icon: '⭐', tier: 'silver', requirement: 10, requirementType: 'lodging_five_star_nights', points: 60 },
  { code: 'FIVE_STAR_50', name: 'Gehobene Ansprüche', description: '50 Nächte in Fünf-Sterne-Häusern', category: 'elite', domain: 'lodging', icon: '⭐', tier: 'gold', requirement: 50, requirementType: 'lodging_five_star_nights', points: 140 },
  { code: 'PERFECT_STAY_1', name: 'Nichts zu beanstanden', description: 'Ein Aufenthalt mit 5 von 5 in allen vier Bewertungen', category: 'elite', domain: 'lodging', icon: '💯', tier: 'gold', requirement: 1, requirementType: 'lodging_perfect_stays', points: 90 },
  { code: 'PERFECT_STAY_10', name: 'Ein Händchen für Häuser', description: '10 Aufenthalte mit 5 von 5 in allen vier Bewertungen', category: 'elite', domain: 'lodging', icon: '💯', tier: 'platinum', requirement: 10, requirementType: 'lodging_perfect_stays', points: 200 },

  // --- Elite: programme status, counted the way programmes count it ---
  { code: 'PROGRAMME_YEAR_10', name: 'Auf dem Weg zum Status', description: '10 Nächte in einem Kalenderjahr unter einem Programm', category: 'elite', domain: 'lodging', icon: '🎫', tier: 'bronze', requirement: 10, requirementType: 'lodging_programme_year_nights', points: 40 },
  { code: 'PROGRAMME_YEAR_25', name: 'Statusjäger', description: '25 Nächte in einem Kalenderjahr unter einem Programm', category: 'elite', domain: 'lodging', icon: '🎫', tier: 'silver', requirement: 25, requirementType: 'lodging_programme_year_nights', points: 80 },
  { code: 'PROGRAMME_YEAR_50', name: 'Oberste Stufe', description: '50 Nächte in einem Kalenderjahr unter einem Programm', category: 'elite', domain: 'lodging', icon: '🎫', tier: 'gold', requirement: 50, requirementType: 'lodging_programme_year_nights', points: 160 },

  // --- Special: how long away, and how far north ---
  { code: 'AWAY_STREAK_14', name: 'Zwei Wochen ohne eigenes Bett', description: '14 Nächte am Stück auswärts', category: 'special', domain: 'lodging', icon: '🎒', tier: 'bronze', requirement: 14, requirementType: 'lodging_streak_nights', points: 40 },
  { code: 'AWAY_STREAK_30', name: 'Heimatlos', description: '30 Nächte am Stück auswärts', category: 'special', domain: 'lodging', icon: '🎒', tier: 'gold', requirement: 30, requirementType: 'lodging_streak_nights', points: 120 },
  { code: 'AWAY_STREAK_90', name: 'Adresse: unterwegs', description: '90 Nächte am Stück auswärts', category: 'special', domain: 'lodging', icon: '🎒', tier: 'diamond', requirement: 90, requirementType: 'lodging_streak_nights', points: 300 },

  { code: 'AWAY_SHARE_25', name: 'Ein Viertel des Jahres fort', description: 'In einem Jahr an 25 % aller Tage auswärts geschlafen', category: 'special', domain: 'lodging', icon: '📅', tier: 'silver', requirement: 25, requirementType: 'lodging_away_share_pct', points: 90 },
  { code: 'AWAY_SHARE_50', name: 'Mehr fort als da', description: 'In einem Jahr an über 50 % aller Tage auswärts geschlafen', category: 'special', domain: 'lodging', icon: '📅', tier: 'diamond', requirement: 50, requirementType: 'lodging_away_share_pct', points: 260 },

  { code: 'NORTHERN_LODGING_60', name: 'Hoher Norden', description: 'Nördlich des 60. Breitengrads übernachtet', category: 'special', domain: 'lodging', icon: '🧭', tier: 'silver', requirement: 60, requirementType: 'lodging_northern_lat', points: 70 },
  { code: 'NORTHERN_LODGING_66', name: 'Jenseits des Polarkreises', description: 'Nördlich des Polarkreises übernachtet', category: 'special', domain: 'lodging', icon: '❄️', tier: 'gold', requirement: 66, requirementType: 'lodging_northern_lat', points: 150 },

  { code: 'ALL_INCLUSIVE_14', name: 'Bändchen am Handgelenk', description: '14 Nächte mit All-inclusive-Verpflegung', category: 'special', domain: 'lodging', icon: '🍹', tier: 'bronze', requirement: 14, requirementType: 'lodging_all_inclusive_nights', points: 40 },

  // --- Kurios ---
  { code: 'ONE_NIGHTERS_10', name: 'Immer nur eine Nacht', description: '10 Aufenthalte von genau einer Nacht', category: 'kurios', domain: 'lodging', icon: '🌗', tier: 'bronze', requirement: 10, requirementType: 'lodging_one_night_stays', points: 35 },
  { code: 'ONE_NIGHTERS_50', name: 'Der ewige Zwischenstopp', description: '50 Aufenthalte von genau einer Nacht', category: 'kurios', domain: 'lodging', icon: '🌗', tier: 'gold', requirement: 50, requirementType: 'lodging_one_night_stays', points: 120 },
  { code: 'INDEPENDENT_50', name: 'Kein Kettenmensch', description: '50 Nächte in Häusern ohne Kette', category: 'kurios', domain: 'lodging', icon: '🏡', tier: 'silver', requirement: 50, requirementType: 'lodging_independent_nights', points: 70 },
  { code: 'INDEPENDENT_200', name: 'Inhabergeführt', description: '200 Nächte in Häusern ohne Kette', category: 'kurios', domain: 'lodging', icon: '🏡', tier: 'gold', requirement: 200, requirementType: 'lodging_independent_nights', points: 160 },

  // --- Survivor / planner: the log itself ---
  { code: 'ENDURED_STAY_1', name: 'Durchgehalten', description: 'Einen Aufenthalt mit 2 Sternen oder schlechter bewertet', category: 'survivor', domain: 'lodging', icon: '😬', tier: 'bronze', requirement: 1, requirementType: 'lodging_endured_stays', points: 25 },
  { code: 'ENDURED_STAY_10', name: 'Hart im Nehmen', description: '10 Aufenthalte mit 2 Sternen oder schlechter bewertet', category: 'survivor', domain: 'lodging', icon: '😬', tier: 'gold', requirement: 10, requirementType: 'lodging_endured_stays', points: 100 },
  { code: 'RATED_STAYS_25', name: 'Fleißig bewertet', description: '25 Aufenthalte bewertet', category: 'planner', domain: 'lodging', icon: '📝', tier: 'bronze', requirement: 25, requirementType: 'lodging_rated_stays', points: 40 },
  { code: 'RATED_STAYS_100', name: 'Der eigene Hotelführer', description: '100 Aufenthalte bewertet', category: 'planner', domain: 'lodging', icon: '📝', tier: 'gold', requirement: 100, requirementType: 'lodging_rated_stays', points: 140 },

  // --- Cross-domain ---
  { code: 'DOCUMENTED_TRIP_1', name: 'Lückenlos festgehalten', description: 'Eine Reise mit Anreise, Unterkunft, Tagebuch und Fotos', category: 'planner', domain: 'shared', icon: '📔', tier: 'silver', requirement: 1, requirementType: 'trips_fully_documented', points: 70 },
  { code: 'DOCUMENTED_TRIP_10', name: 'Chronist', description: '10 Reisen mit Anreise, Unterkunft, Tagebuch und Fotos', category: 'planner', domain: 'shared', icon: '📔', tier: 'gold', requirement: 10, requirementType: 'trips_fully_documented', points: 200 },
];
