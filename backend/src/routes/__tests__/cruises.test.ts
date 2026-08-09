import request from 'supertest';
import app from '../../index';
import { prisma } from '../../db';
import { hashPassword } from '../../utils/password';
import { generateToken } from '../../utils/jwt';

describe('Cruises API', () => {
  let authCookie: string;
  let userId: string;
  let otherUserId: string;
  let otherCookie: string;
  let portId: number;
  let shipId: number;
  let seedCruiseId: string;

  beforeAll(async () => {
    await prisma.cruise.deleteMany({ where: { user: { username: { in: ['cruisetest', 'cruiseother'] } } } });
    await prisma.user.deleteMany({ where: { username: { in: ['cruisetest', 'cruiseother'] } } });

    const u = await prisma.user.create({ data: { username: 'cruisetest', passwordHash: await hashPassword('password123') } });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;

    const other = await prisma.user.create({ data: { username: 'cruiseother', passwordHash: await hashPassword('password123') } });
    otherUserId = other.id;
    otherCookie = `auth_token=${generateToken(other.id)}`;
    // otherCookie is reserved for cross-user assertions where we POST as the
    // other user — current suite creates foreign cruises directly via prisma,
    // keep the helper so the pattern is obvious to future tests.
    void otherCookie;

    // Find any existing seeded port/ship (created by Phase 2 seeders).
    const port = await prisma.port.findFirst({ where: { isUserAdded: false } });
    const ship = await prisma.ship.findFirst({ where: { isUserAdded: false } });
    if (!port || !ship) throw new Error('Missing seeded port/ship — run seeders first');
    portId = port.id;
    shipId = ship.id;

    const seed = await prisma.cruise.create({
      data: {
        userId,
        shipId,
        cruiseLine: 'AIDA Cruises',
        departurePortId: portId,
        arrivalPortId: portId,
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-06-08'),
        status: 'scheduled',
      },
    });
    seedCruiseId = seed.id;
  });

  afterAll(async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.cruise.deleteMany({ where: { userId: otherUserId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.user.delete({ where: { id: otherUserId } });
    await prisma.$disconnect();
  });

  describe('GET /api/v1/cruises', () => {
    it("lists the authenticated user's cruises only", async () => {
      const res = await request(app).get('/api/v1/cruises').set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].userId).toBe(userId);
    });

    it('includes ship, ports, stops', async () => {
      const res = await request(app).get('/api/v1/cruises').set('Cookie', authCookie);
      const c = res.body.data[0];
      expect(c.ship).toBeTruthy();
      expect(c.departurePort).toBeTruthy();
      expect(c.arrivalPort).toBeTruthy();
      expect(Array.isArray(c.stops)).toBe(true);
    });

    it('filters by cruiseLine', async () => {
      const res = await request(app).get('/api/v1/cruises?cruiseLine=AIDA%20Cruises').set('Cookie', authCookie);
      expect(res.body.data.length).toBe(1);
    });

    it('requires authentication', async () => {
      const res = await request(app).get('/api/v1/cruises');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/cruises/:id', () => {
    it('returns 200 with full cruise', async () => {
      const res = await request(app).get(`/api/v1/cruises/${seedCruiseId}`).set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(seedCruiseId);
    });

    it('returns 404 for a cruise that does not exist', async () => {
      const res = await request(app).get('/api/v1/cruises/00000000-0000-0000-0000-000000000000').set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });

    it("returns 404 for another user's cruise (no data leak)", async () => {
      const foreign = await prisma.cruise.create({ data: { userId: otherUserId, status: 'scheduled' } });
      const res = await request(app).get(`/api/v1/cruises/${foreign.id}`).set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/cruises/:id/geometry', () => {
    it('returns a FeatureCollection for an owned cruise', async () => {
      const res = await request(app)
        .get(`/api/v1/cruises/${seedCruiseId}/geometry`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.type).toBe('FeatureCollection');
      expect(Array.isArray(res.body.data.features)).toBe(true);
      // Seeded cruise has no stops → zero legs to route; still 200.
      expect(res.body.data.features.length).toBe(0);
    });

    it('requires authentication', async () => {
      const res = await request(app).get(`/api/v1/cruises/${seedCruiseId}/geometry`);
      expect(res.status).toBe(401);
    });

    it("returns 404 for another user's cruise (no data leak)", async () => {
      const foreign = await prisma.cruise.create({ data: { userId: otherUserId, status: 'scheduled' } });
      const res = await request(app)
        .get(`/api/v1/cruises/${foreign.id}/geometry`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/cruises', () => {
    it('creates a cruise with stops', async () => {
      const res = await request(app)
        .post('/api/v1/cruises')
        .set('Cookie', authCookie)
        .send({
          cruiseLine: 'New Line',
          routeName: 'Kanaren mit Marokko',
          departurePortId: portId,
          arrivalPortId: portId,
          startDate: '2026-08-01T12:00:00Z',
          endDate: '2026-08-08T10:00:00Z',
          status: 'scheduled',
          stops: [
            { portId, dayNumber: 1, isAtSea: false, date: '2026-08-01' },
            { dayNumber: 2, isAtSea: true, portId: null, date: '2026-08-02' },
          ],
        });
      expect(res.status).toBe(201);
      expect(res.body.data.stops.length).toBe(2);
      expect(res.body.data.userId).toBe(userId);
      // #133 routeName + #132 per-stop dates persist and round-trip.
      expect(res.body.data.routeName).toBe('Kanaren mit Marokko');
      const stops = [...res.body.data.stops].sort(
        (a: { dayNumber: number }, b: { dayNumber: number }) => a.dayNumber - b.dayNumber,
      );
      expect(stops[0].date).toBe('2026-08-01T00:00:00.000Z');
      expect(stops[1].date).toBe('2026-08-02T00:00:00.000Z');
    });

    it('persists and returns the optional map color (round-trip)', async () => {
      const create = await request(app)
        .post('/api/v1/cruises')
        .set('Cookie', authCookie)
        .send({
          cruiseLine: 'Colored Line',
          departurePortId: portId,
          arrivalPortId: portId,
          startDate: '2026-10-01T12:00:00Z',
          endDate: '2026-10-08T10:00:00Z',
          status: 'scheduled',
          color: '#ff8800',
        });
      expect(create.status).toBe(201);
      expect(create.body.data.color).toBe('#ff8800');
      // Survives a fresh read, not just echoed from the request body.
      const get = await request(app)
        .get(`/api/v1/cruises/${create.body.data.id}`)
        .set('Cookie', authCookie);
      expect(get.status).toBe(200);
      expect(get.body.data.color).toBe('#ff8800');
    });

    it('rejects invalid payload', async () => {
      const res = await request(app).post('/api/v1/cruises').set('Cookie', authCookie).send({ price: -5 });
      expect(res.status).toBe(400);
    });

    it('requires authentication', async () => {
      const res = await request(app).post('/api/v1/cruises').send({ cruiseLine: 'X' });
      expect(res.status).toBe(401);
    });

    it('persists cruise_legs for multi-port itineraries', async () => {
      // Need two distinct ports for the leg to be non-zero. Pick the
      // first two non-river seeded ports so the orchestrator hits the
      // marnet+haversine chain rather than the river calculator.
      const oceanPorts = await prisma.port.findMany({
        where: { isUserAdded: false, region: { not: { startsWith: 'river_' } } },
        take: 2,
      });
      if (oceanPorts.length < 2) return; // dev DB not seeded — skip silently
      const [p1, p2] = oceanPorts;
      const res = await request(app)
        .post('/api/v1/cruises')
        .set('Cookie', authCookie)
        .send({
          cruiseLine: 'Distance Test Line',
          departurePortId: p1.id,
          arrivalPortId: p2.id,
          startDate: '2026-09-01T12:00:00Z',
          endDate: '2026-09-05T10:00:00Z',
          status: 'scheduled',
          stops: [
            { portId: p1.id, dayNumber: 1, isAtSea: false },
            { dayNumber: 2, isAtSea: true, portId: null },
            { portId: p2.id, dayNumber: 3, isAtSea: false },
          ],
        });
      expect(res.status).toBe(201);
      const cruiseId = res.body.data.id as string;
      const legs = await prisma.cruiseLeg.findMany({ where: { cruiseId } });
      expect(legs).toHaveLength(1);
      expect(legs[0].fromPortId).toBe(p1.id);
      expect(legs[0].toPortId).toBe(p2.id);
      expect(legs[0].distanceKm).toBeGreaterThan(0);
      expect(['haversine', 'eurostat', 'river-osm']).toContain(legs[0].method);
      expect(legs[0].routerVersion).toBe('1.0.0');
    });
  });

  describe('PATCH /api/v1/cruises/:id', () => {
    let editableId: string;
    beforeAll(async () => {
      const c = await prisma.cruise.create({ data: { userId, status: 'scheduled' } });
      editableId = c.id;
    });

    it('updates fields', async () => {
      const res = await request(app)
        .patch(`/api/v1/cruises/${editableId}`)
        .set('Cookie', authCookie)
        .send({ notes: 'Great trip' });
      expect(res.status).toBe(200);
      expect(res.body.data.notes).toBe('Great trip');
    });

    it('sets and clears the map color (color: null empties a set value)', async () => {
      const c = await prisma.cruise.create({
        data: { userId, status: 'scheduled', color: '#123456' },
      });
      const set = await request(app).get(`/api/v1/cruises/${c.id}`).set('Cookie', authCookie);
      expect(set.body.data.color).toBe('#123456');

      const cleared = await request(app)
        .patch(`/api/v1/cruises/${c.id}`)
        .set('Cookie', authCookie)
        .send({ color: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data.color).toBeNull();
    });

    it('replaces stops when stops provided', async () => {
      const res = await request(app)
        .patch(`/api/v1/cruises/${editableId}`)
        .set('Cookie', authCookie)
        .send({ stops: [{ dayNumber: 1, isAtSea: true, portId: null }] });
      expect(res.status).toBe(200);
      expect(res.body.data.stops.length).toBe(1);
    });

    it('deletes all stops when an empty stops array is sent', async () => {
      const res = await request(app)
        .patch(`/api/v1/cruises/${editableId}`)
        .set('Cookie', authCookie)
        .send({ stops: [] });
      expect(res.status).toBe(200);
      expect(res.body.data.stops.length).toBe(0);
    });

    // The edit modal offers clearing for every optional detail field. null
    // clears, undefined leaves alone — same wire contract the flight PUT got
    // on 2026-08-02; before the schema turned nullable, a blanked field
    // collapsed to undefined and the "clear" silently kept the old value.
    it('clears the optional detail fields with an explicit null', async () => {
      const filled = await prisma.cruise.create({
        data: {
          userId,
          status: 'scheduled',
          cruiseLine: 'AIDA',
          routeName: 'Kanaren',
          cabinNumber: '8123',
          cabinType: 'balcony',
          deck: 8,
          bookingReference: 'ABC123',
          price: 1999.99,
          notes: 'to be removed',
        },
      });

      const cleared = await request(app)
        .patch(`/api/v1/cruises/${filled.id}`)
        .set('Cookie', authCookie)
        .send({
          cruiseLine: null,
          routeName: null,
          cabinNumber: null,
          cabinType: null,
          deck: null,
          bookingReference: null,
          price: null,
          notes: null,
        });
      expect(cleared.status).toBe(200);
      for (const field of [
        'cruiseLine',
        'routeName',
        'cabinNumber',
        'cabinType',
        'deck',
        'bookingReference',
        'price',
        'notes',
      ]) {
        expect(cleared.body.data[field]).toBeNull();
      }

      // And an unrelated update must leave the nulls alone.
      const untouched = await request(app)
        .patch(`/api/v1/cruises/${filled.id}`)
        .set('Cookie', authCookie)
        .send({ tags: ['x'] });
      expect(untouched.status).toBe(200);
      expect(untouched.body.data.cruiseLine).toBeNull();
      expect(untouched.body.data.cabinType).toBeNull();
    });

    it("404 on another user's cruise", async () => {
      const foreign = await prisma.cruise.create({ data: { userId: otherUserId, status: 'scheduled' } });
      const res = await request(app)
        .patch(`/api/v1/cruises/${foreign.id}`)
        .set('Cookie', authCookie)
        .send({ notes: 'x' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/cruises/:id', () => {
    it('deletes and returns 204', async () => {
      const c = await prisma.cruise.create({ data: { userId, status: 'scheduled' } });
      const res = await request(app).delete(`/api/v1/cruises/${c.id}`).set('Cookie', authCookie);
      expect(res.status).toBe(204);
      const gone = await prisma.cruise.findUnique({ where: { id: c.id } });
      expect(gone).toBeNull();
    });

    it("404 on another user's cruise", async () => {
      const foreign = await prisma.cruise.create({ data: { userId: otherUserId, status: 'scheduled' } });
      const res = await request(app).delete(`/api/v1/cruises/${foreign.id}`).set('Cookie', authCookie);
      expect(res.status).toBe(404);
      // row should still exist
      const still = await prisma.cruise.findUnique({ where: { id: foreign.id } });
      expect(still).not.toBeNull();
    });
  });
});
