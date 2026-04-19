// Achievement seed definitions — Part C
// Cruise-domain achievements (27) + cross-domain shared achievements (5).
// Part of the multi-domain refactor — requirement checkers for these types
// land in a follow-up commit (Part B of Phase 8).

import type { AchievementDefinition } from '../achievements';

export const seedsPartC: AchievementDefinition[] = [
  // Cruise count
  { code: 'FIRST_CRUISE', name: 'Leinen los', description: 'Erste Kreuzfahrt erledigt', category: 'explorer', domain: 'cruise', icon: '🚢', tier: 'bronze', requirement: 1, requirementType: 'cruises_count', points: 15 },
  { code: 'SEA_EXPLORER_5', name: 'Sea Explorer', description: '5 Kreuzfahrten', category: 'explorer', domain: 'cruise', icon: '🚢', tier: 'silver', requirement: 5, requirementType: 'cruises_count', points: 35 },
  { code: 'CRUISE_ENTHUSIAST_10', name: 'Cruise Enthusiast', description: '10 Kreuzfahrten', category: 'explorer', domain: 'cruise', icon: '🚢', tier: 'gold', requirement: 10, requirementType: 'cruises_count', points: 60 },
  { code: 'SEVEN_SEAS_25', name: 'Seven Seas', description: '25 Kreuzfahrten', category: 'explorer', domain: 'cruise', icon: '🌊', tier: 'platinum', requirement: 25, requirementType: 'cruises_count', points: 120 },
  { code: 'NEPTUNES_FAVORITE_50', name: "Neptune's Favorite", description: '50 Kreuzfahrten', category: 'explorer', domain: 'cruise', icon: '🔱', tier: 'diamond', requirement: 50, requirementType: 'cruises_count', points: 250 },

  // Ports
  { code: 'PORT_HOPPER_5', name: 'Port Hopper', description: '5 Häfen besucht', category: 'explorer', domain: 'cruise', icon: '⚓', tier: 'bronze', requirement: 5, requirementType: 'cruise_ports_unique', points: 15 },
  { code: 'HARBOR_TOUR_25', name: 'Harbor Tour', description: '25 Häfen besucht', category: 'explorer', domain: 'cruise', icon: '⚓', tier: 'silver', requirement: 25, requirementType: 'cruise_ports_unique', points: 40 },
  { code: 'HARBOR_MASTER_50', name: 'Harbor Master', description: '50 Häfen besucht', category: 'explorer', domain: 'cruise', icon: '🏴‍☠️', tier: 'gold', requirement: 50, requirementType: 'cruise_ports_unique', points: 80 },
  { code: 'MEGA_CRUISE_10', name: 'Mega Cruise', description: '10+ Häfen in einer Kreuzfahrt', category: 'special', domain: 'cruise', icon: '🗺️', tier: 'platinum', requirement: 10, requirementType: 'cruise_ports_single', points: 100 },

  // Ships
  { code: 'CAPTAINS_LOG_1', name: "Captain's Log", description: 'Erstes Schiff', category: 'collector', domain: 'cruise', icon: '🧭', tier: 'bronze', requirement: 1, requirementType: 'cruise_ships_unique', points: 10 },
  { code: 'FLEET_SAMPLER_5', name: 'Fleet Sampler', description: '5 verschiedene Schiffe', category: 'collector', domain: 'cruise', icon: '🧭', tier: 'silver', requirement: 5, requirementType: 'cruise_ships_unique', points: 30 },
  { code: 'NAVAL_CURATOR_15', name: 'Naval Curator', description: '15 verschiedene Schiffe', category: 'collector', domain: 'cruise', icon: '🧭', tier: 'gold', requirement: 15, requirementType: 'cruise_ships_unique', points: 75 },

  // Cruise line
  { code: 'LOYAL_SAILOR_3', name: 'Loyal Sailor', description: '3 Kreuzfahrten mit derselben Reederei', category: 'collector', domain: 'cruise', icon: '🎖️', tier: 'bronze', requirement: 3, requirementType: 'cruise_line_loyalty', points: 15 },
  { code: 'LINE_HOPPER_5', name: 'Line Hopper', description: '5 verschiedene Reedereien', category: 'collector', domain: 'cruise', icon: '🎖️', tier: 'silver', requirement: 5, requirementType: 'cruise_lines_unique', points: 40 },
  { code: 'CARNIVAL_COLLECTOR', name: 'Carnival Collector', description: 'Alle Carnival-Marken befahren', category: 'collector', domain: 'cruise', icon: '🎠', tier: 'gold', requirement: 1, requirementType: 'carnival_brands_all', points: 90, isHidden: true },

  // Sea days
  { code: 'SEA_LEGS_1', name: 'Sea Legs', description: 'Erster Seetag', category: 'special', domain: 'cruise', icon: '🌊', tier: 'bronze', requirement: 1, requirementType: 'sea_days', points: 10 },
  { code: 'SALT_DOG_30', name: 'Salt Dog', description: '30 Seetage gesamt', category: 'special', domain: 'cruise', icon: '🌊', tier: 'silver', requirement: 30, requirementType: 'sea_days', points: 40 },
  { code: 'TRANSATLANTIC_7', name: 'Transatlantic', description: '7+ aufeinanderfolgende Seetage', category: 'special', domain: 'cruise', icon: '🌊', tier: 'gold', requirement: 7, requirementType: 'sea_days_streak', points: 80 },

  // Regions
  { code: 'CRUISE_MEDITERRANEAN', name: 'Mediterraner Urlauber', description: 'Mittelmeer besucht', category: 'explorer', domain: 'cruise', icon: '🌞', tier: 'bronze', requirement: 1, requirementType: 'cruise_region_mediterranean', points: 15 },
  { code: 'CRUISE_CARIBBEAN', name: 'Karibikfahrer', description: 'Karibik besucht', category: 'explorer', domain: 'cruise', icon: '🏝️', tier: 'bronze', requirement: 1, requirementType: 'cruise_region_caribbean', points: 15 },
  { code: 'CRUISE_BALTIC_OR_FJORDS', name: 'Nordische Route', description: 'Ostsee oder Fjorde', category: 'explorer', domain: 'cruise', icon: '❄️', tier: 'silver', requirement: 1, requirementType: 'cruise_region_baltic_or_fjords', points: 30 },
  { code: 'CRUISE_CANAL_TRANSIT', name: 'Canal Transit', description: 'Panama- oder Suezkanal', category: 'special', domain: 'cruise', icon: '🛶', tier: 'gold', requirement: 1, requirementType: 'cruise_canal_transit', points: 80 },
  { code: 'CRUISE_POLAR_EXPLORER', name: 'Polar Explorer', description: 'Antarktis oder Nordwestpassage', category: 'special', domain: 'cruise', icon: '🧊', tier: 'platinum', requirement: 1, requirementType: 'cruise_polar', points: 150 },

  // Cabin
  { code: 'BALCONY_FIRST', name: 'Erster Balkon', description: 'Erste Balkonkabine', category: 'special', domain: 'cruise', icon: '🪟', tier: 'bronze', requirement: 1, requirementType: 'cruise_cabin_balcony', points: 10 },
  { code: 'SUITE_FIRST', name: 'Erste Suite', description: 'Erste Suite', category: 'special', domain: 'cruise', icon: '🛏️', tier: 'silver', requirement: 1, requirementType: 'cruise_cabin_suite', points: 25 },
  { code: 'TOP_DECK', name: 'Top Deck', description: 'Deck 12 oder höher', category: 'special', domain: 'cruise', icon: '⬆️', tier: 'gold', requirement: 12, requirementType: 'cruise_deck_min', points: 40 },

  // Special
  { code: 'BIRTHDAY_AT_SEA', name: 'Birthday at Sea', description: 'Geburtstag auf See', category: 'special', domain: 'cruise', icon: '🎂', tier: 'silver', requirement: 1, requirementType: 'cruise_birthday_at_sea', points: 30 },
  { code: 'NEW_YEARS_AT_SEA', name: "New Year's at Sea", description: 'Silvester auf See', category: 'special', domain: 'cruise', icon: '🎇', tier: 'gold', requirement: 1, requirementType: 'cruise_new_years_at_sea', points: 60 },
  { code: 'COLD_WATER_CRUISER', name: 'Cold Water Cruiser', description: 'Island, Alaska oder Antarktis', category: 'special', domain: 'cruise', icon: '🥶', tier: 'silver', requirement: 1, requirementType: 'cruise_cold_water', points: 30 },

  // Shared (domain: 'shared') — cross-domain achievements
  { code: 'WORLD_TRAVELER', name: 'World Traveler', description: '25 Länder (alle Bereiche)', category: 'explorer', domain: 'shared', icon: '🌍', tier: 'silver', requirement: 25, requirementType: 'countries', points: 50 },
  { code: 'GLOBE_TREKKER', name: 'Globe Trekker', description: '50 Länder (alle Bereiche)', category: 'explorer', domain: 'shared', icon: '🌍', tier: 'gold', requirement: 50, requirementType: 'countries', points: 100 },
  { code: 'CENTURION', name: 'Centurion', description: '100 Länder (alle Bereiche)', category: 'explorer', domain: 'shared', icon: '🌍', tier: 'diamond', requirement: 100, requirementType: 'countries', points: 300 },
  { code: 'SEVEN_CONTINENTS_CLUB', name: 'Seven Continents Club', description: 'Alle 7 Kontinente', category: 'explorer', domain: 'shared', icon: '🌐', tier: 'platinum', requirement: 7, requirementType: 'continents', points: 200 },
  { code: 'FLY_AND_SAIL', name: 'Fly & Sail', description: 'Trip mit Flug UND Kreuzfahrt', category: 'special', domain: 'shared', icon: '✈️🚢', tier: 'gold', requirement: 1, requirementType: 'fly_and_sail_trip', points: 60 },
];
