import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { asJson } from "../store";
import { emptyState } from "../schema";
import type { PlanStage, PlanState, PlanStation } from "../types";

/**
 * A seeded route plan for the plan-versus-actual suites (TravTrack plan L5):
 * Munich (1–3 Oct 2026) → Salzburg (3–4 Oct) → Vienna (4–6 Oct), on a trip of
 * the same days on Vienna's clock. Not a test file (no `.test.ts` suffix).
 */

export const MUNICH = { lat: 48.137, lon: 11.575 };
export const SALZBURG = { lat: 47.809, lon: 13.055 };
export const VIENNA = { lat: 48.208, lon: 16.373 };
export const ZURICH = { lat: 47.376, lon: 8.541 };

/** Noon on a day of October 2026, Vienna's clock (UTC+2). */
export const noon = (day: number, minute = 0) =>
  Date.parse(`2026-10-${String(day).padStart(2, "0")}T10:00:00Z`) + minute * 60_000;

const station = (title: string, at: { lat: number; lon: number }, nights: number): PlanStation => ({
  id: randomUUID(),
  title,
  place: { name: title, ...at, country: null, zone: "Europe/Vienna", ref: null },
  nights,
  pinnedDay: null,
  night: { kind: "spontaneous" },
  note: "",
});

const stage = (from: PlanStation, to: PlanStation, km: number): PlanStage => ({
  id: randomUUID(),
  fromStationId: from.id,
  toStationId: to.id,
  mode: "drive",
  departDay: null,
  departTime: null,
  durationMinutes: 120,
  distanceKm: km,
  metricsSource: "routed",
  fallbackReason: null,
  bookingId: null,
  overnight: false,
  note: "",
});

export function routeState(): PlanState {
  const m = station("München", MUNICH, 2);
  const s = station("Salzburg", SALZBURG, 1);
  const v = station("Wien", VIENNA, 2);
  return {
    ...emptyState(),
    shape: "route",
    destination: "Österreich",
    startDay: "2026-10-01",
    endDay: "2026-10-06",
    timezone: "Europe/Vienna",
    stations: [m, s, v],
    stages: [stage(m, s, 145), stage(s, v, 295)],
  };
}

export async function makePlanTrip(userId: string): Promise<{ tripId: string; state: PlanState }> {
  const trip = await prisma.trip.create({
    data: {
      userId,
      name: "Roadtrip Österreich",
      startDate: new Date("2026-10-01T00:00:00Z"),
      endDate: new Date("2026-10-06T00:00:00Z"),
      startDay: new Date("2026-10-01T00:00:00Z"),
      endDay: new Date("2026-10-06T00:00:00Z"),
      startZone: "Europe/Vienna",
      endZone: "Europe/Vienna",
    },
  });
  const state = routeState();
  await prisma.travelPlan.create({
    data: { tripId: trip.id, createRef: randomUUID(), revision: 4, state: asJson(state) },
  });
  return { tripId: trip.id, state };
}

/** An own trip recording (`TripRecordingBatch`), one device. */
export async function ownRecording(
  userId: string,
  tripId: string,
  points: Array<[number, number, number]>
): Promise<void> {
  await prisma.tripRecordingBatch.create({
    data: {
      userId,
      tripId,
      deviceId: "phone-1",
      uploadId: randomUUID(),
      startedAt: new Date(points[0][0]),
      endedAt: new Date(points[points.length - 1][0]),
      points: points.map(([t, lat, lon]) => [t, lat, lon, 5]),
      pointCount: points.length,
    },
  });
}

/** A short drive near `at` (a few fixes a few hundred metres apart), so the jitter filter keeps a line. */
export function driveNear(
  at: { lat: number; lon: number },
  startMs: number
): Array<[number, number, number]> {
  return [0, 1, 2, 3].map((i) => [startMs + i * 120_000, at.lat + i * 0.004, at.lon + i * 0.004]);
}
