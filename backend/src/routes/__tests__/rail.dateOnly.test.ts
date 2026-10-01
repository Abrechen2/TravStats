import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { railCreationLimiter } from "../../middleware/rateLimit";
import { createDocument } from "../../services/documents/documentService";
import { sweepStatuses } from "../../services/statusSweep";
import { localDay } from "../../shared/time/instant";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";

/**
 * forgejo#132 item 17 (owner, 2026-10-01). A train ride may be logged with
 * its days only — a ticket that prints no time — and is then treated like a
 * date-only flight everywhere: no duration, no delay, no night train by the
 * clock, and "over" only when its day is. Its SOURCE is read from the
 * originals filed with it, never a field a client sets.
 */

const BERLIN = { name: "Berlin Hbf", lat: 52.5251, lon: 13.3694, country: "DE" };
const MUNICH = { name: "München Hbf", lat: 48.1402, lon: 11.5583, country: "DE" };

const DAY_MS = 24 * 60 * 60 * 1000;
const berlinDay = (offsetDays: number): string =>
  localDay(new Date(Date.now() + offsetDays * DAY_MS), "Europe/Berlin");

describe("rail rides logged date-only, and their source", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let betaBefore: boolean;

  const create = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/rail").set("Cookie", cookie).send(body);
  const ride = (extra: Record<string, unknown> = {}) => ({
    operator: "DB Fernverkehr",
    trainCategory: "ICE",
    departureStation: BERLIN,
    arrivalStation: MUNICH,
    departureLocal: "2025-03-05",
    arrivalLocal: "2025-03-06",
    ...extra,
  });

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: `rail-day-${stamp}`, passwordHash } }))
      .id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.userSettings.create({
      data: { userId, enabledDomains: ["flight", "rail"], data: {} },
    });
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await updateInstanceSettings({ betaFeaturesEnabled: true });
  });

  afterEach(async () => {
    await prisma.document.deleteMany({ where: { userId } });
    await prisma.railJourney.deleteMany({ where: { userId } });
    await railCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  describe("writing a ride without a clock", () => {
    it("stores the day at the station with precision day, never a 00:00 departure", async () => {
      const res = await create(ride());
      expect(res.status).toBe(201);
      const { data } = res.body;
      expect(data.depPrecision).toBe("day");
      expect(data.arrPrecision).toBe("day");
      expect(data.times.departure.precision).toBe("day");
      expect(data.times.departure.local.slice(0, 10)).toBe("2025-03-05");
      expect(data.times.departure.zone).toBe("Europe/Berlin");
      // The start of the 5th in Berlin, not midnight UTC.
      expect(data.times.departure.utc).toBe("2025-03-04T23:00:00.000Z");
      expect(data.times.arrival.precision).toBe("day");
      expect(data.status).toBe("completed");
    });

    it("refuses a delay on a ride with no clock, naming the field", async () => {
      const res = await create(ride({ delayMinutes: 12 }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("RAIL_INVALID_INPUT");
      expect(res.body.field).toBe("delayMinutes");
    });

    it("refuses an arrival day before the departure day", async () => {
      const res = await create(ride({ departureLocal: "2025-03-06", arrivalLocal: "2025-03-05" }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("RAIL_ARRIVAL_BEFORE_DEPARTURE");
    });

    it("accepts a clocked arrival on the departure day of a dateless departure", async () => {
      const res = await create(ride({ arrivalLocal: "2025-03-05T08:00" }));
      expect(res.status).toBe(201);
      expect(res.body.data.depPrecision).toBe("day");
      expect(res.body.data.arrPrecision).toBe("minute");
    });

    it("refuses a day that does not exist", async () => {
      const res = await create(ride({ departureLocal: "2025-02-30", arrivalLocal: null }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("RAIL_INVALID_INPUT");
      expect(res.body.field).toBe("departureLocal");
    });

    it("clears a stored delay when an edit takes the clock away", async () => {
      const created = await create(
        ride({
          departureLocal: "2025-03-05T08:00",
          arrivalLocal: "2025-03-05T12:30",
          delayMinutes: 7,
        })
      );
      expect(created.body.data.delayMinutes).toBe(7);
      const res = await request(app)
        .patch(`/api/v1/rail/${created.body.data.id}`)
        .set("Cookie", cookie)
        .send({ departureLocal: "2025-03-05", arrivalLocal: null });
      expect(res.status).toBe(200);
      expect(res.body.data.depPrecision).toBe("day");
      expect(res.body.data.delayMinutes).toBeNull();
    });

    it("keeps the day, not 00:00, when an edit moves the station of a dateless ride", async () => {
      const created = await create(ride());
      const res = await request(app)
        .patch(`/api/v1/rail/${created.body.data.id}`)
        .set("Cookie", cookie)
        .send({ notes: "moved", departureStation: { ...BERLIN, name: "Berlin Südkreuz" } });
      expect(res.status).toBe(200);
      expect(res.body.data.depPrecision).toBe("day");
      expect(res.body.data.times.departure.local.slice(0, 10)).toBe("2025-03-05");
    });

    it("is not over at the midnight its day is stored as", async () => {
      const today = berlinDay(0);
      const res = await create(ride({ departureLocal: today, arrivalLocal: null }));
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("in_progress");
      // The nightly sweep agrees and leaves it running until the day is over.
      await sweepStatuses();
      const row = await prisma.railJourney.findUniqueOrThrow({
        where: { id: res.body.data.id },
      });
      expect(row.status).toBe("in_progress");
      await sweepStatuses(new Date(Date.now() + 2 * DAY_MS));
      const later = await prisma.railJourney.findUniqueOrThrow({
        where: { id: res.body.data.id },
      });
      expect(later.status).toBe("completed");
    });
  });

  describe("readers abstain on a ride with no clock", () => {
    it("counts no hours on board and no night train for a dateless overnight ride", async () => {
      // A night train by category stays one: that is not read off a clock.
      await create(ride());
      await create(
        ride({ departureLocal: "2025-04-01", arrivalLocal: "2025-04-02", trainCategory: "NJ" })
      );
      const res = await request(app).get("/api/v1/rail/stats").set("Cookie", cookie);
      expect(res.status).toBe(200);
      const stats = res.body.data;
      expect(stats.journeys).toBe(2);
      expect(stats.hoursOnBoard).toEqual({ hours: 0, measuredJourneys: 0 });
      expect(stats.rideKinds.nightTrains).toBe(1);
      expect(stats.delays.averageMinutes).toBeNull();
    });

    it("shows a dateless ride of today as upcoming, with day precision", async () => {
      const res = await create(ride({ departureLocal: berlinDay(0), arrivalLocal: null }));
      expect(res.status).toBe(201);
      const upcoming = await request(app).get("/api/v1/upcoming").set("Cookie", cookie);
      expect(upcoming.status).toBe(200);
      const entry = upcoming.body.data.entries.find((e: { domain: string }) => e.domain === "rail");
      expect(entry).toBeDefined();
      expect(entry.id).toBe(res.body.data.id);
      expect(entry.startsAtPrecision).toBe("day");
    });

    it("finds no photos taken 'on the train' for a ride with no clock", async () => {
      const trip = await prisma.trip.create({ data: { userId, name: `day-trip-${stamp}` } });
      const created = await create(ride({ tripId: trip.id }));
      const res = await request(app)
        .get(`/api/v1/rail/${created.body.data.id}/trip-photos`)
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.window).toBeNull();
      expect(res.body.data.reason).toBe("noClock");
    });
  });

  describe("source, read from the filed originals", () => {
    const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);

    it("is null for a ride with no original kept", async () => {
      const created = await create(ride());
      expect(created.body.data.source).toBeNull();
      const read = await request(app)
        .get(`/api/v1/rail/${created.body.data.id}`)
        .set("Cookie", cookie);
      expect(read.body.data.source).toBeNull();
    });

    it("names the parsed ticket the ride came from, on create, detail and list", async () => {
      const parsed = (
        await createDocument({
          userId,
          buffer: PDF(`sparpreis-${stamp}`),
          source: "parse",
          kind: "ticket",
          originalName: "Sparpreis.pdf",
        })
      ).document;
      const receipt = (
        await createDocument({ userId, buffer: PDF(`receipt-${stamp}`), originalName: "Beleg.pdf" })
      ).document;
      const created = await create(ride({ documentIds: [receipt.id, parsed.id] }));
      expect(created.status).toBe(201);
      const expected = {
        kind: "document",
        documentId: parsed.id,
        documentKind: "ticket",
        format: "pdf",
        name: "Sparpreis.pdf",
        issuedOn: null,
        parsed: true,
        documentCount: 2,
      };
      expect(created.body.data.source).toEqual(expected);
      const detail = await request(app)
        .get(`/api/v1/rail/${created.body.data.id}`)
        .set("Cookie", cookie);
      expect(detail.body.data.source).toEqual(expected);
      const list = await request(app).get("/api/v1/rail").set("Cookie", cookie);
      expect(list.body.data[0].source).toEqual(expected);
      // The raw include does not leak beside it.
      expect(list.body.data[0].documents).toBeUndefined();
      expect(list.body.data[0]._count).toBeUndefined();
    });

    it("cannot be set by a client", async () => {
      const res = await create(
        ride({ source: { kind: "document", documentId: "00000000-0000-0000-0000-000000000000" } })
      );
      expect(res.status).toBe(201);
      expect(res.body.data.source).toBeNull();
    });
  });
});
