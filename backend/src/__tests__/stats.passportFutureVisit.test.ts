/**
 * AUD-085. A visit that has not happened is not evidence of having been
 * somewhere.
 *
 * `shared/placeCounting.ts` already draws that line — `classifyVisit` calls a
 * future visit `planned`, and the place's own endpoint reports it that way.
 * The passport and country-detail loaders flattened every visit row regardless,
 * so booking a visit for 2099 at a place already marked visited-but-undated
 * moved the country's first year to 2099, invented a day of presence in it, and
 * cleared `hasUndatedEvidence` — the flag that says "this country is proved,
 * but nothing dates it".
 *
 * Through the real endpoint, because the bug is in what the loaders select and
 * pass on; `buildPassport` never sees the difference.
 */
import request from 'supertest';
import app from '../index';
import { prisma } from '../db';
import { hashPassword } from '../utils/password';
import { generateToken } from '../utils/jwt';

const USERNAME = 'passportfuturevisit';
const COUNTRY = 'PT';

interface PassportCountry {
  code: string;
  firstYear: number | null;
  lastYear: number | null;
  daysPresent: number;
  hasUndatedEvidence: boolean;
}

describe('a visit still ahead does not date a country', () => {
  let userId: string;
  let cookie: string;
  let placeId: string;

  const passportCountry = async (): Promise<PassportCountry | undefined> => {
    const res = await request(app).get('/api/v1/stats/passport').set('Cookie', cookie);
    expect(res.status).toBe(200);
    return (res.body.countries as PassportCountry[]).find((c) => c.code === COUNTRY);
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword('password123') },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;

    // Marked visited, never dated — the state the finding starts from.
    const place = await prisma.place.create({
      data: {
        userId,
        name: 'Torre de Belém',
        visited: true,
        isoCountryCode: COUNTRY,
        lat: 38.6916,
        lon: -9.216,
      },
    });
    placeId = place.id;
  });

  afterAll(async () => {
    await prisma.placeVisit.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  it('starts out proved but undated', async () => {
    const before = await passportCountry();

    expect(before).toBeDefined();
    expect(before!.firstYear).toBeNull();
    expect(before!.daysPresent).toBe(0);
    expect(before!.hasUndatedEvidence).toBe(true);
  });

  it('is unchanged by a visit booked for 2099', async () => {
    await prisma.placeVisit.create({
      data: { userId, placeId, visitedAt: new Date('2099-01-02T00:00:00Z') },
    });

    const after = await passportCountry();

    expect(after).toBeDefined();
    // Every one of these moved before the fix: 2099, one day present, and the
    // undated flag cleared.
    expect(after!.firstYear).toBeNull();
    expect(after!.lastYear).toBeNull();
    expect(after!.daysPresent).toBe(0);
    expect(after!.hasUndatedEvidence).toBe(true);
  });

  it('is dated by a visit that has actually happened', async () => {
    // The control: without this the fix could simply be "ignore all visits".
    await prisma.placeVisit.create({
      data: { userId, placeId, visitedAt: new Date('2019-05-04T00:00:00Z') },
    });

    const after = await passportCountry();

    expect(after!.firstYear).toBe(2019);
    expect(after!.daysPresent).toBe(1);
    // The 2099 booking still must not stretch the span.
    expect(after!.lastYear).toBe(2019);
  });
});
