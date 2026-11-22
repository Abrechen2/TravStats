import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { ENTRY_SCOPE_PREFIXES } from "../../services/provenance/recordedOnly";

/** Tours and roadtrips carry the same private/business purpose as every other entry. */
describe("purpose: tours and roadtrips", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let tripId: string;

  const get = (path: string) => request(app).get(path).set("Cookie", cookie);
  const post = (path: string, body: unknown) =>
    request(app).post(path).set("Cookie", cookie).send(body);

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: `purpose-tour-${stamp}`, passwordHash: await hashPassword("x") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    tripId = (
      await prisma.trip.create({
        data: {
          userId,
          name: "Messe",
          category: "business",
          startDate: new Date("2025-03-01T00:00:00Z"),
          endDate: new Date("2025-03-05T00:00:00Z"),
        },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("a tour and a roadtrip created inside a business trip start as business", async () => {
    const tour = await post("/api/v1/tours", { name: "Stadtlauf", mode: "foot", tripId }).expect(
      201
    );
    expect(tour.body.route.purpose).toBe("business");
    const roadtrip = await post("/api/v1/roadtrips", { name: "Rundreise", tripId }).expect(201);
    expect(roadtrip.body.roadtrip.purpose).toBe("business");
  });

  it("an explicit purpose wins over the trip, and PATCH sets and clears it", async () => {
    const tour = await post("/api/v1/tours", {
      name: "Wandern",
      mode: "foot",
      tripId,
      purpose: "private",
    }).expect(201);
    expect(tour.body.route.purpose).toBe("private");
    const id = tour.body.route.id as string;
    const set = await request(app)
      .patch(`/api/v1/tours/${id}`)
      .set("Cookie", cookie)
      .send({ purpose: "business" })
      .expect(200);
    expect(set.body.route.purpose).toBe("business");
    // Omitting it leaves the stored value; null clears it.
    const kept = await request(app)
      .patch(`/api/v1/tours/${id}`)
      .set("Cookie", cookie)
      .send({ name: "Wandern 2" })
      .expect(200);
    expect(kept.body.route.purpose).toBe("business");
    const cleared = await request(app)
      .patch(`/api/v1/tours/${id}`)
      .set("Cookie", cookie)
      .send({ purpose: null })
      .expect(200);
    expect(cleared.body.route.purpose).toBeNull();
    await request(app)
      .put(`/api/v1/purpose/entries/tripRoute/${id}`)
      .set("Cookie", cookie)
      .send({ purpose: "private" })
      .expect(200);
  });

  it("hiding business tours and roadtrips leaves them out of both lists and counts them", async () => {
    const before = await get("/api/v1/tours").expect(200);
    const roadsBefore = await get("/api/v1/roadtrips").expect(200);
    expect(
      (before.body.tours as Array<{ purpose: string | null }>).some((t) => t.purpose === "business")
    ).toBe(true);
    await request(app)
      .put("/api/v1/purpose/visibility")
      .set("Cookie", cookie)
      .send({ tour: ["business"], roadtrip: ["business"] })
      .expect(200);

    const after = await get("/api/v1/tours").expect(200);
    expect(
      (after.body.tours as Array<{ purpose: string | null }>).some((t) => t.purpose === "business")
    ).toBe(false);
    expect((after.body.tours as unknown[]).length).toBeLessThan(
      (before.body.tours as unknown[]).length
    );
    const roadsAfter = await get("/api/v1/roadtrips").expect(200);
    expect(JSON.stringify(roadsBefore.body)).toContain('"business"');
    expect(JSON.stringify(roadsAfter.body)).not.toContain('"business"');

    const hidden = await get("/api/v1/purpose/hidden").expect(200);
    expect(hidden.body.data.hidden.tour.business).toBeGreaterThan(0);
    expect(hidden.body.data.hidden.roadtrip.business).toBeGreaterThan(0);
  });

  it("the scope covers tours, roadtrips and the visit-suggestion inboxes", () => {
    for (const prefix of [
      "/api/v1/tours",
      "/api/v1/roadtrips",
      "/api/v1/place-lists",
      "/api/v1/dawarich-stays",
      "/api/v1/location-suggestions",
    ]) {
      expect(ENTRY_SCOPE_PREFIXES).toContain(prefix);
    }
  });
});
