import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/** Exactly-once `POST /flights` for the Companion's offline outbox (forgejo#283). */
let seq = 0;
const flight = () => {
  seq += 1;
  const day = String(seq).padStart(2, "0");
  return {
    flightNumber: `LH${3000 + seq}`,
    departure: { iata: "FRA", lat: 50.03, lon: 8.57 },
    arrival: { iata: "MUC", lat: 48.35, lon: 11.79 },
    departureLocal: `2026-12-${day}T08:00`,
    arrivalLocal: `2026-12-${day}T09:00`,
    depTimezone: "Europe/Berlin",
    arrTimezone: "Europe/Berlin",
  };
};

describe("flight clientRef", () => {
  let userId: string;
  let cookie: string;
  const post = (payload: object, query = "") =>
    request(app).post(`/api/v1/flights${query}`).set("Cookie", cookie).send(payload);
  const count = () => prisma.flight.count({ where: { userId } });

  beforeAll(async () => {
    const passwordHash = await hashPassword("isolated-test-password");
    userId = (
      await prisma.user.create({ data: { username: `flight_ref_${Date.now()}`, passwordHash } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });
  afterEach(async () => {
    await prisma.clientWriteRef.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("answers a repeat with the flight the first POST made", async () => {
    const body = { ...flight(), clientRef: "flight:one" };
    const first = await post(body, "?merge=true").expect(201);
    const again = await post(body, "?merge=true").expect(200);
    expect(again.body.flight.id).toBe(first.body.flight.id);
    expect(again.body.flight.flightNumber).toBe(body.flightNumber);
    expect(again.body.mergedFields).toBeUndefined();
    expect(await count()).toBe(1);
  });
  it("creates once for concurrent identical requests", async () => {
    const body = { ...flight(), clientRef: "flight:race" };
    const responses = await Promise.all([post(body, "?force=true"), post(body, "?force=true")]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(responses[0].body.flight.id).toBe(responses[1].body.flight.id);
    expect(await count()).toBe(1);
  });
  it("refuses the same key with a different body or other query flags", async () => {
    const body = { ...flight(), clientRef: "flight:edit" };
    const first = await post(body, "?merge=true").expect(201);
    const changed = await post({ ...body, notes: "Fensterplatz" }, "?merge=true").expect(409);
    expect(changed.body).toMatchObject({
      code: "CLIENT_REF_REUSED",
      kind: "flight",
      entityId: first.body.flight.id,
    });
    expect((await post(body, "?force=true").expect(409)).body.code).toBe("CLIENT_REF_REUSED");
    expect(await count()).toBe(1);
  });
  it("does not resurrect a deleted flight", async () => {
    const body = { ...flight(), clientRef: "flight:gone" };
    const first = await post(body).expect(201);
    await request(app)
      .delete(`/api/v1/flights/${first.body.flight.id}`)
      .set("Cookie", cookie)
      .expect(204);
    const again = await post(body).expect(410);
    expect(again.body.code).toBe("CLIENT_REF_TARGET_GONE");
    expect(await count()).toBe(0);
  });
  it("spends no key on a merge into an existing flight, which stays repeatable", async () => {
    const base = flight();
    const existing = await post(base).expect(201);
    const body = { ...base, seatNumber: "12A", clientRef: "flight:merge" };
    const merged = await post(body, "?merge=true").expect(200);
    expect(merged.body.flight.id).toBe(existing.body.flight.id);
    expect(merged.body.mergedFields).toContain("seatNumber");
    const again = await post(body, "?merge=true").expect(200);
    expect(again.body.flight.id).toBe(existing.body.flight.id);
    expect(await prisma.clientWriteRef.count({ where: { userId } })).toBe(0);
    expect(await count()).toBe(1);
  });
  it("keeps the duplicate check for a keyless repeat", async () => {
    const body = flight();
    await post(body).expect(201);
    expect((await post(body).expect(409)).body.error).toBe("DUPLICATE_FLIGHT");
    expect(await count()).toBe(1);
  });
});
