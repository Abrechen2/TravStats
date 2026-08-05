/**
 * The airport importer never writes a timezone — it only lands rows from the
 * OurAirports CSV. Every timezone in the catalogue comes from this backfill,
 * which derives one from the coordinates via geo-tz. That makes it the single
 * point where "the times TravStats displays are airport-local" is decided, and
 * it had no test at all.
 */
jest.mock('../db', () => ({
  prisma: {
    airport: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { prisma } from '../db';
import { backfillAirportTimezones } from '../services/airportLookup';

const findMany = prisma.airport.findMany as unknown as jest.Mock;
const update = prisma.airport.update as unknown as jest.Mock;

describe('backfillAirportTimezones', () => {
  beforeEach(() => {
    findMany.mockReset();
    update.mockReset();
    update.mockResolvedValue({});
  });

  it('derives the timezone from coordinates for every row missing one', async () => {
    findMany.mockResolvedValue([
      { id: 1, iata: 'JFK', icao: 'KJFK', lat: 40.6398, lon: -73.7789 },
      { id: 2, iata: 'BCN', icao: 'LEBL', lat: 41.2971, lon: 2.0785 },
      { id: 3, iata: 'HND', icao: 'RJTT', lat: 35.5523, lon: 139.78 },
    ]);

    await expect(backfillAirportTimezones()).resolves.toBe(3);

    const written = update.mock.calls.map((c) => [c[0].where.id, c[0].data.timezone]);
    expect(written).toEqual([
      [1, 'America/New_York'],
      [2, 'Europe/Madrid'],
      [3, 'Asia/Tokyo'],
    ]);
  });

  it('only looks at rows whose timezone is null', async () => {
    findMany.mockResolvedValue([]);
    await backfillAirportTimezones();
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { timezone: null } });
  });

  it('writes nothing and reports zero when the catalogue is already complete', async () => {
    findMany.mockResolvedValue([]);
    await expect(backfillAirportTimezones()).resolves.toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('resolves open ocean to an Etc/GMT offset zone rather than giving up', async () => {
    // Worth pinning: geo-tz covers the whole globe, so a sea coordinate does
    // NOT fall into the skip branch below — it yields a real, usable zone.
    findMany.mockResolvedValue([{ id: 1, iata: null, icao: null, lat: 0, lon: -140 }]);
    await expect(backfillAirportTimezones()).resolves.toBe(1);
    expect(update.mock.calls[0][0].data.timezone).toBe('Etc/GMT+9');
  });

  /**
   * The only way to reach the skip branch is a coordinate geo-tz rejects
   * outright — deriveTimezone swallows the throw and returns null. Such a row
   * must be left alone rather than written with a bogus zone: a wrong timezone
   * is worse than a missing one, because the display layer can mark a missing
   * one as UTC and cannot know a wrong one is wrong.
   */
  it('skips a row with impossible coordinates, and keeps going', async () => {
    findMany.mockResolvedValue([
      { id: 1, iata: null, icao: null, lat: 999, lon: 999 },
      { id: 2, iata: 'BCN', icao: 'LEBL', lat: 41.2971, lon: 2.0785 },
    ]);

    await expect(backfillAirportTimezones()).resolves.toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({
      where: { id: 2 },
      data: { timezone: 'Europe/Madrid' },
    });
  });
});
