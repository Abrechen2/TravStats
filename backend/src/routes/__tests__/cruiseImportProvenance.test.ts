import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";

/**
 * Reading the same booking confirmation twice is ordinary — a forward, a
 * second copy in the inbox, a re-run after a failed import. It must not
 * produce a second cruise, and it must not answer with a 500 from a unique
 * index either: that reads as "the import is broken" rather than "you already
 * have this one".
 */
describe("cruise import — provenance", () => {
  let cookie: string[];
  let userId: string;

  const clean = async (): Promise<void> => {
    await prisma.cruiseStop.deleteMany();
    await prisma.cruise.deleteMany();
    await prisma.importBatch.deleteMany();
    await prisma.user.deleteMany();
  };

  beforeEach(async () => {
    await clean();
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: "cruise-provenance", password: "password123" })
      .expect(201);
    cookie = registration.headers["set-cookie"];
    userId = (await prisma.user.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  const booking = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    shipNameOverride: "AIDAluna",
    cruiseLine: "AIDA Cruises",
    startDate: "2026-11-15T00:00:00.000Z",
    endDate: "2026-11-22T00:00:00.000Z",
    bookingReference: "1C868387",
    ...overrides,
  });

  const makeBatch = async (): Promise<string> =>
    (
      await prisma.importBatch.create({
        data: { userId, domain: "cruise", source: "email", fileName: "AIDA.msg" },
      })
    ).id;

  it("records where an imported cruise came from and stamps its batch", async () => {
    const batchId = await makeBatch();

    await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", cookie)
      .send(booking({ importBatchId: batchId }))
      .expect(201);

    const cruise = await prisma.cruise.findFirstOrThrow();
    expect(cruise.externalRef).toBe("booking:1C868387");
    expect(cruise.importBatchId).toBe(batchId);
  });

  it("answers a second import of the same confirmation with 409, not a duplicate", async () => {
    const batchId = await makeBatch();
    await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", cookie)
      .send(booking({ importBatchId: batchId }))
      .expect(201);

    const again = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", cookie)
      .send(booking({ importBatchId: batchId }))
      .expect(409);

    expect(again.body.error).toBe("already_imported");
    expect(await prisma.cruise.count()).toBe(1);
  });

  // A cruise typed into the form carries no provenance, so two identical
  // hand-entered cruises stay possible — which they must, because a person
  // can genuinely sail the same route twice.
  it("records nothing for a cruise entered by hand", async () => {
    await request(app).post("/api/v1/cruises").set("Cookie", cookie).send(booking()).expect(201);
    await request(app).post("/api/v1/cruises").set("Cookie", cookie).send(booking()).expect(201);

    expect(await prisma.cruise.count()).toBe(2);
    expect(await prisma.cruise.count({ where: { externalRef: { not: null } } })).toBe(0);
  });

  // The batch id comes from the client; someone else's must not become a hook
  // into their undo history.
  it("ignores a batch owned by another account but still creates the cruise", async () => {
    const other = await prisma.user.create({ data: { username: "other", passwordHash: "x" } });
    const foreign = await prisma.importBatch.create({
      data: { userId: other.id, domain: "cruise", source: "email" },
    });

    await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", cookie)
      .send(booking({ importBatchId: foreign.id }))
      .expect(201);

    const cruise = await prisma.cruise.findFirstOrThrow({ where: { userId } });
    expect(cruise.importBatchId).toBeNull();
    expect(cruise.externalRef).toBeNull();
  });
});
