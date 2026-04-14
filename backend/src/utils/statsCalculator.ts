/**
 * Statistics calculator — barrel re-export.
 *
 * The actual implementations live in the stats/ subdirectory:
 *   - stats/types.ts        — shared interfaces (FlightData, FunStats, BusinessStats, UniqueStats)
 *   - stats/funStats.ts     — calculateFunStats
 *   - stats/businessStats.ts — calculateBusinessStats
 *   - stats/uniqueStats.ts  — calculateUniqueStats + helpers
 *
 * This file re-exports everything so that existing imports from
 * '../utils/statsCalculator' continue to work unchanged.
 */

export type { FlightData, FunStats, BusinessStats, UniqueStats } from './stats/types';
export type { AirportStats } from './stats/airportStats';
export { calculateFunStats } from './stats/funStats';
export { calculateBusinessStats } from './stats/businessStats';
export { calculateUniqueStats } from './stats/uniqueStats';
export { calculateAirportStats } from './stats/airportStats';
