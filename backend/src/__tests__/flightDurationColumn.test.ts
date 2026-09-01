/**
 * `flights.duration_minutes` — the persisted measurement (forgejo#45).
 *
 * Three things are pinned here, in order of how much they would cost to get
 * wrong:
 *
 *   1. The database's CASE expression and `tzAwareDurationMinutes` answer the
 *      same number for every combination of time-storage semantics. The rule
 *      now exists in two languages; a test is the only thing keeping them one
 *      rule.
 *   2. NULL keeps meaning "no duration", never zero — a DATE_ONLY row must
 *      still reach the estimate in `resolveFlightDuration` and never drag an
 *      average toward nothing (#106A / #268).
 *   3. The invalidation decision itself: a correction to an AIRPORT's timezone
 *      is not a write to any flight row, so the stored value must be one that
 *      such a correction cannot falsify. It is — because the only rows whose
 *      duration depends on the catalogue store nothing and are derived on read.
 */
import { prisma } from '../db';
import { tzAwareDurationMinutes, type FlightTimeSemantics } from '../utils/timezone';
import {
  measuredDurationMinutes,
  isCatalogueDerivedDuration,
} from '../utils/flightDurationColumn';
import { resolveFlightDuration } from '../shared/flightDuration';
import { getCachedAirport, invalidateAirportCache } from '../services/airportCache';

const DEP = new Date('2026-03-01T08:00:00Z');
const ARR = new Date('2026-03-01T14:30:00Z'); // 390 minutes apart

const SEMANTICS: FlightTimeSemantics[] = ['UTC', 'UNKNOWN', 'DATE_ONLY', 'LEGACY_FAKE_UTC'];

// Two zones with a real offset between them, so a legacy re-interpretation
// produces a visibly different number from the naïve difference.
const DEP_TZ = 'Australia/Sydney';
const ARR_TZ = 'Asia/Dubai';

/** SYD → DXB. Required columns; only the DATE_ONLY case reads them. */
const COORDS = { depLat: -33.95, depLon: 151.18, arrLat: 25.25, arrLon: 55.36 };

const SELECT = {
  id: true,
  departureTime: true,
  arrivalTime: true,
  depTimeSemantics: true,
  arrTimeSemantics: true,
  durationMinutes: true,
} as const;

describe('flights.duration_minutes', () => {
  let userId: string;
  const flightIds: string[] = [];

  const seed = async (data: {
    departureTime?: Date | null;
    arrivalTime?: Date | null;
    depTimeSemantics?: string;
    arrTimeSemantics?: string;
    depIata?: string;
    arrIata?: string;
  }): Promise<string> => {
    const flight = await prisma.flight.create({
      data: {
        userId,
        status: 'flown',
        departureTime: data.departureTime === undefined ? DEP : data.departureTime,
        arrivalTime: data.arrivalTime === undefined ? ARR : data.arrivalTime,
        depTimeSemantics: data.depTimeSemantics ?? 'UTC',
        arrTimeSemantics: data.arrTimeSemantics ?? 'UTC',
        depIata: data.depIata,
        arrIata: data.arrIata,
        ...COORDS,
      },
      select: { id: true },
    });
    flightIds.push(flight.id);
    return flight.id;
  };

  const read = async (id: string) =>
    prisma.flight.findUniqueOrThrow({ where: { id }, select: SELECT });

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: 'test-duration-column-' + Date.now(), passwordHash: 'x' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { id: { in: flightIds } } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('is populated on create although no writer sets it', async () => {
    const id = await seed({});
    const row = await read(id);
    expect(row.durationMinutes).toBe(390);
  });

  it('follows an update that moves the times', async () => {
    const id = await seed({});
    await prisma.flight.update({
      where: { id },
      // A plain update touching only the times — nothing recomputes a duration
      // here, which is the entire point of letting the database own it.
      data: { arrivalTime: new Date('2026-03-01T18:00:00Z') },
    });
    expect((await read(id)).durationMinutes).toBe(600);
  });

  it('empties itself again when an update removes a time', async () => {
    const id = await seed({});
    await prisma.flight.update({ where: { id }, data: { arrivalTime: null } });
    expect((await read(id)).durationMinutes).toBeNull();
  });

  it('cannot be written by hand — Postgres owns it', async () => {
    await expect(
      prisma.flight.create({
        data: {
          userId,
          status: 'flown',
          departureTime: DEP,
          arrivalTime: ARR,
          ...COORDS,
          durationMinutes: 1,
        },
      }),
    ).rejects.toThrow();
  });

  it('stores NULL for a DATE_ONLY row, and the reader answers null — not zero', async () => {
    // #106A: the 12:00 placeholder is not evidence. Zero minutes and "no
    // duration" are different facts and an average must not confuse them.
    const id = await seed({ depTimeSemantics: 'DATE_ONLY', arrTimeSemantics: 'DATE_ONLY' });
    const row = await read(id);
    expect(row.durationMinutes).toBeNull();
    expect(measuredDurationMinutes(row, DEP_TZ, ARR_TZ)).toBeNull();

    // With no coordinates there is nothing to estimate from either, so the
    // whole chain still answers "no answer" rather than a confident 0.
    expect(
      resolveFlightDuration({
        measuredMinutes: measuredDurationMinutes(row, DEP_TZ, ARR_TZ),
        depLat: null,
        depLon: null,
        arrLat: null,
        arrLon: null,
      }),
    ).toBeNull();

    // With coordinates it reaches the estimate — and says so.
    const estimated = resolveFlightDuration({
      measuredMinutes: measuredDurationMinutes(row, DEP_TZ, ARR_TZ),
      depLat: -33.95,
      depLon: 151.18,
      arrLat: 25.25,
      arrLon: 55.36,
    });
    expect(estimated?.estimated).toBe(true);
    expect(estimated?.minutes).toBeGreaterThan(0);
  });

  it('stores nothing for a LEGACY_FAKE_UTC pair and derives that row on read', async () => {
    const id = await seed({
      depTimeSemantics: 'LEGACY_FAKE_UTC',
      arrTimeSemantics: 'LEGACY_FAKE_UTC',
    });
    const row = await read(id);
    expect(isCatalogueDerivedDuration(row.depTimeSemantics, row.arrTimeSemantics)).toBe(true);
    expect(row.durationMinutes).toBeNull();

    // Derived, and NOT the naïve 390: the wall-clock pair is re-read through
    // the two airport clocks, which is exactly why it cannot be stored.
    const derived = measuredDurationMinutes(row, DEP_TZ, ARR_TZ);
    expect(derived).toBe(
      tzAwareDurationMinutes(DEP, ARR, DEP_TZ, ARR_TZ, 'LEGACY_FAKE_UTC', 'LEGACY_FAKE_UTC'),
    );
    expect(derived).not.toBe(390);
  });

  it('keeps sub-minute precision, so a sum lands where it lands today', async () => {
    // Float, not Int: the column is byte-for-byte what tzAwareDurationMinutes
    // returns. Rounding belongs at the API edge, not in storage.
    const dep = new Date('2026-03-01T08:00:00.000Z');
    const arr = new Date('2026-03-01T08:30:30.000Z');
    const id = await seed({ departureTime: dep, arrivalTime: arr });
    expect((await read(id)).durationMinutes).toBeCloseTo(30.5, 6);
  });

  describe('the SQL rule and the TypeScript rule are one rule', () => {
    // Every combination of semantics, stored and derived, compared against the
    // function that was the sole authority before the column existed.
    for (const depSem of SEMANTICS) {
      for (const arrSem of SEMANTICS) {
        it(`agrees for ${depSem} → ${arrSem}`, async () => {
          const id = await seed({ depTimeSemantics: depSem, arrTimeSemantics: arrSem });
          const row = await read(id);
          expect(measuredDurationMinutes(row, DEP_TZ, ARR_TZ)).toEqual(
            tzAwareDurationMinutes(DEP, ARR, DEP_TZ, ARR_TZ, depSem, arrSem),
          );
        });
      }
    }
  });

  describe('an airport timezone correction', () => {
    // The decision under test: a timezone fix is a write to the AIRPORT, not to
    // any flight. Rows whose duration the catalogue can move store nothing, so
    // the correction lands on the next read; rows it cannot move keep their
    // stored value, because the catalogue was never an input to them.
    const DEP_IATA = 'ZQ1';
    const ARR_IATA = 'ZQ2';
    let utcFlightId: string;
    let legacyFlightId: string;

    /** The arrival airport's clock, as the application would read it. */
    const arrTzFromCatalogue = async (): Promise<string | null> =>
      (await getCachedAirport(ARR_IATA))?.timezone ?? null;

    beforeAll(async () => {
      await prisma.airport.deleteMany({ where: { iata: { in: [DEP_IATA, ARR_IATA] } } });
      await prisma.airport.createMany({
        data: [
          {
            iata: DEP_IATA,
            name: 'Duration Column Test Field — departure',
            lat: -33.95,
            lon: 151.18,
            timezone: DEP_TZ,
            isUserAdded: true,
          },
          {
            iata: ARR_IATA,
            name: 'Duration Column Test Field — arrival',
            lat: 25.25,
            lon: 55.36,
            timezone: ARR_TZ,
            isUserAdded: true,
          },
        ],
      });
      invalidateAirportCache(DEP_IATA);
      invalidateAirportCache(ARR_IATA);
      utcFlightId = await seed({ depIata: DEP_IATA, arrIata: ARR_IATA });
      legacyFlightId = await seed({
        depIata: DEP_IATA,
        arrIata: ARR_IATA,
        depTimeSemantics: 'LEGACY_FAKE_UTC',
        arrTimeSemantics: 'LEGACY_FAKE_UTC',
      });
    });

    afterAll(async () => {
      await prisma.airport.deleteMany({ where: { iata: { in: [DEP_IATA, ARR_IATA] } } });
      invalidateAirportCache(DEP_IATA);
      invalidateAirportCache(ARR_IATA);
    });

    it('leaves a stored duration alone, and does not need to touch it', async () => {
      expect((await read(utcFlightId)).durationMinutes).toBe(390);

      await prisma.airport.updateMany({
        where: { iata: ARR_IATA },
        data: { timezone: 'America/New_York' },
      });
      invalidateAirportCache(ARR_IATA);
      expect(await arrTzFromCatalogue()).toBe('America/New_York');

      // Both endpoints are real instants, so the airport's clock was never an
      // input here. The stored value is not stale after the correction — it is
      // simply still right, which is why it was safe to store.
      const after = await read(utcFlightId);
      expect(after.durationMinutes).toBe(390);
      expect(measuredDurationMinutes(after, DEP_TZ, await arrTzFromCatalogue())).toBe(390);
    });

    it('moves a legacy row on the very next read, with no write to the flight', async () => {
      await prisma.airport.updateMany({
        where: { iata: ARR_IATA },
        data: { timezone: ARR_TZ },
      });
      invalidateAirportCache(ARR_IATA);
      const before = measuredDurationMinutes(
        await read(legacyFlightId),
        DEP_TZ,
        await arrTzFromCatalogue(),
      );

      expect(before).not.toBeNull();

      // The correction: the arrival airport was on the wrong clock.
      await prisma.airport.updateMany({
        where: { iata: ARR_IATA },
        data: { timezone: 'Asia/Kolkata' },
      });
      invalidateAirportCache(ARR_IATA);
      const correctedTz = await arrTzFromCatalogue();
      const row = await read(legacyFlightId);

      // The flight row did not change — and did not have to, because it never
      // claimed a duration for this class in the first place.
      expect(row.durationMinutes).toBeNull();
      const after = measuredDurationMinutes(row, DEP_TZ, correctedTz);
      expect(after).toBe(
        tzAwareDurationMinutes(DEP, ARR, DEP_TZ, correctedTz, 'LEGACY_FAKE_UTC', 'LEGACY_FAKE_UTC'),
      );
      // Dubai (+04) → Kolkata (+05:30) is 90 minutes of arrival-side offset:
      // the answer follows the catalogue immediately instead of going stale.
      expect(after).toBe((before as number) - 90);
    });
  });
});
