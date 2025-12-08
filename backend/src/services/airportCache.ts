/**
 * In-memory cache for airport lookups
 * Reduces database queries for frequently accessed airports
 */

import NodeCache from 'node-cache';
import { prisma } from '../db';
import logger from '../utils/logger';
import type { AirportData } from './airportLookup';

// Cache configuration: 1 hour TTL, check for expired entries every 5 minutes
const cache = new NodeCache({
  stdTTL: 60 * 60, // 1 hour
  checkperiod: 5 * 60, // Check for expired entries every 5 minutes
  useClones: false, // Better performance, but be careful with mutations
});

// Cache key generator
function getCacheKey(code: string): string {
  return `airport:${code.toUpperCase()}`;
}

/**
 * Get airport from cache or database
 * @param code IATA or ICAO code
 * @returns Airport data or null if not found
 */
export async function getCachedAirport(code: string): Promise<AirportData | null> {
  const upperCode = code.toUpperCase();
  const cacheKey = getCacheKey(upperCode);

  // Try cache first
  const cached = cache.get<AirportData>(cacheKey);
  if (cached) {
    logger.debug({
      operation: 'airport_cache_hit',
      message: `Airport ${code} found in cache`,
      context: { code },
    });
    return cached;
  }

  // Cache miss - query database
  logger.debug({
    operation: 'airport_cache_miss',
    message: `Airport ${code} not in cache, querying database`,
    context: { code },
  });

  const airport = await prisma.airport.findFirst({
    where: {
      OR: [
        { iata: upperCode },
        { icao: upperCode },
      ],
    },
  });

  if (!airport) {
    // Cache null result for shorter time to avoid repeated DB queries for non-existent airports
    cache.set(cacheKey, null, 5 * 60); // 5 minutes
    return null;
  }

  const airportData: AirportData = {
    iata: airport.iata,
    icao: airport.icao,
    name: airport.name,
    city: airport.city,
    country: airport.country,
    lat: airport.lat,
    lon: airport.lon,
    altitude: airport.altitude,
    timezone: airport.timezone || null,
  };

  // Store in cache
  cache.set(cacheKey, airportData);
  return airportData;
}

/**
 * Get multiple airports by codes (batch lookup)
 * @param codes Array of IATA or ICAO codes
 * @returns Map of code -> AirportData
 */
export async function getCachedAirports(codes: string[]): Promise<Map<string, AirportData>> {
  const result = new Map<string, AirportData>();
  const codesToFetch: string[] = [];

  // Check cache for each code
  for (const code of codes) {
    const upperCode = code.toUpperCase();
    const cacheKey = getCacheKey(upperCode);
    const cached = cache.get<AirportData>(cacheKey);

    if (cached) {
      result.set(upperCode, cached);
    } else {
      codesToFetch.push(upperCode);
    }
  }

  // Batch fetch missing airports from database
  if (codesToFetch.length > 0) {
    logger.debug({
      operation: 'airport_cache_batch_fetch',
      message: `Batch fetching ${codesToFetch.length} airports from database`,
      context: { count: codesToFetch.length },
    });

    const airports = await prisma.airport.findMany({
      where: {
        OR: [
          { iata: { in: codesToFetch } },
          { icao: { in: codesToFetch } },
        ],
      },
    });

    // Store in cache and result map
    for (const airport of airports) {
      const airportData: AirportData = {
        iata: airport.iata,
        icao: airport.icao,
        name: airport.name,
        city: airport.city,
        country: airport.country,
        lat: airport.lat,
        lon: airport.lon,
        altitude: airport.altitude,
        timezone: airport.timezone || null,
      };

      // Cache by both IATA and ICAO if available
      if (airport.iata) {
        const iataKey = getCacheKey(airport.iata);
        cache.set(iataKey, airportData);
        result.set(airport.iata, airportData);
      }
      if (airport.icao) {
        const icaoKey = getCacheKey(airport.icao);
        cache.set(icaoKey, airportData);
        result.set(airport.icao, airportData);
      }
    }

    // Cache null results for codes not found
    const foundCodes = new Set<string>();
    airports.forEach(a => {
      if (a.iata) foundCodes.add(a.iata);
      if (a.icao) foundCodes.add(a.icao);
    });

    for (const code of codesToFetch) {
      if (!foundCodes.has(code) && !result.has(code)) {
        const cacheKey = getCacheKey(code);
        cache.set(cacheKey, null, 5 * 60); // 5 minutes for null results
      }
    }
  }

  return result;
}

/**
 * Invalidate cache for a specific airport
 * @param code IATA or ICAO code
 */
export function invalidateAirportCache(code: string): void {
  const upperCode = code.toUpperCase();
  const cacheKey = getCacheKey(upperCode);
  cache.del(cacheKey);
  logger.debug({
    operation: 'airport_cache_invalidate',
    message: `Invalidated cache for airport ${code}`,
    context: { code },
  });
}

/**
 * Clear all airport cache
 */
export function clearAirportCache(): void {
  const keys = cache.keys().filter(key => key.startsWith('airport:'));
  cache.del(keys);
  logger.info({
    operation: 'airport_cache_clear',
    message: `Cleared ${keys.length} airport cache entries`,
    context: { count: keys.length },
  });
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { hits: number; misses: number; keys: number } {
  const stats = cache.getStats();
  const airportKeys = cache.keys().filter(key => key.startsWith('airport:')).length;
  return {
    hits: stats.hits,
    misses: stats.misses,
    keys: airportKeys,
  };
}






