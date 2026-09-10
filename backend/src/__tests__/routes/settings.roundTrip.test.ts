import request from 'supertest';
import app from '../../index';
import { prisma } from '../../db';
import { hashPassword } from '../../utils/password';
import { generateToken } from '../../utils/jwt';

/**
 * A visible switch has to survive save → GET → fresh client, or it is not a
 * setting.
 *
 * Two blocks failed that, in opposite halves of the stack. `features` was
 * missing from the server's Zod schema, so the PUT answered 200 and Zod dropped
 * it on the floor: cost tracking came back off, and tail-number recording came
 * back ON for a user who had deliberately switched it off (audit finding
 * AUD-017). `cruise` was stored and returned correctly, and the browser store
 * simply never merged it, so a second browser saw empty defaults and switched
 * the cruise arcs back on — and the next unrelated save wrote those defaults
 * over the good server values (AUD-016, fixed on the client side).
 *
 * This test guards the server half of both, and the shape of the guard is the
 * point: it asserts the round trip for every block the settings page can send,
 * so the next block added to the UI without a schema entry fails here rather
 * than in somebody's second browser.
 */
describe('settings round-trip', () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `settings-round-trip-${Date.now()}`,
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
  });

  it('keeps the feature toggles the settings page shows', async () => {
    const put = await request(app)
      .put('/api/v1/settings')
      .set('Cookie', [`auth_token=${token}`])
      .send({ features: { enableCostTracking: true, trackAircraftRegistration: false } });
    expect(put.status).toBe(200);

    const get = await request(app)
      .get('/api/v1/settings')
      .set('Cookie', [`auth_token=${token}`]);

    expect(get.status).toBe(200);
    expect(get.body.features).toEqual(
      expect.objectContaining({ enableCostTracking: true, trackAircraftRegistration: false })
    );
  });

  it('keeps the cruise defaults', async () => {
    const put = await request(app)
      .put('/api/v1/settings')
      .set('Cookie', [`auth_token=${token}`])
      .send({
        cruise: { defaultLine: 'AIDA', defaultCabinType: 'balcony', showCruiseArcs: false },
      });
    expect(put.status).toBe(200);

    const get = await request(app)
      .get('/api/v1/settings')
      .set('Cookie', [`auth_token=${token}`]);

    expect(get.body.cruise).toEqual(
      expect.objectContaining({
        defaultLine: 'AIDA',
        defaultCabinType: 'balcony',
        showCruiseArcs: false,
      })
    );
  });

  // Saving one block must not quietly reset another. This is the mechanism by
  // which a client that holds stale defaults for a block it never loaded can
  // overwrite the server's good values.
  it('does not disturb a block it was not asked about', async () => {
    await request(app)
      .put('/api/v1/settings')
      .set('Cookie', [`auth_token=${token}`])
      .send({ display: { language: 'en' } });

    const get = await request(app)
      .get('/api/v1/settings')
      .set('Cookie', [`auth_token=${token}`]);

    expect(get.body.features).toEqual(
      expect.objectContaining({ enableCostTracking: true, trackAircraftRegistration: false })
    );
    expect(get.body.cruise).toEqual(expect.objectContaining({ defaultLine: 'AIDA' }));
  });
});
