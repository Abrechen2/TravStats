/**
 * The lodging statistics must GROUP countries by their ISO code, never by the
 * free text a booking mail happened to use.
 *
 * `schema.prisma` states the rule at `Lodging.isoCountryCode`: the text field
 * keeps whatever the source wrote ("Deutschland", "Germany", "Schweiz/Suisse/
 * Svizzera/Svizra"), and everything that GROUPS or COUNTS joins on the code
 * instead. The write paths obey it; the statistics path did not, and shipped a
 * screen listing "Deutschland 127,27 €" and "Germany 139,15 €" as two
 * different countries.
 *
 * It reaches further than one list: flights and cruises contribute ISO codes
 * to the cross-domain "countries visited" tile, so lodging text made "US" and
 * "United States" two entries there as well. And the continent lookup only
 * understands ISO codes and English names — German text fell through to a
 * deliberately coarse coordinate guess, losing the continent entirely for a
 * house without coordinates.
 */
import request from 'supertest';
import app from '../index';
import { prisma } from '../db';
import { hashPassword } from '../utils/password';
import { generateToken } from '../utils/jwt';

const USERNAME = 'countryvocabstats';

describe('lodging statistics group countries by ISO code (not by free text)', () => {
  let user: { id: string; cookie: string };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const created = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword('password123') },
    });
    user = { id: created.id, cookie: `auth_token=${generateToken(created.id)}` };
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId: user.id } });
    await prisma.lodging.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  });

  beforeEach(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId: user.id } });
    await prisma.lodging.deleteMany({ where: { userId: user.id } });
  });

  /** One completed stay in a house whose country field says `countryText`. */
  async function seedStay(
    name: string,
    countryText: string,
    isoCountryCode: string | null,
    checkIn: string,
    checkOut: string
  ): Promise<void> {
    const lodging = await prisma.lodging.create({
      data: {
        userId: user.id,
        name,
        type: 'hotel',
        country: countryText,
        isoCountryCode,
        city: name,
        lat: 52.5,
        lon: 13.4,
        visited: true,
      },
    });
    await prisma.lodgingStay.create({
      data: {
        userId: user.id,
        lodgingId: lodging.id,
        checkIn: new Date(checkIn),
        checkOut: new Date(checkOut),
        nights: 2,
        status: 'completed',
        totalPrice: 200,
        currency: 'EUR',
        totalPriceBase: 200,
        fxBaseCurrency: 'EUR',
      },
    });
  }

  it('counts one country when two houses spell it differently', async () => {
    await seedStay('Haus Deutsch', 'Deutschland', 'DE', '2024-03-01', '2024-03-03');
    await seedStay('House English', 'Germany', 'DE', '2024-04-01', '2024-04-03');

    const res = await request(app)
      .get('/api/v1/stats/lodging')
      .set('Cookie', user.cookie)
      .expect(200);

    expect(res.body.data.countriesCount).toBe(1);
    expect(res.body.data.countries).toEqual(['DE']);
  });

  it('groups the price-per-night ranking under one country, not two', async () => {
    await seedStay('Haus Deutsch', 'Deutschland', 'DE', '2024-03-01', '2024-03-03');
    await seedStay('House English', 'Germany', 'DE', '2024-04-01', '2024-04-03');

    const res = await request(app)
      .get('/api/v1/stats/lodging')
      .set('Cookie', user.cookie)
      .expect(200);

    const byCountry = res.body.data.price.byCountry as Array<{ key: string; nights: number }>;
    expect(byCountry).toHaveLength(1);
    expect(byCountry[0].key).toBe('DE');
    expect(byCountry[0].nights).toBe(4);
  });

  it('resolves the code from the text when the column was never filled', async () => {
    // The column arrived after these rows did. Falling back to the resolver
    // keeps an old row in the same bucket as a new one instead of splitting it.
    await seedStay('Alt', 'Deutschland', null, '2024-03-01', '2024-03-03');
    await seedStay('Neu', 'Germany', 'DE', '2024-04-01', '2024-04-03');

    const res = await request(app)
      .get('/api/v1/stats/lodging')
      .set('Cookie', user.cookie)
      .expect(200);

    expect(res.body.data.countriesCount).toBe(1);
    expect(res.body.data.countries).toEqual(['DE']);
  });

  it('keeps a country the resolver cannot place, rather than dropping the stay', async () => {
    // "Dubai" is a city, so no code resolves — a finding, not a gap. The row
    // must stay visible under its own text instead of vanishing from the list.
    await seedStay('Irgendwo', 'Dubai', null, '2024-05-01', '2024-05-03');

    const res = await request(app)
      .get('/api/v1/stats/lodging')
      .set('Cookie', user.cookie)
      .expect(200);

    expect(res.body.data.countriesCount).toBe(1);
    expect(res.body.data.countries).toEqual(['Dubai']);
  });

  it('finds the continent for a German country name', async () => {
    // The continent lookup knows ISO codes and English names. With German text
    // it fell through to the coordinate guess — and lost the continent
    // entirely for a house without coordinates.
    const lodging = await prisma.lodging.create({
      data: {
        userId: user.id,
        name: 'Ohne Koordinaten',
        type: 'hotel',
        country: 'Deutschland',
        isoCountryCode: 'DE',
        city: 'Berlin',
        visited: true,
      },
    });
    await prisma.lodgingStay.create({
      data: {
        userId: user.id,
        lodgingId: lodging.id,
        checkIn: new Date('2024-06-01'),
        checkOut: new Date('2024-06-03'),
        nights: 2,
        status: 'completed',
        currency: 'EUR',
      },
    });

    const res = await request(app)
      .get('/api/v1/stats/lodging')
      .set('Cookie', user.cookie)
      .expect(200);

    expect(res.body.data.geo.continentsCount).toBeGreaterThanOrEqual(1);
  });
});
