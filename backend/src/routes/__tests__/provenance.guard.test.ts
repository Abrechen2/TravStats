import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import type { Router } from "express";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { apiMounts } from "../mounts";
import { RECORDED_ONLY_PREFIXES } from "../../services/provenance/recordedOnly";

/**
 * The guard behind "nur belegte" (spec 2026-11-22-remembered-facts): an account whose WHOLE
 * history was typed in from memory must look EMPTY on every route the statistics page reads —
 * counts, lists, maps, achievements — when the filter is on, and must NOT look empty when it is
 * off (so the fixture is seen). The check is generic: the filtered answer equals the answer of an
 * account with no data at all, whatever the endpoint returns.
 */
const BASES = RECORDED_ONLY_PREFIXES;

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
  name?: string;
}

/** Every parameter-free GET path the mount table serves under the scoped prefixes. */
function scopedGetPaths(): string[] {
  const out = new Set<string>();
  const walk = (stack: Layer[], prefix: string): void => {
    for (const layer of stack) {
      if (layer.route) {
        const path = layer.route.path;
        if (layer.route.methods.get && typeof path === "string" && !path.includes(":")) {
          out.add(`${prefix}${path === "/" ? "" : path}`);
        }
      } else if (layer.name === "router" && layer.handle?.stack) {
        walk(layer.handle.stack, prefix);
      }
    }
  };
  for (const m of apiMounts) {
    if (!BASES.some((b) => m.base === b)) continue;
    walk((m.router as unknown as Router).stack as unknown as Layer[], m.base);
  }
  return [...out].sort();
}

const VOLATILE = /^(id|.*Id|.*At|.*Key|scope|generatedAt|computedAt|etag|now|today)$/;
function normalise(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalise);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => !VOLATILE.test(k))
        .map(([k, x]) => [k, normalise(x)])
    );
  }
  return v;
}

describe("nur belegte — every statistic the page reads drops a remembered account", () => {
  const stamp = Date.now();
  let ghostCookie: string;
  let emptyCookie: string;
  const ids: string[] = [];
  let portId = 0;

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    const mk = async (name: string): Promise<string> => {
      const id = (
        await prisma.user.create({ data: { username: `${name}-${stamp}`, passwordHash } })
      ).id;
      ids.push(id);
      return id;
    };
    const ghost = await mk("rf-ghost");
    const empty = await mk("rf-empty");
    ghostCookie = `auth_token=${generateToken(ghost)}`;
    emptyCookie = `auth_token=${generateToken(empty)}`;
    const mark = { provenance: "remembered", rememberedNote: "Sommer 2001" };
    const trip = await prisma.trip.create({
      data: {
        userId: ghost,
        name: "Sommer 2001",
        startDate: new Date("2001-07-01T00:00:00Z"),
        endDate: new Date("2001-07-20T00:00:00Z"),
        status: "completed",
        countries: ["IT"],
        ...mark,
      },
    });
    const tripId = trip.id;
    await prisma.flight.create({
      data: {
        userId: ghost,
        tripId,
        depIata: "FRA",
        depLat: 50.03,
        depLon: 8.56,
        arrIata: "FCO",
        arrLat: 41.8,
        arrLon: 12.25,
        airline: "Lufthansa",
        airlineIata: "LH",
        flightNumber: "LH 232",
        status: "flown",
        departureTime: new Date("2001-07-01T08:00:00Z"),
        arrivalTime: new Date("2001-07-01T10:00:00Z"),
        actualArrival: new Date("2001-07-01T10:30:00Z"),
        delayMinutes: 30,
        routeDistance: 1100,
        ...mark,
      },
    });
    const leg = {
      userId: ghost,
      tripId,
      depStationName: "Frankfurt",
      depLat: 50.1,
      depLon: 8.66,
      arrStationName: "Mailand",
      arrLat: 45.48,
      arrLon: 9.2,
      departureTime: new Date("2001-07-02T08:00:00Z"),
      arrivalTime: new Date("2001-07-02T18:00:00Z"),
      status: "completed",
      ...mark,
    };
    await prisma.railJourney.create({ data: leg });
    await prisma.busJourney.create({ data: leg });
    await prisma.ferryJourney.create({ data: leg });
    await prisma.rentalBooking.create({
      data: {
        userId: ghost,
        tripId,
        provider: "Sixt",
        pickupStationName: "Rom",
        pickupLat: 41.9,
        pickupLon: 12.5,
        pickupTimezone: "Europe/Rome",
        returnStationName: "Rom",
        returnLat: 41.9,
        returnLon: 12.5,
        returnTimezone: "Europe/Rome",
        pickupTime: new Date("2001-07-03T08:00:00Z"),
        returnTime: new Date("2001-07-10T08:00:00Z"),
        status: "completed",
        ...mark,
      },
    });
    const cruise = await prisma.cruise.create({
      data: {
        userId: ghost,
        tripId,
        startDate: new Date("2001-07-11T00:00:00Z"),
        endDate: new Date("2001-07-18T00:00:00Z"),
        status: "completed",
        ...mark,
      },
    });
    // The remembered cruise's only port is in a country no other entry reaches: a statistic that
    // reads the stops directly (passport, country detail) must not report it.
    const port = await prisma.port.create({
      data: { name: "Piräus", city: "Piräus", country: "GR", lat: 37.94, lon: 23.64 },
    });
    portId = port.id;
    await prisma.cruiseStop.create({
      data: {
        cruiseId: cruise.id,
        portId: port.id,
        dayNumber: 1,
        date: new Date("2001-07-12T00:00:00Z"),
        arrivalTime: new Date("2001-07-12T08:00:00Z"),
        departureTime: new Date("2001-07-12T18:00:00Z"),
      },
    });
    const lodging = await prisma.lodging.create({
      data: { userId: ghost, name: "Pension Rosa", city: "Rimini", lat: 44.06, lon: 12.57 },
    });
    await prisma.lodgingStay.create({
      data: {
        userId: ghost,
        tripId,
        lodgingId: lodging.id,
        checkIn: new Date("2001-07-04T00:00:00Z"),
        checkOut: new Date("2001-07-09T00:00:00Z"),
        status: "completed",
        ...mark,
      },
    });
    const place = await prisma.place.create({
      data: { userId: ghost, name: "Colosseo", lat: 41.89, lon: 12.49 },
    });
    await prisma.placeVisit.create({
      data: {
        userId: ghost,
        tripId,
        placeId: place.id,
        visitedAt: new Date("2001-07-05T10:00:00Z"),
        ...mark,
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.port.deleteMany({ where: { id: portId } });
  });

  // Reads that need a parameter or a window the bare route lacks; same check, same fixture.
  const EXTRA = [
    "/api/v1/stats/page?include=fun,business,unique,airports,seats,countries,airlines,aircraft,punctuality",
    "/api/v1/stats/timeseries?window=all",
    "/api/v1/stats/timeseries?window=all&domain=cruise",
    "/api/v1/stats/countries/IT",
    "/api/v1/stats/countries/GR",
    "/api/v1/stats/summary?year=2001",
    "/api/v1/stats/routes?year=2001",
    "/api/v1/lodging?year=2001",
    "/api/v1/lodging/facets?year=2001",
  ];
  // An honour is earned once and stored: it cannot be narrowed, so a filtered read refuses.
  const NOT_FILTERABLE = (p: string): boolean => p.startsWith("/api/v1/achievements");
  const paths = [...scopedGetPaths(), ...EXTRA];
  const get = (path: string, cookie: string, filtered: boolean) =>
    request(app)
      .get(
        `/api/v1${path.replace("/api/v1", "")}${filtered ? (path.includes("?") ? "&" : "?") + "onlyRecorded=true" : ""}`
      )
      .set("Cookie", cookie);

  it("finds the statistics routes the page reads", () => {
    expect(paths).toEqual(expect.arrayContaining(["/api/v1/stats/summary", "/api/v1/stats/hero"]));
    expect(paths.length).toBeGreaterThan(25);
  });

  it("every scoped GET route answers a remembered-only account like an empty one", async () => {
    const leaks: string[] = [];
    const blind: string[] = [];
    for (const path of paths) {
      const [filtered, empty, all] = await Promise.all([
        get(path, ghostCookie, true),
        get(path, emptyCookie, false),
        get(path, ghostCookie, false),
      ]);
      if (NOT_FILTERABLE(path)) {
        if (filtered.status !== 409) leaks.push(`${path}: expected 409, got ${filtered.status}`);
        continue;
      }
      if (filtered.status !== empty.status) {
        leaks.push(`${path}: status ${filtered.status} vs ${empty.status}`);
        continue;
      }
      if (JSON.stringify(normalise(filtered.body)) !== JSON.stringify(normalise(empty.body))) {
        leaks.push(path + " :: " + JSON.stringify(normalise(filtered.body)).slice(0, 700));
      }
      if (JSON.stringify(normalise(all.body)) === JSON.stringify(normalise(empty.body))) {
        blind.push(path);
      }
    }
    expect(leaks).toEqual([]);
    // Not a guard on the filter but on the fixture: most routes must actually see it.
    process.stderr.write(`BLIND ${blind.length}/${paths.length}: ${blind.join(" ")}\n`);
    expect(blind.length).toBeLessThan(paths.length / 2);
  }, 120_000);
});
