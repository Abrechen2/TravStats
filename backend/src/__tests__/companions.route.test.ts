import request from 'supertest';
import app from '../index';
import { prisma } from '../db';

describe('GET /api/v1/companions', () => {
  beforeEach(async () => {
    await prisma.companion.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.companion.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  it('rejects an unauthenticated request', async () => {
    await request(app).get('/api/v1/companions').expect(401);
  });

  it("returns the caller's companions with usage counts", async () => {
    const registration = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'companion-route', password: 'password123' })
      .expect(201);
    const cookie = registration.headers['set-cookie'];

    const me = await prisma.user.findUniqueOrThrow({ where: { username: 'companion-route' } });
    await prisma.companion.create({
      data: {
        userId: me.id,
        canonicalName: 'anna',
        displayName: 'Anna',
        searchName: 'anna',
      },
    });

    const response = await request(app)
      .get('/api/v1/companions')
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body.companions).toHaveLength(1);
    expect(response.body.companions[0].name).toBe('Anna');
    expect(response.body.companions[0].usageCount).toBe(0);
  });
});
