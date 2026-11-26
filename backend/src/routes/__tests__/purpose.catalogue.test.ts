import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/** The purpose catalogue: built-in purposes, custom ones and the kind behind both. */
describe("purpose catalogue", () => {
  const stamp = Date.now();
  const ids: string[] = [];
  let userId: string;
  let otherId: string;
  let cookie: string;
  let otherCookie: string;

  const mk = async (name: string): Promise<string> => {
    const user = await prisma.user.create({
      data: { username: `${name}-${stamp}`, passwordHash: await hashPassword("test-password") },
    });
    ids.push(user.id);
    return user.id;
  };
  const flight = (owner: string, extra: Record<string, unknown> = {}) =>
    prisma.flight.create({
      data: {
        userId: owner,
        depIata: "FRA",
        arrIata: "FCO",
        depLat: 50,
        depLon: 8,
        arrLat: 41,
        arrLon: 12,
        status: "flown",
        departureTime: new Date("2025-03-01T08:00:00Z"),
        arrivalTime: new Date("2025-03-01T10:00:00Z"),
        ...extra,
      },
    });
  const createCustom = (c: string, body: Record<string, unknown>) =>
    request(app).post("/api/v1/purpose/custom").set("Cookie", c).send(body);

  beforeAll(async () => {
    userId = await mk("pcat");
    otherId = await mk("pcat-other");
    cookie = `auth_token=${generateToken(userId)}`;
    otherCookie = `auth_token=${generateToken(otherId)}`;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it("lists the ten built-ins with both labels and their kind", async () => {
    const res = await request(app).get("/api/v1/purpose/catalogue").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const builtins = res.body.data.builtins as { key: string; kind: string; label: object }[];
    expect(builtins).toHaveLength(10);
    expect(builtins.find((b) => b.key === "builtin:trade_fair")).toMatchObject({
      kind: "business",
      label: { de: "Messe & Konferenz", en: "Trade fair & conference" },
    });
    expect(builtins.find((b) => b.key === "builtin:vacation")?.kind).toBe("private");
  });

  it("a built-in key stores its kind beside the key, through the entry endpoint", async () => {
    const f = await flight(userId);
    const res = await request(app)
      .put(`/api/v1/purpose/entries/flight/${f.id}`)
      .set("Cookie", cookie)
      .send({ purpose: "builtin:trade_fair" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ purpose: "business", purposeKey: "builtin:trade_fair" });
  });

  it("an old client sending business/private still works and keeps a matching detail", async () => {
    const f = await flight(userId, { purpose: "builtin:trade_fair" });
    expect(f).toMatchObject({ purpose: "business", purposeKey: "builtin:trade_fair" });
    // Re-sending the same kind (an old Companion editing another field) keeps the detail.
    const same = await request(app)
      .put(`/api/v1/flights/${f.id}`)
      .set("Cookie", cookie)
      .send({ purpose: "business" });
    expect(same.status).toBe(200);
    const kept = await prisma.flight.findUniqueOrThrow({ where: { id: f.id } });
    expect(kept).toMatchObject({ purpose: "business", purposeKey: "builtin:trade_fair" });
    // A plain private on a new entry is accepted as before.
    const legacy = await request(app)
      .put(`/api/v1/purpose/entries/flight/${f.id}`)
      .set("Cookie", cookie)
      .send({ purpose: "private" });
    expect(legacy.status).toBe(200);
    expect(legacy.body.data.purpose).toBe("private");
    // null clears both.
    const cleared = await request(app)
      .put(`/api/v1/purpose/entries/flight/${f.id}`)
      .set("Cookie", cookie)
      .send({ purpose: null });
    expect(cleared.body.data).toEqual({ purpose: null, purposeKey: null });
  });

  it("refuses an unknown key", async () => {
    const f = await flight(userId);
    const res = await request(app)
      .put(`/api/v1/purpose/entries/flight/${f.id}`)
      .set("Cookie", cookie)
      .send({ purpose: "builtin:nonsense" });
    expect(res.status).toBe(400);
  });

  it("a trip's category gives the matching detail to a new entry", async () => {
    const trip = await prisma.trip.create({
      data: {
        userId,
        name: "Weekend",
        category: "weekend",
        startDate: new Date("2025-03-01T00:00:00Z"),
        endDate: new Date("2025-03-03T00:00:00Z"),
      },
    });
    const f = await flight(userId, { tripId: trip.id });
    expect(f).toMatchObject({ purpose: "private", purposeKey: "builtin:short_break" });
  });

  describe("custom purposes", () => {
    it("create, rename, recolour and archive; deleting only while unused", async () => {
      const created = await createCustom(cookie, {
        name: "Ehrenamt",
        nameEn: "Volunteering",
        kind: "private",
        color: "#123456",
        icon: "heart",
      });
      expect(created.status).toBe(201);
      const id = created.body.data.id as string;
      expect(created.body.data).toMatchObject({ key: `custom:${id}`, usage: 0, archived: false });

      const renamed = await request(app)
        .patch(`/api/v1/purpose/custom/${id}`)
        .set("Cookie", cookie)
        .send({ name: "Verein", color: "#abcdef" });
      expect(renamed.body.data).toMatchObject({ name: "Verein", color: "#abcdef" });

      const f = await flight(userId, { purpose: `custom:${id}` });
      expect(f).toMatchObject({ purpose: "private", purposeKey: `custom:${id}` });

      const refused = await request(app)
        .delete(`/api/v1/purpose/custom/${id}`)
        .set("Cookie", cookie);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe("PURPOSE_IN_USE");

      const archived = await request(app)
        .patch(`/api/v1/purpose/custom/${id}`)
        .set("Cookie", cookie)
        .send({ archived: true });
      expect(archived.body.data).toMatchObject({ archived: true, usage: 1 });

      await prisma.flight.delete({ where: { id: f.id } });
      const deleted = await request(app)
        .delete(`/api/v1/purpose/custom/${id}`)
        .set("Cookie", cookie);
      expect(deleted.status).toBe(200);
      expect(await prisma.customPurpose.findUnique({ where: { id } })).toBeNull();
    });

    it("the kind drives the business filter, and a changed kind moves the entries", async () => {
      const created = await createCustom(cookie, {
        name: "Kundenbesuch",
        kind: "business",
        color: "#334455",
        icon: "briefcase",
      });
      const id = created.body.data.id as string;
      const f = await flight(userId, { purpose: `custom:${id}` });
      expect(f.purpose).toBe("business");

      await request(app)
        .put("/api/v1/purpose/visibility")
        .set("Cookie", cookie)
        .send({ flight: ["business"] });
      const hidden = await request(app).get("/api/v1/flights").set("Cookie", cookie);
      const listed = (body: unknown): string[] => {
        const rows = Array.isArray(body)
          ? body
          : ((body as { flights?: unknown[] }).flights ??
            (body as { data?: unknown[] }).data ??
            []);
        return (rows as { id: string }[]).map((r) => r.id);
      };
      expect(listed(hidden.body)).not.toContain(f.id);

      await request(app)
        .patch(`/api/v1/purpose/custom/${id}`)
        .set("Cookie", cookie)
        .send({ kind: "private" });
      expect((await prisma.flight.findUniqueOrThrow({ where: { id: f.id } })).purpose).toBe(
        "private"
      );
      const shown = await request(app).get("/api/v1/flights").set("Cookie", cookie);
      expect(listed(shown.body)).toContain(f.id);
      await request(app).put("/api/v1/purpose/visibility").set("Cookie", cookie).send({});
    });

    it("another account can neither use, see, change nor delete a custom purpose", async () => {
      const created = await createCustom(cookie, {
        name: "Geheim",
        kind: "private",
        color: "#000000",
        icon: "star",
      });
      const id = created.body.data.id as string;
      const theirs = await flight(otherId);
      const used = await request(app)
        .put(`/api/v1/purpose/entries/flight/${theirs.id}`)
        .set("Cookie", otherCookie)
        .send({ purpose: `custom:${id}` });
      expect(used.status).toBe(400);
      expect(used.body.code).toBe("PURPOSE_UNKNOWN");

      const catalogue = await request(app)
        .get("/api/v1/purpose/catalogue")
        .set("Cookie", otherCookie);
      expect(JSON.stringify(catalogue.body)).not.toContain("Geheim");
      const patched = await request(app)
        .patch(`/api/v1/purpose/custom/${id}`)
        .set("Cookie", otherCookie)
        .send({ name: "x" });
      expect(patched.status).toBe(404);
      const deleted = await request(app)
        .delete(`/api/v1/purpose/custom/${id}`)
        .set("Cookie", otherCookie);
      expect(deleted.status).toBe(404);
    });

    it("trip apply takes a custom key and previews the change", async () => {
      const created = await createCustom(cookie, {
        name: "Messe Hannover",
        kind: "business",
        color: "#ff0000",
        icon: "podium",
      });
      const key = `custom:${created.body.data.id}`;
      const trip = await prisma.trip.create({
        data: {
          userId,
          name: "Hannover",
          category: "vacation",
          startDate: new Date("2025-04-01T00:00:00Z"),
          endDate: new Date("2025-04-03T00:00:00Z"),
        },
      });
      const f = await flight(userId, { tripId: trip.id });
      const preview = await request(app)
        .get(`/api/v1/purpose/trips/${trip.id}/apply`)
        .query({ purpose: key })
        .set("Cookie", cookie);
      expect(preview.body.data).toMatchObject({
        purpose: "business",
        purposeKey: key,
        wouldChange: 1,
      });
      const applied = await request(app)
        .post(`/api/v1/purpose/trips/${trip.id}/apply`)
        .set("Cookie", cookie)
        .send({ purpose: key });
      expect(applied.body.data).toMatchObject({ purpose: "business", purposeKey: key, changed: 1 });
      expect(await prisma.flight.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({
        purpose: "business",
        purposeKey: key,
      });
    });
  });
});
