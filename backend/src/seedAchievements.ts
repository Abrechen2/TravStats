import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AchievementDefinition {
  code: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  tier: string;
  requirement: number;
  requirementType: string;
  points: number;
  isHidden?: boolean;
}

const achievements: AchievementDefinition[] = [
  // EXPLORER CATEGORY - Visiting places
  {
    code: 'FIRST_FLIGHT',
    name: 'Taking Off',
    description: 'Complete your first flight',
    category: 'explorer',
    icon: '✈️',
    tier: 'bronze',
    requirement: 1,
    requirementType: 'flights_count',
    points: 10,
  },
  {
    code: 'FREQUENT_FLYER_10',
    name: 'Frequent Flyer',
    description: 'Complete 10 flights',
    category: 'explorer',
    icon: '🛫',
    tier: 'bronze',
    requirement: 10,
    requirementType: 'flights_count',
    points: 25,
  },
  {
    code: 'FREQUENT_FLYER_25',
    name: 'Sky Veteran',
    description: 'Complete 25 flights',
    category: 'explorer',
    icon: '🛫',
    tier: 'silver',
    requirement: 25,
    requirementType: 'flights_count',
    points: 50,
  },
  {
    code: 'FREQUENT_FLYER_50',
    name: 'Aviation Enthusiast',
    description: 'Complete 50 flights',
    category: 'explorer',
    icon: '✈️',
    tier: 'gold',
    requirement: 50,
    requirementType: 'flights_count',
    points: 100,
  },
  {
    code: 'FREQUENT_FLYER_100',
    name: 'Centurion',
    description: 'Complete 100 flights',
    category: 'explorer',
    icon: '🏆',
    tier: 'platinum',
    requirement: 100,
    requirementType: 'flights_count',
    points: 200,
  },
  {
    code: 'FREQUENT_FLYER_250',
    name: 'Sky Master',
    description: 'Complete 250 flights',
    category: 'explorer',
    icon: '👑',
    tier: 'diamond',
    requirement: 250,
    requirementType: 'flights_count',
    points: 500,
  },
  {
    code: 'FREQUENT_FLYER_500',
    name: 'Legend of the Skies',
    description: 'Complete 500 flights',
    category: 'explorer',
    icon: '💎',
    tier: 'diamond',
    requirement: 500,
    requirementType: 'flights_count',
    points: 1000,
  },

  // DISTANCE CATEGORY
  {
    code: 'DISTANCE_1000',
    name: 'First Thousand',
    description: 'Fly 1,000 km',
    category: 'distance',
    icon: '📏',
    tier: 'bronze',
    requirement: 1000,
    requirementType: 'distance_km',
    points: 15,
  },
  {
    code: 'DISTANCE_10000',
    name: 'Ten Thousand Club',
    description: 'Fly 10,000 km',
    category: 'distance',
    icon: '🌍',
    tier: 'silver',
    requirement: 10000,
    requirementType: 'distance_km',
    points: 50,
  },
  {
    code: 'DISTANCE_50000',
    name: 'Around the World',
    description: 'Fly 50,000 km (circumference of Earth)',
    category: 'distance',
    icon: '🌎',
    tier: 'gold',
    requirement: 50000,
    requirementType: 'distance_km',
    points: 150,
  },
  {
    code: 'DISTANCE_100000',
    name: 'Globe Trotter',
    description: 'Fly 100,000 km',
    category: 'distance',
    icon: '🌏',
    tier: 'platinum',
    requirement: 100000,
    requirementType: 'distance_km',
    points: 300,
  },
  {
    code: 'DISTANCE_250000',
    name: 'Distance Warrior',
    description: 'Fly 250,000 km',
    category: 'distance',
    icon: '🚀',
    tier: 'diamond',
    requirement: 250000,
    requirementType: 'distance_km',
    points: 750,
  },
  {
    code: 'DISTANCE_500000',
    name: 'Orbital Achievement',
    description: 'Fly 500,000 km',
    category: 'distance',
    icon: '🛰️',
    tier: 'diamond',
    requirement: 500000,
    requirementType: 'distance_km',
    points: 1500,
  },

  // COLLECTOR CATEGORY - Countries
  {
    code: 'COUNTRIES_5',
    name: 'Passport Starter',
    description: 'Visit 5 different countries',
    category: 'collector',
    icon: '🗺️',
    tier: 'bronze',
    requirement: 5,
    requirementType: 'countries',
    points: 20,
  },
  {
    code: 'COUNTRIES_10',
    name: 'International Traveler',
    description: 'Visit 10 different countries',
    category: 'collector',
    icon: '🌐',
    tier: 'silver',
    requirement: 10,
    requirementType: 'countries',
    points: 50,
  },
  {
    code: 'COUNTRIES_25',
    name: 'World Explorer',
    description: 'Visit 25 different countries',
    category: 'collector',
    icon: '🗺️',
    tier: 'gold',
    requirement: 25,
    requirementType: 'countries',
    points: 125,
  },
  {
    code: 'COUNTRIES_50',
    name: 'Global Citizen',
    description: 'Visit 50 different countries',
    category: 'collector',
    icon: '🌍',
    tier: 'platinum',
    requirement: 50,
    requirementType: 'countries',
    points: 300,
  },
  {
    code: 'COUNTRIES_100',
    name: 'Master of Nations',
    description: 'Visit 100 different countries',
    category: 'collector',
    icon: '👑',
    tier: 'diamond',
    requirement: 100,
    requirementType: 'countries',
    points: 1000,
  },

  // COLLECTOR CATEGORY - Airlines
  {
    code: 'AIRLINES_5',
    name: 'Airline Sampler',
    description: 'Fly with 5 different airlines',
    category: 'collector',
    icon: '🏢',
    tier: 'bronze',
    requirement: 5,
    requirementType: 'airlines',
    points: 15,
  },
  {
    code: 'AIRLINES_10',
    name: 'Airline Collector',
    description: 'Fly with 10 different airlines',
    category: 'collector',
    icon: '✈️',
    tier: 'silver',
    requirement: 10,
    requirementType: 'airlines',
    points: 40,
  },
  {
    code: 'AIRLINES_25',
    name: 'Airline Enthusiast',
    description: 'Fly with 25 different airlines',
    category: 'collector',
    icon: '🛫',
    tier: 'gold',
    requirement: 25,
    requirementType: 'airlines',
    points: 100,
  },
  {
    code: 'AIRLINES_50',
    name: 'Airline Master',
    description: 'Fly with 50 different airlines',
    category: 'collector',
    icon: '🏆',
    tier: 'platinum',
    requirement: 50,
    requirementType: 'airlines',
    points: 250,
  },

  // COLLECTOR CATEGORY - Airports
  {
    code: 'AIRPORTS_10',
    name: 'Airport Explorer',
    description: 'Visit 10 different airports',
    category: 'collector',
    icon: '🏢',
    tier: 'bronze',
    requirement: 10,
    requirementType: 'airports',
    points: 20,
  },
  {
    code: 'AIRPORTS_25',
    name: 'Terminal Hopper',
    description: 'Visit 25 different airports',
    category: 'collector',
    icon: '🏛️',
    tier: 'silver',
    requirement: 25,
    requirementType: 'airports',
    points: 50,
  },
  {
    code: 'AIRPORTS_50',
    name: 'Hub Master',
    description: 'Visit 50 different airports',
    category: 'collector',
    icon: '🏗️',
    tier: 'gold',
    requirement: 50,
    requirementType: 'airports',
    points: 125,
  },
  {
    code: 'AIRPORTS_100',
    name: 'Airport Connoisseur',
    description: 'Visit 100 different airports',
    category: 'collector',
    icon: '🎯',
    tier: 'platinum',
    requirement: 100,
    requirementType: 'airports',
    points: 300,
  },
  {
    code: 'AIRPORTS_200',
    name: 'Lord of Terminals',
    description: 'Visit 200 different airports',
    category: 'collector',
    icon: '👑',
    tier: 'diamond',
    requirement: 200,
    requirementType: 'airports',
    points: 750,
  },

  // COLLECTOR CATEGORY - Continents
  {
    code: 'CONTINENTS_3',
    name: 'Tri-Continental',
    description: 'Visit airports on 3 different continents',
    category: 'collector',
    icon: '🌏',
    tier: 'silver',
    requirement: 3,
    requirementType: 'continents',
    points: 50,
  },
  {
    code: 'CONTINENTS_5',
    name: 'Five Continents Club',
    description: 'Visit airports on 5 different continents',
    category: 'collector',
    icon: '🌍',
    tier: 'gold',
    requirement: 5,
    requirementType: 'continents',
    points: 150,
  },
  {
    code: 'CONTINENTS_7',
    name: 'Seven Continents Master',
    description: 'Visit airports on all 7 continents',
    category: 'collector',
    icon: '🌎',
    tier: 'diamond',
    requirement: 7,
    requirementType: 'continents',
    points: 500,
  },

  // ELITE CATEGORY - Aircraft types
  {
    code: 'AIRCRAFT_5',
    name: 'Aircraft Enthusiast',
    description: 'Fly on 5 different aircraft types',
    category: 'elite',
    icon: '🛩️',
    tier: 'bronze',
    requirement: 5,
    requirementType: 'aircraft_types',
    points: 20,
  },
  {
    code: 'AIRCRAFT_10',
    name: 'Fleet Specialist',
    description: 'Fly on 10 different aircraft types',
    category: 'elite',
    icon: '✈️',
    tier: 'silver',
    requirement: 10,
    requirementType: 'aircraft_types',
    points: 50,
  },
  {
    code: 'AIRCRAFT_25',
    name: 'Aviation Expert',
    description: 'Fly on 25 different aircraft types',
    category: 'elite',
    icon: '🛫',
    tier: 'gold',
    requirement: 25,
    requirementType: 'aircraft_types',
    points: 125,
  },
  {
    code: 'AIRCRAFT_50',
    name: 'Aircraft Master',
    description: 'Fly on 50 different aircraft types',
    category: 'elite',
    icon: '🏆',
    tier: 'platinum',
    requirement: 50,
    requirementType: 'aircraft_types',
    points: 300,
  },

  // ELITE CATEGORY - Long haul flights
  {
    code: 'LONG_HAUL_5000',
    name: 'Long Haul Rookie',
    description: 'Complete a flight over 5,000 km',
    category: 'elite',
    icon: '🌏',
    tier: 'silver',
    requirement: 5000,
    requirementType: 'single_flight_distance',
    points: 50,
  },
  {
    code: 'LONG_HAUL_10000',
    name: 'Intercontinental Pro',
    description: 'Complete a flight over 10,000 km',
    category: 'elite',
    icon: '🌍',
    tier: 'gold',
    requirement: 10000,
    requirementType: 'single_flight_distance',
    points: 150,
  },
  {
    code: 'LONG_HAUL_15000',
    name: 'Ultra Long Range',
    description: 'Complete a flight over 15,000 km',
    category: 'elite',
    icon: '🚀',
    tier: 'platinum',
    requirement: 15000,
    requirementType: 'single_flight_distance',
    points: 300,
  },

  // SPECIAL CATEGORY - Time based
  {
    code: 'NIGHT_OWL',
    name: 'Night Owl',
    description: 'Complete 10 flights departing between midnight and 6 AM',
    category: 'special',
    icon: '🦉',
    tier: 'silver',
    requirement: 10,
    requirementType: 'night_flights',
    points: 75,
  },
  {
    code: 'RED_EYE_MASTER',
    name: 'Red Eye Master',
    description: 'Complete 25 flights departing between midnight and 6 AM',
    category: 'special',
    icon: '🌙',
    tier: 'gold',
    requirement: 25,
    requirementType: 'night_flights',
    points: 150,
  },

  // SPECIAL CATEGORY - Streaks
  {
    code: 'WEEKEND_WARRIOR',
    name: 'Weekend Warrior',
    description: 'Complete 10 flights on weekends',
    category: 'special',
    icon: '🎉',
    tier: 'silver',
    requirement: 10,
    requirementType: 'weekend_flights',
    points: 50,
  },
  {
    code: 'MONTHLY_FLYER',
    name: 'Monthly Flyer',
    description: 'Complete at least one flight every month for 6 months',
    category: 'special',
    icon: '📅',
    tier: 'gold',
    requirement: 6,
    requirementType: 'consecutive_months',
    points: 200,
  },
  {
    code: 'YEARLY_COMMITMENT',
    name: 'Yearly Commitment',
    description: 'Complete at least one flight every month for 12 months',
    category: 'special',
    icon: '🗓️',
    tier: 'platinum',
    requirement: 12,
    requirementType: 'consecutive_months',
    points: 500,
  },

  // SPECIAL CATEGORY - Routes
  {
    code: 'FAVORITE_ROUTE',
    name: 'Favorite Route',
    description: 'Fly the same route 5 times',
    category: 'special',
    icon: '🔄',
    tier: 'bronze',
    requirement: 5,
    requirementType: 'same_route',
    points: 30,
  },
  {
    code: 'ROUTE_MASTER',
    name: 'Route Master',
    description: 'Fly the same route 10 times',
    category: 'special',
    icon: '🔁',
    tier: 'silver',
    requirement: 10,
    requirementType: 'same_route',
    points: 75,
  },
  {
    code: 'COMMUTER',
    name: 'Commuter',
    description: 'Fly the same route 25 times',
    category: 'special',
    icon: '💼',
    tier: 'gold',
    requirement: 25,
    requirementType: 'same_route',
    points: 200,
  },

  // SPECIAL CATEGORY - Speed
  {
    code: 'BUSY_MONTH',
    name: 'Busy Month',
    description: 'Complete 10 flights in a single month',
    category: 'special',
    icon: '📆',
    tier: 'silver',
    requirement: 10,
    requirementType: 'flights_per_month',
    points: 100,
  },
  {
    code: 'BUSY_YEAR',
    name: 'Busy Year',
    description: 'Complete 50 flights in a single year',
    category: 'special',
    icon: '📊',
    tier: 'gold',
    requirement: 50,
    requirementType: 'flights_per_year',
    points: 250,
  },

  // ELITE CATEGORY - First class experiences
  {
    code: 'TRANSCONTINENTAL',
    name: 'Transcontinental',
    description: 'Complete a flight crossing an ocean',
    category: 'elite',
    icon: '🌊',
    tier: 'gold',
    requirement: 1,
    requirementType: 'ocean_crossing',
    points: 100,
  },

  // SPECIAL CATEGORY - Hidden achievements
  {
    code: 'TIME_TRAVELER',
    name: 'Time Traveler',
    description: 'Arrive before you depart (crossing date line)',
    category: 'special',
    icon: '⏰',
    tier: 'gold',
    requirement: 1,
    requirementType: 'time_travel',
    points: 150,
    isHidden: true,
  },
  {
    code: 'POLAR_EXPLORER',
    name: 'Polar Explorer',
    description: 'Fly above the Arctic Circle (66.5°N)',
    category: 'special',
    icon: '🧊',
    tier: 'platinum',
    requirement: 1,
    requirementType: 'arctic_flight',
    points: 200,
    isHidden: true,
  },
  {
    code: 'EQUATOR_CROSSING',
    name: 'Equator Crossing',
    description: 'Complete a flight crossing the equator',
    category: 'special',
    icon: '🌍',
    tier: 'silver',
    requirement: 1,
    requirementType: 'equator_crossing',
    points: 75,
  },
  {
    code: 'YEAR_ROUND',
    name: 'Year-Round Flyer',
    description: 'Complete flights in all 4 seasons in a year',
    category: 'special',
    icon: '🍂',
    tier: 'gold',
    requirement: 4,
    requirementType: 'all_seasons',
    points: 150,
  },

  // ELITE CATEGORY - Specific airlines
  {
    code: 'AIRLINE_LOYAL_10',
    name: 'Airline Loyalty',
    description: 'Complete 10 flights with the same airline',
    category: 'elite',
    icon: '💙',
    tier: 'bronze',
    requirement: 10,
    requirementType: 'airline_loyalty',
    points: 40,
  },
  {
    code: 'AIRLINE_LOYAL_25',
    name: 'Brand Ambassador',
    description: 'Complete 25 flights with the same airline',
    category: 'elite',
    icon: '❤️',
    tier: 'silver',
    requirement: 25,
    requirementType: 'airline_loyalty',
    points: 100,
  },
  {
    code: 'AIRLINE_LOYAL_50',
    name: 'Elite Member',
    description: 'Complete 50 flights with the same airline',
    category: 'elite',
    icon: '💎',
    tier: 'gold',
    requirement: 50,
    requirementType: 'airline_loyalty',
    points: 250,
  },

  // Additional diverse achievements
  {
    code: 'FLIGHT_TIME_100',
    name: 'Century Hours',
    description: 'Accumulate 100 hours of flight time',
    category: 'distance',
    icon: '⏱️',
    tier: 'silver',
    requirement: 100,
    requirementType: 'flight_hours',
    points: 100,
  },
  {
    code: 'FLIGHT_TIME_500',
    name: 'Sky Veteran Hours',
    description: 'Accumulate 500 hours of flight time',
    category: 'distance',
    icon: '⏰',
    tier: 'gold',
    requirement: 500,
    requirementType: 'flight_hours',
    points: 300,
  },
  {
    code: 'FLIGHT_TIME_1000',
    name: 'Thousand Hour Club',
    description: 'Accumulate 1,000 hours of flight time',
    category: 'distance',
    icon: '⌚',
    tier: 'platinum',
    requirement: 1000,
    requirementType: 'flight_hours',
    points: 750,
  },
];

async function seedAchievements() {
  console.log('🏆 Starting achievement seeding...');

  try {
    // Check if achievements already exist
    const existingCount = await prisma.achievement.count();

    if (existingCount === achievements.length) {
      console.log(`✅ Achievements already seeded (${existingCount} achievements)`);
      return;
    }

    if (existingCount > 0) {
      console.log(`⚠️  Found ${existingCount} existing achievements, updating...`);
    }

    // Upsert all achievements
    let created = 0;
    let updated = 0;

    for (const achievement of achievements) {
      // Check if achievement already exists
      const existing = await prisma.achievement.findUnique({
        where: { code: achievement.code },
      });

      await prisma.achievement.upsert({
        where: { code: achievement.code },
        update: {
          name: achievement.name,
          description: achievement.description,
          category: achievement.category,
          icon: achievement.icon,
          tier: achievement.tier,
          requirement: achievement.requirement,
          requirementType: achievement.requirementType,
          points: achievement.points,
          isHidden: achievement.isHidden || false,
        },
        create: achievement,
      });

      if (existing) {
        updated++;
      } else {
        created++;
      }
    }

    console.log(`✅ Processed ${achievements.length} achievements (${created} created, ${updated} updated)`);

    // Show summary by category
    const categoryCounts = achievements.reduce((acc, ach) => {
      acc[ach.category] = (acc[ach.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('\n📊 Achievements by category:');
    Object.entries(categoryCounts).forEach(([category, count]) => {
      console.log(`   ${category}: ${count}`);
    });

    console.log('\n✅ Achievement seeding completed successfully!');
  } catch (error) {
    console.error('❌ Error seeding achievements:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seedAchievements();
