/**
 * A round trip needs one leg in each direction, so a pair of airports yields
 * as many round trips as its THINNER direction allows.
 *
 * The previous count added up every leg that had any counterpart and halved
 * the sum. Three FRA->LHR against one LHR->FRA gave (3+1)/2 = 2, while only
 * one round trip exists — the other two outbound legs have nothing to pair
 * with. The label says "komplette Hin- und Rückflüge".
 */
import { calculateUniqueStats } from '../uniqueStats';
import type { FlightData } from '../types';

function leg(dep: string, arr: string, day: number): FlightData {
  return {
    id: `${dep}-${arr}-${day}`,
    depIata: dep,
    arrIata: arr,
    depIcao: null,
    arrIcao: null,
    depLat: 50,
    depLon: 8,
    arrLat: 51,
    arrLon: 0,
    departureTime: new Date(`2024-05-${String(day).padStart(2, '0')}T08:00:00Z`),
    arrivalTime: new Date(`2024-05-${String(day).padStart(2, '0')}T10:00:00Z`),
    status: 'flown',
  } as unknown as FlightData;
}

describe('round trips are limited by the thinner direction', () => {
  it('counts one round trip for three flights out and one back', async () => {
    const stats = await calculateUniqueStats([
      leg('FRA', 'LHR', 1),
      leg('FRA', 'LHR', 3),
      leg('FRA', 'LHR', 5),
      leg('LHR', 'FRA', 6),
    ]);

    expect(stats.roundTripMaster).toBe(1);
  });

  it('counts two when both directions were flown twice', async () => {
    const stats = await calculateUniqueStats([
      leg('FRA', 'LHR', 1),
      leg('LHR', 'FRA', 2),
      leg('FRA', 'LHR', 3),
      leg('LHR', 'FRA', 4),
    ]);

    expect(stats.roundTripMaster).toBe(2);
  });

  it('counts none when a route was only ever flown one way', async () => {
    const stats = await calculateUniqueStats([leg('FRA', 'LHR', 1), leg('LHR', 'JFK', 2)]);

    expect(stats.roundTripMaster).toBe(0);
  });

  it('adds up independent pairs without letting one pay for the other', async () => {
    const stats = await calculateUniqueStats([
      leg('FRA', 'LHR', 1),
      leg('LHR', 'FRA', 2),
      leg('MUC', 'CDG', 3),
      leg('CDG', 'MUC', 4),
    ]);

    expect(stats.roundTripMaster).toBe(2);
  });
});
