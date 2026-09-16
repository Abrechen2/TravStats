import { prisma } from '../../../db';
import { hashPassword } from '../../../utils/password';
import { refreshLegsForMovedStop } from '../legRecompute';

/**
 * Moving a stop moves the legs that end at it.
 *
 * `recomputeLegs` answers "which PAIRS of stops exist", and keeps a pair it
 * already has — the reason inserting or deleting a stop is cheap. So it never
 * noticed a stop whose coordinates changed underneath it: two stops at (0,0)
 * and (1,0) make a 111 km leg, and moving the second to (10,0) left the stored
 * 111 km behind. Sending the same order again did not heal it either (audit
 * finding AUD-027).
 *
 * The second case is the one worth being careful about: a line somebody drew by
 * hand is not deleted and not replaced with a straight chord. It loses its
 * confidence and keeps its geometry, so the work survives and the UI can say
 * the line needs re-anchoring.
 */
const USERNAME = `leg-refresh-${Date.now()}`;

describe('refreshLegsForMovedStop', () => {
  let userId: string;
  let tripId: string;
  let routeId: string;
  let stopA: string;
  let stopB: string;

  beforeEach(async () => {
    const user = await prisma.user.upsert({
      where: { username: USERNAME },
      create: { username: USERNAME, passwordHash: await hashPassword('password123') },
      update: {},
    });
    userId = user.id;

    await prisma.trip.deleteMany({ where: { userId } });
    const trip = await prisma.trip.create({
      data: { userId, name: 'Leg refresh', startDate: new Date('2026-01-01') },
    });
    tripId = trip.id;

    const route = await prisma.tripRoute.create({
      data: { tripId, name: 'Section', mode: 'road' },
    });
    routeId = route.id;

    const a = await prisma.tripStop.create({
      data: { tripId, title: 'A', lat: 0, lon: 0, routeId, routeOrderIdx: 0 },
    });
    const b = await prisma.tripStop.create({
      data: { tripId, title: 'B', lat: 0, lon: 1, routeId, routeOrderIdx: 1 },
    });
    stopA = a.id;
    stopB = b.id;
  });

  afterAll(async () => {
    await prisma.trip.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: USERNAME } }).catch(() => {});
  });

  it('recomputes a straight leg after its endpoint moves', async () => {
    const leg = await prisma.tripRouteLeg.create({
      data: {
        routeId,
        fromStopId: stopA,
        toStopId: stopB,
        source: 'straight',
        mode: 'road',
        distanceKm: 111.195,
      },
    });

    // Ten times as far away, along the same parallel.
    await prisma.tripStop.update({ where: { id: stopB }, data: { lon: 10 } });
    await refreshLegsForMovedStop(prisma, stopB);

    const after = await prisma.tripRouteLeg.findUniqueOrThrow({ where: { id: leg.id } });
    expect(after.distanceKm).toBeGreaterThan(1100);
    expect(after.distanceKm).toBeLessThan(1120);
  });

  it('keeps a drawn line but stops calling it trustworthy', async () => {
    const leg = await prisma.tripRouteLeg.create({
      data: {
        routeId,
        fromStopId: stopA,
        toStopId: stopB,
        source: 'drawn',
        mode: 'road',
        distanceKm: 150,
        confidence: 'high',
        waypoints: [
          [0, 0],
          [0.5, 0.2],
          [1, 0],
        ],
      },
    });

    await prisma.tripStop.update({ where: { id: stopB }, data: { lon: 10 } });
    await refreshLegsForMovedStop(prisma, stopB);

    const after = await prisma.tripRouteLeg.findUniqueOrThrow({ where: { id: leg.id } });
    // The hand-drawn geometry and its distance survive — nothing is thrown away.
    expect(after.waypoints).not.toBeNull();
    expect(after.distanceKm).toBe(150);
    // But it is no longer presented as reliable.
    expect(after.confidence).toBe('low');
  });
});
