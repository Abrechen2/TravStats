import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";

/** "Nach Zweck filtern": `?purposeFilter=` narrows lists, the trips list and their counts. */
describe("purpose filter on lists", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let customKey: string;
  const ids: Record<string, string> = {};

  const flight = (name: string, extra: Record<string, unknown>) =>
    prisma.flight
      .create({
        data: {
          userId,
          flightNumber: name,
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
      })
      .then((f) => (ids[name] = f.id));
  const listed = async (filter: string): Promise<string[]> => {
    const res = await request(app)
      .get("/api/v1/flights")
      .query({ purposeFilter: filter })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    const rows = (Array.isArray(res.body) ? res.body : (res.body.flights ?? res.body.data)) as {
      id: string;
    }[];
    return rows.map((r) => r.id).sort();
  };

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { username: `pf-${stamp}`, passwordHash: "x" } }))
      .id;
    cookie = `auth_token=${generateToken(userId)}`;
    const custom = await prisma.customPurpose.create({
      data: { userId, name: "Kunde", kind: "business", color: "#000000", icon: "star" },
    });
    customKey = `custom:${custom.id}`;
    const trip = await prisma.trip.create({
      data: {
        userId,
        name: "Messe Hannover",
        startDate: new Date("2025-03-01T00:00:00Z"),
        endDate: new Date("2025-03-03T00:00:00Z"),
      },
    });
    ids.trip = trip.id;
    ids.otherTrip = (
      await prisma.trip.create({
        data: {
          userId,
          name: "Leer",
          startDate: new Date("2025-05-01T00:00:00Z"),
          endDate: new Date("2025-05-03T00:00:00Z"),
        },
      })
    ).id;
    await flight("FAIR", { purpose: "builtin:trade_fair", tripId: trip.id });
    await flight("BIZ", { purpose: "business" });
    await flight("CUST", { purpose: customKey });
    await flight("VAC", { purpose: "builtin:vacation" });
    await flight("NONE", {});
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("filters to one built-in, to the kind's default, to a custom purpose, a kind and unknown", async () => {
    expect(await listed("builtin:trade_fair")).toEqual([ids.FAIR]);
    // "Geschäftlich" is also what a plain business row shows.
    expect(await listed("builtin:business")).toEqual([ids.BIZ]);
    expect(await listed(customKey)).toEqual([ids.CUST]);
    expect(await listed("business")).toEqual([ids.FAIR, ids.BIZ, ids.CUST].sort());
    expect(await listed("unknown")).toEqual([ids.NONE]);
  });

  it("the trips list keeps only trips with an entry of that purpose, and its total follows", async () => {
    const res = await request(app)
      .get("/api/v1/trips")
      .query({ purposeFilter: "builtin:trade_fair" })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.trips.map((t: { id: string }) => t.id)).toEqual([ids.trip]);
    expect(res.body.total).toBe(1);
    const none = await request(app)
      .get("/api/v1/trips")
      .query({ purposeFilter: "builtin:health" })
      .set("Cookie", cookie);
    expect(none.body.total).toBe(0);
  });

  it("the lodging list (raw SQL) keeps only houses with a stay of that purpose", async () => {
    const house = async (name: string, purpose: string | null) => {
      const lodging = await prisma.lodging.create({
        data: { userId, name, city: "Hannover", lat: 52.37, lon: 9.73 },
      });
      await prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: lodging.id,
          checkIn: new Date("2024-04-01T00:00:00Z"),
          checkOut: new Date("2024-04-03T00:00:00Z"),
          status: "completed",
          purpose,
        },
      });
      return lodging.id;
    };
    const fair = await house("Messehotel", "builtin:trade_fair");
    await house("Ferienhaus", "builtin:vacation");
    await prisma.lodging.create({
      data: { userId, name: "Gemerkt", city: "Hannover", lat: 52.37, lon: 9.73 },
    });
    const res = await request(app)
      .get("/api/v1/lodging")
      .query({ purposeFilter: "builtin:trade_fair" })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.map((l: { id: string }) => l.id)).toEqual([fair]);
    expect(res.body.meta.total).toBe(1);
  });

  it("a stale custom detail reads as its kind's default, in the filter as on the chip", async () => {
    // An old app flipped the kind to private without knowing the business custom detail.
    const id = await flight("STALE", { purpose: customKey });
    await prisma.$executeRaw`UPDATE flights SET purpose = 'private' WHERE id = ${id}`;
    expect(await listed(customKey)).not.toContain(id);
    expect(await listed("builtin:private_other")).toContain(id);
    await prisma.flight.delete({ where: { id } });
  });

  it("filtered to 'unknown', a house with no stay at all is not listed", async () => {
    await prisma.lodging.create({
      data: { userId, name: "Nur gemerkt", city: "Kiel", lat: 54.3, lon: 10.1 },
    });
    const res = await request(app)
      .get("/api/v1/lodging")
      .query({ purposeFilter: "unknown" })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.map((l: { name: string }) => l.name)).not.toContain("Nur gemerkt");
  });

  it("an unknown filter value is refused, not ignored", async () => {
    const res = await request(app)
      .get("/api/v1/flights")
      .query({ purposeFilter: "builtin:nope" })
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PURPOSE_UNKNOWN");
  });

  it("usage counts each purpose by its effective key", async () => {
    const res = await request(app).get("/api/v1/purpose/usage").set("Cookie", cookie);
    expect(res.body.data.usage.flight).toEqual({
      "builtin:trade_fair": 1,
      "builtin:business": 1,
      [customKey]: 1,
      "builtin:vacation": 1,
      unknown: 1,
    });
  });
});
