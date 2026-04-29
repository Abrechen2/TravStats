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

  // -----------------------------------------------------------------------
  // /parse-email
  // -----------------------------------------------------------------------

  it('accepts domain=cruise on /parse-email (no longer a 501 stub)', async () => {
    // The cruise email pipeline is now wired through. The text is non-bookable
    // so the LLM/regex parser typically returns zero cruises, but the route
    // must not 501 at the schema/domain check anymore.
    const res = await request(app)
      .post('/api/v1/parse-email')
      .set('Cookie', [`auth_token=${token}`])
      .send({ emailContent: 'sample text', domain: 'cruise' });
    expect(res.status).not.toBe(501);
    if (res.status === 200) {
      expect(res.body.domain).toBe('cruise');
      expect(Array.isArray(res.body.cruises)).toBe(true);
    }
  }, 30000);

  it('rejects unknown (non-enum) domain on /parse-email at schema layer', async () => {
    const res = await request(app)
      .post('/api/v1/parse-email')
      .set('Cookie', [`auth_token=${token}`])
      .send({ emailContent: 'sample text', domain: 'hotel' });
    // Zod enum rejection → 400 Validation failed (NOT 501)
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

  // -----------------------------------------------------------------------
  // /parse-pdf
  // -----------------------------------------------------------------------

  it('accepts domain=cruise on /parse-pdf (no longer a 501 stub)', async () => {
    // The cruise pipeline is wired through. 'AAAA' is not a valid PDF so the
    // route bottoms out at the PDF-extraction stage with a 400. The point is
    // that the schema/domain check no longer short-circuits with a 501.
    const res = await request(app)
      .post('/api/v1/parse-pdf')
      .set('Cookie', [`auth_token=${token}`])
      .send({ pdfBase64: 'AAAA', domain: 'cruise' });
    expect(res.status).not.toBe(501);
    if (res.status === 400 && typeof res.body?.error === 'string') {
      expect(res.body.error.toLowerCase()).not.toContain('domain');
    }
  });

  it('rejects unknown (non-enum) domain on /parse-pdf at schema layer', async () => {
    const res = await request(app)
      .post('/api/v1/parse-pdf')
      .set('Cookie', [`auth_token=${token}`])
      .send({ pdfBase64: 'AAAA', domain: 'hotel' });
    expect(res.status).toBe(400);
  });

  // -----------------------------------------------------------------------
  // /parse-boardingpass
  // -----------------------------------------------------------------------

  it('returns 501 PARSER_DOMAIN_NOT_IMPLEMENTED for domain=cruise on /parse-boardingpass', async () => {
    const res = await request(app)
      .post('/api/v1/parse-boardingpass')
      .set('Cookie', [`auth_token=${token}`])
      .send({ imageBase64: 'AAAA', domain: 'cruise' });
    expect(res.status).toBe(501);
    expect(res.body.error).toBe('PARSER_DOMAIN_NOT_IMPLEMENTED');
    expect(res.body.domain).toBe('cruise');
  });

  it('rejects unknown (non-enum) domain on /parse-boardingpass at schema layer', async () => {
    const res = await request(app)
      .post('/api/v1/parse-boardingpass')
      .set('Cookie', [`auth_token=${token}`])
      .send({ imageBase64: 'AAAA', domain: 'hotel' });
    expect(res.status).toBe(400);
  });

  // -----------------------------------------------------------------------
  // /parse-email-file (multipart)
  // -----------------------------------------------------------------------

  it('accepts domain=cruise on /parse-email-file (no longer a 501 stub)', async () => {
    // 'dummy' is not a real .eml — extractor + LLM both bottom out. The point
    // is that the route must not 501 at the schema/domain check anymore.
    const res = await request(app)
      .post('/api/v1/parse-email-file')
      .set('Cookie', [`auth_token=${token}`])
      .attach('email', Buffer.from('dummy'), 'x.eml')
      .field('domain', 'cruise');
    expect(res.status).not.toBe(501);
  }, 30000);

  it('rejects unknown (non-enum) domain on /parse-email-file at schema layer', async () => {
    const res = await request(app)
      .post('/api/v1/parse-email-file')
      .set('Cookie', [`auth_token=${token}`])
      .attach('email', Buffer.from('dummy'), 'x.eml')
      .field('domain', 'hotel');
    expect(res.status).toBe(400);
  });
});
