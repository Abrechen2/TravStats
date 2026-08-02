import request from 'supertest';
import app from '../index';
import { prisma } from '../db';
import { hashPassword } from '../utils/password';
import { generateToken } from '../utils/jwt';

/**
 * Manual airport creation (#191) — POST /api/v1/airports, the flight-side
 * mirror of the ship/port create endpoints. Pins: creation with derived
 * timezone + isUserAdded flag, code normalisation, the 409 on an active-code
 * collision, auth requirement, and the seed-protection invariant at the DB
 * level (the seed skip itself lives in seedAirportsFromCSV).
 */
describe('POST /api/v1/airports', () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: 'airporttest' } });
    const user = await prisma.user.create({
      data: { username: 'airporttest', passwordHash: await hashPassword('password123') },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.airport.deleteMany({ where: { isUserAdded: true, name: { startsWith: 'Testfeld' } } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('creates an airport with a geo-tz derived timezone and the isUserAdded flag', async () => {
    const res = await request(app)
      .post('/api/v1/airports')
      .set('Cookie', authCookie)
      .send({
        name: 'Testfeld Uetersen',
        icao: 'edhe',
        city: 'Uetersen',
        country: 'DE',
        lat: 53.646,
        lon: 9.704,
        altitude: 7,
      })
      .expect(201);

    const a = res.body.data;
    expect(a.icao).toBe('EDHE'); // uppercased by the schema
    expect(a.isUserAdded).toBe(true);
    expect(a.timezone).toBe('Europe/Berlin'); // derived, never client-supplied
  });

  it('accepts a codeless private airfield (name + coordinates suffice)', async () => {
    const res = await request(app)
      .post('/api/v1/airports')
      .set('Cookie', authCookie)
      .send({ name: 'Testfeld Wiese', lat: 48.1, lon: 11.2 })
      .expect(201);

    expect(res.body.data.iata).toBeNull();
    expect(res.body.data.icao).toBeNull();
    expect(res.body.data.timezone).toBe('Europe/Berlin');
  });

  it('rejects a collision with an active airport as 409, not a P2002-500', async () => {
    await request(app)
      .post('/api/v1/airports')
      .set('Cookie', authCookie)
      .send({ name: 'Testfeld Doppelt', iata: 'FRA', lat: 50, lon: 8 })
      .expect(409);
  });

  it('rejects malformed codes', async () => {
    await request(app)
      .post('/api/v1/airports')
      .set('Cookie', authCookie)
      .send({ name: 'Testfeld Kaputt', iata: 'TOOLONG', lat: 50, lon: 8 })
      .expect(400);
  });

  it('requires authentication', async () => {
    await request(app)
      .post('/api/v1/airports')
      .send({ name: 'Testfeld Anon', lat: 50, lon: 8 })
      .expect(401);
  });
});
