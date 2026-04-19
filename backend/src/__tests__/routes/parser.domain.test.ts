import request from 'supertest';
import app from '../../index';
import { prisma } from '../../db';
import { hashPassword } from '../../utils/password';
import { generateToken } from '../../utils/jwt';

describe('parser domain param', () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const timestamp = Date.now();
    const user = await prisma.user.create({
      data: {
        username: `parser-domain-test-${timestamp}`,
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

  it('rejects unknown domain on /parse-email', async () => {
    const res = await request(app)
      .post('/api/v1/parse-email')
      .set('Cookie', [`auth_token=${token}`])
      .send({ emailContent: 'sample text', domain: 'cruise' });
    expect(res.status).toBe(400);
  });

  it('accepts domain=flight on /parse-email (not rejected at schema layer)', async () => {
    const res = await request(app)
      .post('/api/v1/parse-email')
      .set('Cookie', [`auth_token=${token}`])
      .send({ emailContent: 'a', domain: 'flight' });

    // Downstream may 4xx/5xx because 'a' is not a valid booking email, but
    // it must NOT be a schema-level 400 blaming the 'domain' field.
    expect([200, 400, 401, 422, 500]).toContain(res.status);

    if (res.status === 400 && typeof res.body?.error === 'string') {
      expect(res.body.error.toLowerCase()).not.toContain('domain');
    }
  }, 30000);

  it('rejects unknown domain on /parse-pdf', async () => {
    const res = await request(app)
      .post('/api/v1/parse-pdf')
      .set('Cookie', [`auth_token=${token}`])
      .send({ pdfBase64: 'AAAA', domain: 'cruise' });
    expect(res.status).toBe(400);
  });

  it('rejects unknown domain on /parse-boardingpass', async () => {
    const res = await request(app)
      .post('/api/v1/parse-boardingpass')
      .set('Cookie', [`auth_token=${token}`])
      .send({ imageBase64: 'AAAA', domain: 'cruise' });
    expect(res.status).toBe(400);
  });

  it('rejects unknown domain on /parse-email-file', async () => {
    const res = await request(app)
      .post('/api/v1/parse-email-file')
      .set('Cookie', [`auth_token=${token}`])
      .attach('email', Buffer.from('dummy'), 'x.eml')
      .field('domain', 'cruise');
    expect(res.status).toBe(400);
  });
});
