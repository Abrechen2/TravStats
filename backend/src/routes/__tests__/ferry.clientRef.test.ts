import request from "supertest";
import * as documents from "../../services/documents/documentService";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { ferryCreationLimiter } from "../../middleware/ferryCreationLimiter";

const body = {
  departureStation: { name: "Kiel", lat: 54.32, lon: 10.14, country: "DE" },
  arrivalStation: { name: "Oslo", lat: 59.9, lon: 10.75, country: "NO" },
  departureLocal: "2026-10-15T14:00",
  arrivalLocal: "2026-10-16T10:00",
};

describe("ferry clientRef", () => {
  let users: string[];
  let cookies: string[];
  const post = (payload: object, account = 0) =>
    request(app).post("/api/v1/ferry").set("Cookie", cookies[account]).send(payload);

  beforeAll(async () => {
    const passwordHash = await hashPassword("isolated-test-password");
    users = [];
    for (const username of ["ferry_ref_a", "ferry_ref_b"]) {
      const user = await prisma.user.create({ data: { username, passwordHash } });
      users.push(user.id);
    }
    cookies = users.map((id) => `auth_token=${generateToken(id)}`);
  });
  afterEach(async () => {
    await prisma.clientWriteRef.deleteMany({ where: { userId: { in: users } } });
    await prisma.ferryJourney.deleteMany({ where: { userId: { in: users } } });
    for (const id of users) await ferryCreationLimiter.resetKey(`user:${id}`);
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it("replays the same row and response after a lost answer", async () => {
    const first = await post({ ...body, clientRef: "ferry:one" }).expect(201);
    const again = await post({ ...body, clientRef: "ferry:one" }).expect(200);
    expect(again.body.data).toEqual(first.body.data);
    expect(await prisma.ferryJourney.count({ where: { userId: users[0] } })).toBe(1);
  });
  it("creates once for concurrent identical requests", async () => {
    const responses = await Promise.all([
      post({ ...body, clientRef: "ferry:race" }),
      post({ ...body, clientRef: "ferry:race" }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(responses[0].body.data.id).toBe(responses[1].body.data.id);
    expect(await prisma.ferryJourney.count({ where: { userId: users[0] } })).toBe(1);
  });
  it("rejects changed content under the same key", async () => {
    await post({ ...body, clientRef: "ferry:edit" }).expect(201);
    const changed = await post({ ...body, operator: "Other", clientRef: "ferry:edit" }).expect(409);
    expect(changed.body.code).toBe("CLIENT_REF_REUSED");
  });
  it("does not resurrect a deleted crossing", async () => {
    const first = await post({ ...body, clientRef: "ferry:gone" }).expect(201);
    await prisma.ferryJourney.delete({ where: { id: first.body.data.id } });
    const again = await post({ ...body, clientRef: "ferry:gone" }).expect(410);
    expect(again.body.code).toBe("CLIENT_REF_TARGET_GONE");
  });
  it("scopes the key to its account", async () => {
    const a = await post({ ...body, clientRef: "ferry:account" }, 0).expect(201);
    const b = await post({ ...body, clientRef: "ferry:account" }, 1).expect(201);
    expect(a.body.data.id).not.toBe(b.body.data.id);
    expect((await post({ ...body, clientRef: "ferry:account" }, 1).expect(200)).body.data.id).toBe(
      b.body.data.id
    );
  });
  it("preserves intentional duplicates with different keys or without keys", async () => {
    await post({ ...body, clientRef: "ferry:a" }).expect(201);
    await post({ ...body, clientRef: "ferry:b" }).expect(201);
    await post(body).expect(201);
    await post(body).expect(201);
    expect(await prisma.ferryJourney.count({ where: { userId: users[0] } })).toBe(4);
  });
  it("rejects a malformed key without creating a crossing", async () => {
    await post({ ...body, clientRef: "bad key" }).expect(400);
    expect(await prisma.ferryJourney.count({ where: { userId: users[0] } })).toBe(0);
  });
  it("links documents atomically and preserves the attachment on replay", async () => {
    const doc = await prisma.document.create({
      data: {
        userId: users[0],
        storedName: "ferry-ref-test.pdf",
        mimetype: "application/pdf",
        sizeBytes: 1,
        sha256: "a".repeat(64),
        format: "pdf",
      },
    });
    const payload = { ...body, documentIds: [doc.id], clientRef: "ferry:doc" };
    const first = await post(payload).expect(201);
    await post(payload).expect(200);
    expect(
      (await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).ferryJourneyId
    ).toBe(first.body.data.id);
  });
  it("does not claim a key or create a crossing for another account's document", async () => {
    const doc = await prisma.document.create({
      data: {
        userId: users[1],
        storedName: "ferry-ref-other.pdf",
        mimetype: "application/pdf",
        sizeBytes: 1,
        sha256: "b".repeat(64),
        format: "pdf",
      },
    });
    const response = await post({ ...body, documentIds: [doc.id], clientRef: "ferry:foreign-doc" });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(await prisma.ferryJourney.count({ where: { userId: users[0] } })).toBe(0);
    expect(await prisma.clientWriteRef.count({ where: { userId: users[0] } })).toBe(0);
  });
  it("rolls back both crossing and key if a document cannot be linked, then permits retry", async () => {
    const doc = await prisma.document.create({
      data: {
        userId: users[0],
        storedName: "ferry-ref-rollback.pdf",
        mimetype: "application/pdf",
        sizeBytes: 1,
        sha256: "c".repeat(64),
        format: "pdf",
      },
    });
    const payload = { ...body, documentIds: [doc.id], clientRef: "ferry:rollback" };
    const spy = jest.spyOn(documents, "linkDocumentsInTx").mockResolvedValueOnce(0);
    try {
      await post(payload).expect(409);
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.ferryJourney.count({ where: { userId: users[0] } })).toBe(0);
    expect(await prisma.clientWriteRef.count({ where: { userId: users[0] } })).toBe(0);
    await post(payload).expect(201);
  });
});
