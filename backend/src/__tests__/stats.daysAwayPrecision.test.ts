/**
 * AUD-083 and AUD-084, both in `daysAwayLoader`.
 *
 * **083** — a stay recorded with MONTH precision stores placeholder dates
 * spanning the whole month while the record itself says how many nights it
 * was. Walking those dates turned a three-night stay into 32 days of attested
 * presence. `shared/lodgingTiming.ts` already refused to walk such a stay for
 * its night count; the day loader never asked.
 *
 * **084** — the year filter's upper bound tested the check-in column alone, so
 * a stay with a known check-out and no check-in was dropped by it: the
 * unscoped summary counted its day and the same summary for that very year
 * counted none. The pure function has always placed a one-ended span by the
 * end it has.
 *
 * Both are asserted through the real endpoint against the real database,
 * because both bugs live in the SQL window and the selected columns — neither
 * is visible to the pure function they feed.
 */
import request from 'supertest';
import app from '../index';
import { prisma } from '../db';
import { hashPassword } from '../utils/password';
import { generateToken } from '../utils/jwt';

const USERNAME = 'daysawayprecision';

async function lodgingDays(cookie: string, year?: number): Promise<number> {
  const url = year ? `/api/v1/stats/summary?year=${year}` : '/api/v1/stats/summary';
  const res = await request(app).get(url).set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body.daysAway.lodging;
}

describe('days away only counts days the record actually names', () => {
  let userId: string;
  let cookie: string;
  let lodgingId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword('password123') },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;

    const lodging = await prisma.lodging.create({
      data: { userId, name: 'Testhaus', visited: true },
    });
    lodgingId = lodging.id;
  });

  afterEach(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  it('does not turn a month placeholder into 32 days of presence (AUD-083)', async () => {
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId,
        status: 'completed',
        datePrecision: 'MONTH',
        checkIn: new Date('2025-05-01T00:00:00Z'),
        checkOut: new Date('2025-06-01T00:00:00Z'),
        nights: 3,
      },
    });

    // The nights are known and the days are not. Zero named days is the honest
    // answer; 32 was the invented one.
    expect(await lodgingDays(cookie)).toBe(0);
  });

  it('still counts a real day-precision stay', async () => {
    // The control that makes the case above meaningful rather than "lodging
    // days are always zero now".
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId,
        status: 'completed',
        datePrecision: 'DAY',
        checkIn: new Date('2025-05-01T00:00:00Z'),
        checkOut: new Date('2025-05-04T00:00:00Z'),
        nights: 3,
      },
    });

    expect(await lodgingDays(cookie)).toBe(4);
    expect(await lodgingDays(cookie, 2025)).toBe(4);
  });

  it('keeps a stay with a known check-out and no check-in inside its year (AUD-084)', async () => {
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId,
        status: 'completed',
        datePrecision: 'DAY',
        checkIn: null,
        checkOut: new Date('2025-05-04T00:00:00Z'),
        nights: null,
      },
    });

    const unscoped = await lodgingDays(cookie);
    expect(unscoped).toBe(1);
    // The bug: the same day, invisible the moment the summary is scoped to the
    // year it falls in.
    expect(await lodgingDays(cookie, 2025)).toBe(unscoped);
    // And it must not leak into a neighbouring year.
    expect(await lodgingDays(cookie, 2024)).toBe(0);
  });
});
