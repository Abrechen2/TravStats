/**
 * AUD-088, AUD-089 and AUD-090: three things a cruise PATCH let through that a
 * cruise POST does not.
 *
 * The create path validates chronology, and checks that an import batch really
 * belongs to the caller. The update path saw only the fields that arrived, so
 * it could not judge the state they would produce — and it could not express
 * "clear this date" at all, because the schema turned an explicit null into an
 * omitted field.
 */
import request from 'supertest';
import app from '../../index';
import { prisma } from '../../db';
import { hashPassword } from '../../utils/password';
import { generateToken } from '../../utils/jwt';

const USERS = ['cruisepatch', 'cruisepatchother'];

describe('a cruise PATCH is held to the same rules as a POST', () => {
  let cookie: string;
  let userId: string;
  let otherUserId: string;

  const cleanup = async (): Promise<void> => {
    await prisma.cruise.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.importBatch.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword('password123') },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;

    const other = await prisma.user.create({
      data: { username: USERS[1], passwordHash: await hashPassword('password123') },
    });
    otherUserId = other.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  /** A saved cruise running 1–8 June 2025. */
  async function makeCruise(): Promise<string> {
    const cruise = await prisma.cruise.create({
      data: {
        userId,
        cruiseLine: 'Testreederei',
        startDate: new Date('2025-06-01T00:00:00Z'),
        endDate: new Date('2025-06-08T00:00:00Z'),
        status: 'completed',
      },
    });
    return cruise.id;
  }

  const patch = (id: string, body: unknown) =>
    request(app).patch(`/api/v1/cruises/${id}`).set('Cookie', cookie).send(body);

  describe('AUD-088 — the dates it would END UP with have to make sense', () => {
    it('refuses a full swap that a POST would also refuse', async () => {
      const id = await makeCruise();

      const res = await patch(id, {
        startDate: '2025-06-10T00:00:00.000Z',
        endDate: '2025-06-01T00:00:00.000Z',
      });

      expect(res.status).toBe(400);
      // Refused BEFORE any mutation — the row is untouched, not half-written.
      const after = await prisma.cruise.findUniqueOrThrow({ where: { id } });
      expect(after.startDate?.toISOString()).toBe('2025-06-01T00:00:00.000Z');
      expect(after.endDate?.toISOString()).toBe('2025-06-08T00:00:00.000Z');
    });

    it('refuses a ONE-SIDED end moved behind the stored start', async () => {
      // The case the payload alone cannot see: nothing in this request is
      // wrong by itself.
      const id = await makeCruise();

      const res = await patch(id, { endDate: '2025-05-01T00:00:00.000Z' });

      expect(res.status).toBe(400);
      expect(
        (await prisma.cruise.findUniqueOrThrow({ where: { id } })).endDate?.toISOString(),
      ).toBe('2025-06-08T00:00:00.000Z');
    });

    it('still accepts an ordinary date change', async () => {
      const id = await makeCruise();

      const res = await patch(id, { endDate: '2025-06-12T00:00:00.000Z' });

      expect(res.status).toBe(200);
      expect(
        (await prisma.cruise.findUniqueOrThrow({ where: { id } })).endDate?.toISOString(),
      ).toBe('2025-06-12T00:00:00.000Z');
    });
  });

  describe('AUD-089 — a date can be cleared again', () => {
    it('clears both dates on an explicit null', async () => {
      const id = await makeCruise();

      const res = await patch(id, { startDate: null, endDate: null });

      expect(res.status).toBe(200);
      const after = await prisma.cruise.findUniqueOrThrow({ where: { id } });
      // Both used to survive: the schema turned null into "field omitted", so
      // the request answered 200 and changed nothing, for ever.
      expect(after.startDate).toBeNull();
      expect(after.endDate).toBeNull();
    });

    it('clears on an empty string too, which is what an emptied input sends', async () => {
      const id = await makeCruise();

      const res = await patch(id, { startDate: '', endDate: '' });

      expect(res.status).toBe(200);
      const after = await prisma.cruise.findUniqueOrThrow({ where: { id } });
      expect(after.startDate).toBeNull();
      expect(after.endDate).toBeNull();
    });

    it('leaves an omitted date alone', async () => {
      // The control. Clearing and not mentioning must stay different requests.
      const id = await makeCruise();

      const res = await patch(id, { cruiseLine: 'Andere Reederei' });

      expect(res.status).toBe(200);
      const after = await prisma.cruise.findUniqueOrThrow({ where: { id } });
      expect(after.startDate?.toISOString()).toBe('2025-06-01T00:00:00.000Z');
      expect(after.cruiseLine).toBe('Andere Reederei');
    });
  });

  describe("AUD-090 — a cruise cannot join a stranger's import run", () => {
    it("drops a batch id belonging to someone else", async () => {
      const foreign = await prisma.importBatch.create({
        data: { userId: otherUserId, domain: 'cruise', source: 'csv', fileName: 'theirs.csv' },
      });
      const id = await makeCruise();

      const res = await patch(id, { importBatchId: foreign.id });

      expect(res.status).toBe(200);
      // Dropped, not stored: the other account's import list counted a cruise
      // its own content query could not show.
      expect((await prisma.cruise.findUniqueOrThrow({ where: { id } })).importBatchId).toBeNull();
    });

    it("keeps the caller's OWN batch id", async () => {
      const mine = await prisma.importBatch.create({
        data: { userId, domain: 'cruise', source: 'csv', fileName: 'mine.csv' },
      });
      const id = await makeCruise();

      const res = await patch(id, { importBatchId: mine.id });

      expect(res.status).toBe(200);
      expect((await prisma.cruise.findUniqueOrThrow({ where: { id } })).importBatchId).toBe(mine.id);
    });

    it("drops a batch id from the caller's own but WRONG domain", async () => {
      // Same check the create path makes: provenance has to match the thing.
      const lodgingBatch = await prisma.importBatch.create({
        data: { userId, domain: 'lodging', source: 'csv', fileName: 'hotels.csv' },
      });
      const id = await makeCruise();

      const res = await patch(id, { importBatchId: lodgingBatch.id });

      expect(res.status).toBe(200);
      expect((await prisma.cruise.findUniqueOrThrow({ where: { id } })).importBatchId).toBeNull();
    });
  });
});
