import request from 'supertest';
import app from '../../index';
import { prisma } from '../../db';
import { hashPassword } from '../../utils/password';
import { generateToken } from '../../utils/jwt';

describe('settings baseCurrency', () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const timestamp = Date.now();
    const user = await prisma.user.create({
      data: {
        username: `settings-base-currency-${timestamp}`,
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

  it('GET /settings returns the default baseCurrency for a fresh user', async () => {
    const res = await request(app)
      .get('/api/v1/settings')
      .set('Cookie', [`auth_token=${token}`]);
    expect(res.status).toBe(200);
    expect(res.body.baseCurrency).toBe('EUR');
  });

  it('PUT /settings persists baseCurrency, and a subsequent GET reflects it', async () => {
    const putRes = await request(app)
      .put('/api/v1/settings')
      .set('Cookie', [`auth_token=${token}`])
      .send({ baseCurrency: 'CHF' });
    expect(putRes.status).toBe(200);
    expect(putRes.body.baseCurrency).toBe('CHF');

    const getRes = await request(app)
      .get('/api/v1/settings')
      .set('Cookie', [`auth_token=${token}`]);
    expect(getRes.status).toBe(200);
    expect(getRes.body.baseCurrency).toBe('CHF');
  });

  it('PUT /settings rejects an unknown currency and leaves the row unchanged', async () => {
    const res = await request(app)
      .put('/api/v1/settings')
      .set('Cookie', [`auth_token=${token}`])
      .send({ baseCurrency: 'XXX' });
    expect(res.status).toBe(400);

    const row = await prisma.userSettings.findUnique({ where: { userId } });
    expect(row?.baseCurrency).toBe('CHF');
  });
});
