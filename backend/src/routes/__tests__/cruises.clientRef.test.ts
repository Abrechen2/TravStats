import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/** Exactly-once `POST /cruises` for the Companion's offline outbox (forgejo#283). */
const body = {
  cruiseLine: "Ref Line",
  routeName: "Fjorde",
  startDate: "2026-08-01T12:00:00Z",
  endDate: "2026-08-08T10:00:00Z",
};

describe("cruise clientRef", () => {
  let userId: string;
  let cookie: string;
  const post = (payload: object) =>
    request(app).post("/api/v1/cruises").set("Cookie", cookie).send(payload);
  const count = () => prisma.cruise.count({ where: { userId } });

  beforeAll(async () => {
    const passwordHash = await hashPassword("isolated-test-password");
    userId = (
      await prisma.user.create({ data: { username: `cruise_ref_${Date.now()}`, passwordHash } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });
  afterEach(async () => {
    await prisma.clientWriteRef.deleteMany({ where: { userId } });
    await prisma.cruise.deleteMany({ where: { userId } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("answers a repeat with the cruise the first POST made", async () => {
    const first = await post({ ...body, clientRef: "cruise:one" }).expect(201);
    const again = await post({ ...body, clientRef: "cruise:one" }).expect(200);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(again.body.data.routeName).toBe("Fjorde");
    expect(await count()).toBe(1);
  });
  it("creates once for concurrent identical requests", async () => {
    const responses = await Promise.all([
      post({ ...body, clientRef: "cruise:race" }),
      post({ ...body, clientRef: "cruise:race" }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await count()).toBe(1);
  });
  it("refuses the same key with a different body", async () => {
    const first = await post({ ...body, clientRef: "cruise:edit" }).expect(201);
    const changed = await post({ ...body, routeName: "Other", clientRef: "cruise:edit" }).expect(
      409
    );
    expect(changed.body).toMatchObject({
      code: "CLIENT_REF_REUSED",
      kind: "cruise",
      entityId: first.body.data.id,
    });
    expect(await count()).toBe(1);
  });
  it("does not resurrect a deleted cruise", async () => {
    const first = await post({ ...body, clientRef: "cruise:gone" }).expect(201);
    await request(app)
      .delete(`/api/v1/cruises/${first.body.data.id}`)
      .set("Cookie", cookie)
      .expect(204);
    const again = await post({ ...body, clientRef: "cruise:gone" }).expect(410);
    expect(again.body.code).toBe("CLIENT_REF_TARGET_GONE");
    expect(await count()).toBe(0);
  });
  it("keeps creating without a key", async () => {
    await post(body).expect(201);
    await post(body).expect(201);
    expect(await count()).toBe(2);
  });
  it("files documents with the cruise and keeps them there on a repeat", async () => {
    const doc = await prisma.document.create({
      data: {
        userId,
        storedName: "cruise-ref.pdf",
        mimetype: "application/pdf",
        sizeBytes: 1,
        sha256: "d".repeat(64),
        format: "pdf",
      },
    });
    try {
      const payload = { ...body, documentIds: [doc.id], clientRef: "cruise:doc" };
      const first = await post(payload).expect(201);
      await post(payload).expect(200);
      const filed = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
      expect(filed.cruiseId).toBe(first.body.data.id);
    } finally {
      await prisma.document.deleteMany({ where: { id: doc.id } });
    }
  });
});
