import request from 'supertest';
import app from '../../index';
import { prisma } from '../../db';
import { hashPassword } from '../../utils/password';
import { generateToken } from '../../utils/jwt';

describe('settings enabledDomains', () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const timestamp = Date.now();
    const user = await prisma.user.create({
      data: {
        username: `settings-enabled-domains-${timestamp}`,
        passwordHash: await hashPassword('password123'),
        isAdmin: false,
        isActive: true,
      },
    });
    userId = user.id;
    token = generateToken(userId);
  });

  afterAll(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('GET /settings returns default enabledDomains for a fresh user', async () => {
    const res = await request(app)
      .get('/api/v1/settings')
      .set('Cookie', [`auth_token=${token}`]);
    expect(res.status).toBe(200);
    expect(res.body.enabledDomains).toEqual(['flight']);
  });

  it('PUT /settings persists enabledDomains', async () => {
    const res = await request(app)
      .put('/api/v1/settings')
      .set('Cookie', [`auth_token=${token}`])
      .send({ enabledDomains: ['flight', 'cruise'] });
    expect(res.status).toBe(200);
    expect(res.body.enabledDomains).toEqual(['flight', 'cruise']);
  });

  it('PUT /settings rejects unknown domain keys', async () => {
    const res = await request(app)
      .put('/api/v1/settings')
      .set('Cookie', [`auth_token=${token}`])
      .send({ enabledDomains: ['flight', 'rockets'] });
    expect(res.status).toBe(400);
  });
});
