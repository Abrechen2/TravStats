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

  describe('POST /api/v1/cruises', () => {
    it('creates a cruise with stops', async () => {
      const res = await request(app)
        .post('/api/v1/cruises')
        .set('Cookie', authCookie)
        .send({
          cruiseLine: 'New Line',
          departurePortId: portId,
          arrivalPortId: portId,
          startDate: '2026-08-01T12:00:00Z',
          endDate: '2026-08-08T10:00:00Z',
          status: 'scheduled',
          stops: [
            { portId, dayNumber: 1, isAtSea: false },
            { dayNumber: 2, isAtSea: true, portId: null },
          ],
        });
      expect(res.status).toBe(201);
      expect(res.body.data.stops.length).toBe(2);
      expect(res.body.data.userId).toBe(userId);
    });

    it('rejects invalid payload', async () => {
      const res = await request(app).post('/api/v1/cruises').set('Cookie', authCookie).send({ price: -5 });
      expect(res.status).toBe(400);
    });

    it('requires authentication', async () => {
      const res = await request(app).post('/api/v1/cruises').send({ cruiseLine: 'X' });
      expect(res.status).toBe(401);
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

    it('replaces stops when stops provided', async () => {
      const res = await request(app)
        .patch(`/api/v1/cruises/${editableId}`)
        .set('Cookie', authCookie)
        .send({ stops: [{ dayNumber: 1, isAtSea: true, portId: null }] });
      expect(res.status).toBe(200);
      expect(res.body.data.stops.length).toBe(1);
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
