import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";
import {
  computeTripSuggestions,
  invalidateTripSuggestions,
} from "../../services/tripSuggestions/engine";
import { prefillTourDateFromTrack } from "../../services/tour/tourDay";

/**
 * Acceptance D2 (2026-09-26): a standalone day tour could not be dated — no
 * date in "Neue Tour", none on its points, `tourPointsSchema` took none — so
 * the trip suggestions, which read days, could never include one although
 * What's New promised it. A tour now carries its local day and an optional
 * start time; a recording's start prefills the day; the engine reads either.
 */

const FLORENCE = { lat: 43.7765, lon: 11.2479 };
const FIESOLE = { lat: 43.8067, lon: 11.2936 };

describe("a day tour's date", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let betaBefore: boolean;

  beforeAll(async () => {
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    const user = await prisma.user.create({
      data: { username: `tour-date-${stamp}`, passwordHash: await hashPassword("test-password") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.userSettings.create({
      data: {
        userId,
        enabledDomains: ["flight", "lodging", "roadtrip"],
        data: { homeAirportHistory: [{ iata: "MUC", fromDate: "2000-01-01", toDate: null }] },
      },
    });
  });

  beforeEach(async () => {
    await prisma.tripSuggestionDecision.deleteMany({ where: { userId } });
    await prisma.tripRoute.deleteMany({ where: { userId } });
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const stayInFlorence = async () => {
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel Brunelleschi", city: "Florenz", ...FLORENCE },
    });
    return prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkIn: new Date("2025-05-03T00:00:00Z"),
        checkOut: new Date("2025-05-06T00:00:00Z"),
      },
    });
  };

  const createTour = async (body: Record<string, unknown>) =>
    request(app)
      .post("/api/v1/tours")
      .set("Cookie", cookie)
      .send({ name: "Fiesole", mode: "foot", ...body });

  it("takes a date and a start time on create, and answers them as it took them", async () => {
    const res = await createTour({ date: "2025-05-04", startTime: "08:30" });
    expect(res.status).toBe(201);
    expect(res.body.route).toMatchObject({ date: "2025-05-04", startTime: "08:30" });

    const list = await request(app).get("/api/v1/tours").set("Cookie", cookie);
    const row = list.body.tours.find((t: { id: string }) => t.id === res.body.route.id);
    expect(row).toMatchObject({ date: "2025-05-04", startTime: "08:30" });
  });

  it("edits and clears the date; a start time without a day is refused", async () => {
    const created = await createTour({});
    const id = created.body.route.id as string;

    const orphanTime = await request(app)
      .patch(`/api/v1/tours/${id}`)
      .set("Cookie", cookie)
      .send({ startTime: "09:00" });
    expect(orphanTime.status).toBe(400);

    const dated = await request(app)
      .patch(`/api/v1/tours/${id}`)
      .set("Cookie", cookie)
      .send({ date: "2025-05-04", startTime: "09:15" });
    expect(dated.body.route).toMatchObject({ date: "2025-05-04", startTime: "09:15" });

    const cleared = await request(app)
      .patch(`/api/v1/tours/${id}`)
      .set("Cookie", cookie)
      .send({ date: null });
    expect(cleared.body.route).toMatchObject({ date: null, startTime: null });

    const badDay = await createTour({ date: "2025-02-30" });
    expect(badDay.status).toBe(400);
  });

  it("puts a dated standalone tour into the trip proposal of its days", async () => {
    const hotel = await stayInFlorence();
    const created = await createTour({ date: "2025-05-04" });
    const id = created.body.route.id as string;
    // The points carry no date — only the tour does.
    await request(app)
      .put(`/api/v1/tours/${id}/points`)
      .set("Cookie", cookie)
      .send({
        points: [
          { title: "Florenz", ...FLORENCE },
          { title: "Fiesole", ...FIESOLE },
        ],
      });

    invalidateTripSuggestions(userId);
    const { suggestions } = await computeTripSuggestions(userId);
    const [proposal] = suggestions.filter((s) => s.kind === "new_trip");
    expect(proposal?.members.map((m) => m.key).sort()).toEqual(
      [`lodging:${hotel.id}`, `tour:${id}`].sort()
    );
    expect(proposal.members.find((m) => m.domain === "tour")).toMatchObject({
      startDay: "2025-05-04",
      endDay: "2025-05-04",
    });
  });

  it("prefills the date from a recording's local start day, never over the user's", async () => {
    const created = await createTour({});
    const id = created.body.route.id as string;
    // 23:30 UTC on the 4th is 01:30 on the 5th in Florence.
    const track = {
      startedAt: new Date("2025-05-04T23:30:00Z"),
      geometry: [
        [FLORENCE.lon, FLORENCE.lat],
        [FIESOLE.lon, FIESOLE.lat],
      ],
    };
    await prefillTourDateFromTrack(id, track);
    const read = await request(app).get(`/api/v1/tours/${id}`).set("Cookie", cookie);
    expect(read.body.route.date).toBe("2025-05-05");

    await request(app)
      .patch(`/api/v1/tours/${id}`)
      .set("Cookie", cookie)
      .send({ date: "2025-05-03" });
    await prefillTourDateFromTrack(id, track);
    const kept = await request(app).get(`/api/v1/tours/${id}`).set("Cookie", cookie);
    expect(kept.body.route.date).toBe("2025-05-03");
  });
});
