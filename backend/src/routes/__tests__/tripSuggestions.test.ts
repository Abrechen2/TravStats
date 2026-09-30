import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";
import { acceptSuggestion } from "../../services/tripSuggestions/accept";
import { computeTripSuggestions } from "../../services/tripSuggestions/engine";
import type { TripSuggestion } from "../../services/tripSuggestions/types";

/**
 * `/api/v1/trip-suggestions` against a real database: what the inbox lists,
 * what accepting writes (and, on failure, does not), what dismissing remembers,
 * and whose data any of it may touch.
 */

const FLORENCE = { lat: 43.7765, lon: 11.2479 };
const ROMA = { lat: 41.901, lon: 12.5006 };
const MUNICH_HBF = { lat: 48.1402, lon: 11.5586 };

describe("/api/v1/trip-suggestions", () => {
  const stamp = Date.now();
  let userId: string;
  let strangerId: string;
  let cookie: string;
  let strangerCookie: string;
  let betaBefore: boolean;

  const makeUser = async (name: string): Promise<string> => {
    const passwordHash = await hashPassword("test-password");
    const user = await prisma.user.create({ data: { username: `${name}-${stamp}`, passwordHash } });
    await prisma.userSettings.create({
      data: {
        userId: user.id,
        enabledDomains: ["flight", "cruise", "lodging", "poi", "roadtrip", "rail"],
        data: { homeAirportHistory: [{ iata: "MUC", fromDate: "2000-01-01", toDate: null }] },
      },
    });
    return user.id;
  };

  /** A week in Italy: two stays and a place visit, no flight. */
  const seedItaly = async (owner: string) => {
    const hotel = (name: string, at: typeof FLORENCE) =>
      prisma.lodging.create({ data: { userId: owner, name, city: name, ...at } });
    const florence = await hotel("Florenz", FLORENCE);
    const rome = await hotel("Rom", ROMA);
    const stayA = await prisma.lodgingStay.create({
      data: {
        userId: owner,
        lodgingId: florence.id,
        checkIn: new Date("2025-05-03T00:00:00Z"),
        checkOut: new Date("2025-05-06T00:00:00Z"),
      },
    });
    const stayB = await prisma.lodgingStay.create({
      data: {
        userId: owner,
        lodgingId: rome.id,
        checkIn: new Date("2025-05-06T00:00:00Z"),
        checkOut: new Date("2025-05-09T00:00:00Z"),
      },
    });
    const place = await prisma.place.create({
      data: { userId: owner, name: "Kolosseum", lat: 41.8902, lon: 12.4922, visited: true },
    });
    const visit = await prisma.placeVisit.create({
      data: { userId: owner, placeId: place.id, visitedAt: new Date("2025-05-07T00:00:00Z") },
    });
    return { stayA, stayB, visit, place };
  };

  const list = async (c = cookie) => {
    const res = await request(app).get("/api/v1/trip-suggestions").set("Cookie", c);
    expect(res.status).toBe(200);
    return res.body.data as { suggestions: TripSuggestion[]; total: number; home: string };
  };

  const clearTravel = async (owner: string) => {
    await prisma.tripSuggestionDecision.deleteMany({ where: { userId: owner } });
    await prisma.placeVisit.deleteMany({ where: { userId: owner } });
    await prisma.place.deleteMany({ where: { userId: owner } });
    await prisma.lodgingStay.deleteMany({ where: { userId: owner } });
    await prisma.lodging.deleteMany({ where: { userId: owner } });
    await prisma.railJourney.deleteMany({ where: { userId: owner } });
    await prisma.trip.deleteMany({ where: { userId: owner } });
  };

  beforeAll(async () => {
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    userId = await makeUser("ts-owner");
    strangerId = await makeUser("ts-stranger");
    cookie = `auth_token=${generateToken(userId)}`;
    strangerCookie = `auth_token=${generateToken(strangerId)}`;
  });

  beforeEach(async () => {
    await clearTravel(userId);
    await clearTravel(strangerId);
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  it("lists a cross-domain week as one new-trip proposal, and counts it", async () => {
    await seedItaly(userId);
    const data = await list();
    expect(data.home).toBe("history");
    const trips = data.suggestions.filter((s) => s.kind === "new_trip");
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ startDay: "2025-05-03", endDay: "2025-05-09", nights: 6 });
    expect(trips[0].members).toHaveLength(3);

    const count = await request(app).get("/api/v1/trip-suggestions/count").set("Cookie", cookie);
    expect(count.body.data.count).toBe(data.total);
  });

  it("accepts in one go: the trip, its dates, every chosen member, the answer", async () => {
    const { stayA, stayB, visit } = await seedItaly(userId);
    const [proposal] = (await list()).suggestions.filter((s) => s.kind === "new_trip");

    const res = await request(app)
      .post(`/api/v1/trip-suggestions/${encodeURIComponent(proposal.id)}/accept`)
      .set("Cookie", cookie)
      .send({
        name: "Italien · Mai 2025",
        memberKeys: [`lodging:${stayA.id}`, `lodging:${stayB.id}`],
      });

    expect(res.status).toBe(200);
    const tripId = res.body.data.tripId as string;
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip).toMatchObject({ userId, name: "Italien · Mai 2025" });
    expect(trip.startDate?.toISOString().slice(0, 10)).toBe("2025-05-03");
    expect(trip.endDate?.toISOString().slice(0, 10)).toBe("2025-05-09");
    expect(
      (await prisma.lodgingStay.findMany({ where: { tripId } })).map((s) => s.id).sort()
    ).toEqual([stayA.id, stayB.id].sort());
    // Deselected before accepting: stays out of the trip.
    expect(
      (await prisma.placeVisit.findUniqueOrThrow({ where: { id: visit.id } })).tripId
    ).toBeNull();
    const decision = await prisma.tripSuggestionDecision.findFirstOrThrow({
      where: { userId, status: "accepted" },
    });
    expect(decision).toMatchObject({ status: "accepted", createdTripId: tripId });

    // Acceptance D3: the unticked visit is an answer too — it does not come
    // straight back as "belongs to a trip?" for the trip just created.
    const after = (await list()).suggestions;
    expect(after.flatMap((s) => s.members.map((m) => m.key))).not.toContain(`place:${visit.id}`);
    expect(
      await prisma.tripSuggestionDecision.findFirst({
        where: { userId, status: "dismissed", targetId: tripId },
      })
    ).toMatchObject({ kind: "assign", memberKeys: [`place:${visit.id}`] });
  });

  it("rolls everything back when one member moved in the meantime", async () => {
    const { stayA, stayB } = await seedItaly(userId);
    const { suggestions } = await computeTripSuggestions(userId);
    const proposal = suggestions.find((s) => s.kind === "new_trip")!;
    // Someone put one stay on a trip between showing and answering.
    const other = await prisma.trip.create({ data: { userId, name: "Elsewhere" } });
    await prisma.lodgingStay.update({ where: { id: stayB.id }, data: { tripId: other.id } });

    await expect(acceptSuggestion(userId, proposal, {})).rejects.toMatchObject({
      statusCode: 409,
      code: "TRIP_SUGGESTION_STALE",
    });
    expect(await prisma.trip.count({ where: { userId } })).toBe(1);
    expect(
      (await prisma.lodgingStay.findUniqueOrThrow({ where: { id: stayA.id } })).tripId
    ).toBeNull();
    expect(await prisma.tripSuggestionDecision.count({ where: { userId } })).toBe(0);
  });

  it("refuses a stale id with a code the client can name, and changes nothing", async () => {
    await seedItaly(userId);
    const res = await request(app)
      .post("/api/v1/trip-suggestions/new_trip:-:0000000000000000/accept")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TRIP_SUGGESTION_STALE");
    expect(await prisma.trip.count({ where: { userId } })).toBe(0);
  });

  it("refuses members the proposal does not hold", async () => {
    await seedItaly(userId);
    const [proposal] = (await list()).suggestions.filter((s) => s.kind === "new_trip");
    const res = await request(app)
      .post(`/api/v1/trip-suggestions/${encodeURIComponent(proposal.id)}/accept`)
      .set("Cookie", cookie)
      .send({ memberKeys: ["flight:not-in-it"] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRIP_SUGGESTION_SELECTION_INVALID");
    expect(await prisma.trip.count({ where: { userId } })).toBe(0);
  });

  it("remembers a dismissal", async () => {
    await seedItaly(userId);
    const [proposal] = (await list()).suggestions.filter((s) => s.kind === "new_trip");
    const res = await request(app)
      .post(`/api/v1/trip-suggestions/${encodeURIComponent(proposal.id)}/dismiss`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect((await list()).suggestions.filter((s) => s.kind === "new_trip")).toEqual([]);
    expect(await prisma.trip.count({ where: { userId } })).toBe(0);
  });

  it("records a visit to an own place beside a stay, and promotes the place", async () => {
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel Brunelleschi", ...FLORENCE },
    });
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkIn: new Date("2025-05-03T00:00:00Z"),
        checkOut: new Date("2025-05-06T00:00:00Z"),
      },
    });
    const cafe = await prisma.place.create({
      data: { userId, name: "Caffè Gilli", lat: FLORENCE.lat + 0.0027, lon: FLORENCE.lon },
    });
    const proposal = (await list()).suggestions.find((s) => s.kind === "place_visit")!;
    expect(proposal.place?.id).toBe(cafe.id);

    const res = await request(app)
      .post(`/api/v1/trip-suggestions/${encodeURIComponent(proposal.id)}/accept`)
      .set("Cookie", cookie)
      .send({ visitDay: "2025-05-04" });
    expect(res.status).toBe(200);
    const visit = await prisma.placeVisit.findUniqueOrThrow({
      where: { id: res.body.data.placeVisitId },
    });
    expect(visit.visitedAt?.toISOString().slice(0, 10)).toBe("2025-05-04");
    expect((await prisma.place.findUniqueOrThrow({ where: { id: cafe.id } })).visited).toBe(true);
  });

  it("shows nobody else's entries, and lets nobody else answer", async () => {
    await seedItaly(userId);
    const [proposal] = (await list()).suggestions.filter((s) => s.kind === "new_trip");

    expect((await list(strangerCookie)).suggestions).toEqual([]);
    const res = await request(app)
      .post(`/api/v1/trip-suggestions/${encodeURIComponent(proposal.id)}/accept`)
      .set("Cookie", strangerCookie)
      .send({});
    expect(res.status).toBe(409);
    expect(await prisma.trip.count({ where: { userId: strangerId } })).toBe(0);
    expect(await prisma.lodgingStay.count({ where: { userId, tripId: { not: null } } })).toBe(0);
  });

  it("keeps rides out while the instance hides the rail domain", async () => {
    const ride = (dep: string, arr: string, from: typeof FLORENCE, to: typeof FLORENCE) =>
      prisma.railJourney.create({
        data: {
          userId,
          status: "completed",
          depStationName: "A",
          arrStationName: "B",
          depLat: from.lat,
          depLon: from.lon,
          arrLat: to.lat,
          arrLon: to.lon,
          depTimezone: "Europe/Rome",
          arrTimezone: "Europe/Rome",
          departureTime: new Date(dep),
          arrivalTime: new Date(arr),
        },
      });
    await seedItaly(userId);
    await ride("2025-05-03T05:00:00Z", "2025-05-03T12:00:00Z", MUNICH_HBF, FLORENCE);

    await updateInstanceSettings({ betaFeaturesEnabled: false });
    const hidden = (await list()).suggestions.flatMap((s) => s.members.map((m) => m.domain));
    expect(hidden).not.toContain("rail");

    await updateInstanceSettings({ betaFeaturesEnabled: true });
    const shown = (await list()).suggestions.flatMap((s) => s.members.map((m) => m.domain));
    expect(shown).toContain("rail");
  });
});
