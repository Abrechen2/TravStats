/**
 * A flight that has not happened is not a flight you took.
 *
 * `computeSummary` filtered distance and flight time to flown+historical but
 * counted `totalFlights` and summed `totalCost` over every status. The year
 * card therefore put "Gesamt Flüge: 14" next to a distance covering ten of
 * them, and the hero endpoint the mobile app reads answered
 * `{flights: 1, distanceKm: 0, countries: 0, airports: 0}` for an account
 * holding a single BOOKED flight — one flight that went nowhere.
 *
 * The original design justified the mixed population with a `byStatus`
 * breakdown shown beside the number. That breakdown is rendered by exactly one
 * component, and that component is imported nowhere; `/hero` never carried it
 * at all. So the context was gone and the bare number stayed.
 *
 * `byStatus` still reports every status — it is a breakdown, that is its job.
 * The headline figures now describe one population, and what is merely booked
 * is reported separately instead of being folded in.
 */
import request from 'supertest';
import app from '../index';
import { prisma } from '../db';
import { hashPassword } from '../utils/password';
import { generateToken } from '../utils/jwt';

const USERNAME = 'summarystatusblind';

describe('summary headline figures count only flights that happened', () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword('password123') },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;

    // One flown flight with a price, one booked, one cancelled — all priced,
    // so a cost total that ignores status is visible as a wrong number.
    await prisma.flight.createMany({
      data: [
        {
          userId,
          flightNumber: 'LH100',
          airline: 'Lufthansa',
          depIata: 'FRA',
          arrIata: 'LHR',
          depLat: 50.0379,
          depLon: 8.5622,
          arrLat: 51.47,
          arrLon: -0.4543,
          departureTime: new Date('2024-05-01T08:00:00Z'),
          arrivalTime: new Date('2024-05-01T09:30:00Z'),
          status: 'flown',
          price: 100,
        },
        {
          userId,
          flightNumber: 'LH200',
          airline: 'Lufthansa',
          depIata: 'FRA',
          arrIata: 'JFK',
          depLat: 50.0379,
          depLon: 8.5622,
          arrLat: 40.6413,
          arrLon: -73.7781,
          departureTime: new Date('2027-05-01T08:00:00Z'),
          arrivalTime: new Date('2027-05-01T16:00:00Z'),
          status: 'scheduled',
          price: 900,
        },
        {
          // A flown flight in a year of its own, with no price at all — the
          // year the cost total must abstain for (forgejo#83).
          userId,
          flightNumber: 'LH400',
          airline: 'Lufthansa',
          depIata: 'FRA',
          arrIata: 'MUC',
          depLat: 50.0379,
          depLon: 8.5622,
          arrLat: 48.3538,
          arrLon: 11.7861,
          departureTime: new Date('2023-03-01T08:00:00Z'),
          arrivalTime: new Date('2023-03-01T09:00:00Z'),
          status: 'flown',
        },
        {
          userId,
          flightNumber: 'LH300',
          airline: 'Lufthansa',
          depIata: 'FRA',
          arrIata: 'CDG',
          depLat: 50.0379,
          depLon: 8.5622,
          arrLat: 49.0097,
          arrLon: 2.5479,
          departureTime: new Date('2024-06-01T08:00:00Z'),
          arrivalTime: new Date('2024-06-01T09:00:00Z'),
          status: 'cancelled',
          price: 50,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('counts the flown flights only', async () => {
    const res = await request(app)
      .get('/api/v1/stats/summary')
      .set('Cookie', cookie)
      .expect(200);

    // LH100 (2024, priced) and LH400 (2023, unpriced) — never the booked or
    // the cancelled one.
    expect(res.body.totalFlights).toBe(2);
  });

  it('reports totalCost null, not 0, for a year whose flights are unpriced (forgejo#83)', async () => {
    const res = await request(app).get('/api/v1/stats/summary?year=2023').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.totalFlights).toBe(1);
    expect(res.body.totalCost).toBeNull();
    expect(res.body.unpricedFlights).toBe(1);
  });

  it('sums the cost of the flown flight only', async () => {
    const res = await request(app)
      .get('/api/v1/stats/summary')
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.totalCost).toBe(100);
  });

  it('still breaks every status down, because that is what a breakdown is for', async () => {
    const res = await request(app)
      .get('/api/v1/stats/summary')
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.byStatus).toMatchObject({
      flown: 2,
      scheduled: 1,
      cancelled: 1,
    });
  });

  it('reports what is merely booked separately, so it is not lost', async () => {
    const res = await request(app)
      .get('/api/v1/stats/summary')
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.plannedFlights).toBe(1);
  });

  it('hero no longer says "one flight, nowhere"', async () => {
    const res = await request(app)
      .get('/api/v1/stats/hero')
      .set('Cookie', cookie)
      .expect(200);

    const hero = res.body.data ?? res.body;
    // Every figure in the object now describes the same population: whatever
    // count it reports, a positive count must come with a positive distance.
    expect(hero.flights).toBe(2);
    expect(hero.distanceKm).toBeGreaterThan(0);
  });
});
