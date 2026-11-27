import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import {
  linkWithConsent,
  makeAccount,
  makeFullTrip,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * UAT 2026-11-27 (RC↔Beta): "Meine übernehmen" pushed the father's STRAIGHT ferry lines over the
 * owner's drawn ones (B1); the decision was per trip only (M2); the dry run showed raw ISO times,
 * coordinate JSON and derived kilometres (M3).
 */
const LINE = Array.from({ length: 184 }, (_, i) => [10.1 + i * 0.01, 54.3 + i * 0.02]);

async function crossing(owner: TestAccount, tripId: string, drawn: boolean) {
  return prisma.ferryJourney.create({
    data: {
      userId: owner.id,
      tripId,
      operator: "Color Line",
      depStationName: "Kiel",
      depLat: 54.32,
      depLon: 10.14,
      depTimezone: "Europe/Berlin",
      arrStationName: "Oslo",
      arrLat: 59.9,
      arrLon: 10.74,
      arrTimezone: "Europe/Oslo",
      departureTime: new Date("2025-05-02T12:00:00Z"),
      arrivalTime: new Date("2025-05-03T08:00:00Z"),
      depPrecision: "minute",
      arrPrecision: "minute",
      geometry: drawn
        ? { type: "LineString", coordinates: LINE }
        : { type: "LineString", coordinates: [LINE[0], LINE[LINE.length - 1]] },
      geometrySource: drawn ? "manual" : "straight",
      distanceKm: drawn ? 640 : 610,
    },
  });
}

describe("linking settles by quality (UAT 2026-11-27)", () => {
  let owner: TestAccount;
  let father: TestAccount;
  let ownerTrip: Awaited<ReturnType<typeof makeFullTrip>>;
  let fatherTrip: Awaited<ReturnType<typeof makeFullTrip>>;
  let ownerRide: { id: string };
  let fatherRide: { id: string };

  beforeEach(async () => {
    await wipeShareTestAccounts();
    owner = await makeAccount("owner");
    father = await makeAccount("father");
    ownerTrip = await makeFullTrip(owner);
    fatherTrip = await makeFullTrip(father);
    ownerRide = await crossing(owner, ownerTrip.trip.id, true);
    fatherRide = await crossing(father, fatherTrip.trip.id, false);
    await linkWithConsent(father, owner);
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const link = (body: Record<string, unknown>) =>
    request(app)
      .post(`/api/v1/sharing/trips/${fatherTrip.trip.id}/link`)
      .set("Cookie", father.cookie)
      .send({ userId: owner.id, targetTripId: ownerTrip.trip.id, ...body });

  it("'Meine übernehmen' never pushes the father's straight line over the owner's drawn one (B1)", async () => {
    await link({ decision: "mine" }).expect(200);
    const ownerNow = await prisma.ferryJourney.findUniqueOrThrow({ where: { id: ownerRide.id } });
    expect(ownerNow.geometrySource).toBe("manual");
    expect((ownerNow.geometry as { coordinates: unknown[] }).coordinates).toHaveLength(184);
    // The better line reached the father instead.
    const fatherNow = await prisma.ferryJourney.findUniqueOrThrow({ where: { id: fatherRide.id } });
    expect(fatherNow.geometrySource).toBe("manual");
  });

  it("the dry run names the line by its quality, the time in the place's zone, and no kilometres (M3)", async () => {
    await prisma.ferryJourney.update({
      where: { id: fatherRide.id },
      data: { departureTime: new Date("2025-05-02T13:00:00Z") },
    });
    const res = await request(app)
      .post(`/api/v1/sharing/trips/${fatherTrip.trip.id}/link-preview`)
      .set("Cookie", father.cookie)
      .send({ userId: owner.id, targetTripId: ownerTrip.trip.id })
      .expect(200);
    const ferry = res.body.data.matched.find((m: { entity: string }) => m.entity === "ferry");
    const byField = Object.fromEntries(
      ferry.conflicts.map((c: { field: string }) => [c.field, c])
    );
    expect(byField.geometry).toMatchObject({
      here: { kind: "line", quality: "straight", points: 2 },
      there: { kind: "line", quality: "drawn", points: 184 },
      better: "there",
      real: false,
    });
    expect(byField.departureTime.here).toMatchObject({
      kind: "time",
      value: { zone: "Europe/Berlin", local: expect.stringContaining("15:00") },
    });
    expect(byField.distanceKm).toBeUndefined();
    expect(byField.geometrySource).toBeUndefined();
    expect(ferry.ref).toBe(`ferry:${fatherRide.id}`);
  });

  it("a per-field choice settles that field only (M2)", async () => {
    await prisma.ferryJourney.update({ where: { id: fatherRide.id }, data: { operator: "Stena" } });
    await link({
      decision: "both",
      choices: { [`ferry:${fatherRide.id}`]: { operator: "theirs" } },
    }).expect(200);
    const fatherNow = await prisma.ferryJourney.findUniqueOrThrow({ where: { id: fatherRide.id } });
    expect(fatherNow.operator).toBe("Color Line");
    // "both" left the lines as they were, on each side.
    expect(fatherNow.geometrySource).toBe("straight");
  });

  it("'best' (the bulk link) takes the better line and leaves equal values alone", async () => {
    await prisma.ferryJourney.update({ where: { id: fatherRide.id }, data: { operator: "Stena" } });
    await link({ decision: "best" }).expect(200);
    const fatherNow = await prisma.ferryJourney.findUniqueOrThrow({ where: { id: fatherRide.id } });
    const ownerNow = await prisma.ferryJourney.findUniqueOrThrow({ where: { id: ownerRide.id } });
    expect(fatherNow.geometrySource).toBe("manual");
    expect(fatherNow.operator).toBe("Stena");
    expect(ownerNow.operator).toBe("Color Line");
  });
});
