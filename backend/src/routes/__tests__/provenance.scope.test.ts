import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { EventEmitter } from "events";
import type { Request, Response } from "express";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  applyRecordedOnly,
  recordedOnlyActive,
  recordedOnlyScope,
  runRecordedOnly,
} from "../../services/provenance/recordedOnly";

/**
 * The "nur belegte" scope is an AsyncLocalStorage: it must narrow what is inside it — including
 * nested relations — and never anything outside it (another request, a non-stats route, work that
 * outlives the response).
 */
describe("recorded-only scope", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let tripId: string;

  const flight = (provenance: string | null, extra: object = {}) =>
    prisma.flight.create({
      data: {
        userId,
        tripId,
        depIata: "FRA",
        depLat: 50,
        depLon: 8,
        arrIata: "LIS",
        arrLat: 38,
        arrLon: -9,
        status: "flown",
        flightNumber: `ZZ ${stamp % 1000}`,
        departureTime: new Date("2003-03-03T08:00:00Z"),
        provenance,
        ...extra,
      },
    });

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: `rf-sc-${stamp}`, passwordHash: await hashPassword("test-password") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Scope" } })).id;
    await flight("remembered");
    await flight("recorded");
    await flight(null);
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  describe("narrowing", () => {
    it("leaves a query alone outside a scope", () => {
      const args = { where: { userId } };
      expect(applyRecordedOnly("Flight", "findMany", args)).toBe(args);
    });

    it("narrows a nested to-many include, a relation count and a findUnique inside one", async () => {
      await runRecordedOnly(async () => {
        const trip = await prisma.trip.findUniqueOrThrow({
          where: { id: tripId },
          include: { flights: true, _count: { select: { flights: true } } },
        });
        expect(trip.flights).toHaveLength(2);
        expect(trip._count.flights).toBe(2);
        expect(trip.flights.every((f) => f.provenance !== "remembered")).toBe(true);
      });
      // The same read outside the scope sees all three.
      const all = await prisma.trip.findUniqueOrThrow({
        where: { id: tripId },
        include: { flights: true, _count: { select: { flights: true } } },
      });
      expect(all.flights).toHaveLength(3);
      expect(all._count.flights).toBe(3);
    });

    it("narrows an include below a to-one relation too", async () => {
      await runRecordedOnly(async () => {
        const f = await prisma.flight.findFirstOrThrow({
          where: { userId, provenance: "recorded" },
          include: { trip: { include: { flights: true } } },
        });
        expect(f.trip?.flights).toHaveLength(2);
      });
    });

    it("never narrows a write", async () => {
      const f = await flight("remembered", { flightNumber: "WR 1" });
      await runRecordedOnly(async () => {
        await prisma.flight.update({ where: { id: f.id }, data: { gate: "A1" } });
        expect(await prisma.flight.count({ where: { id: f.id } })).toBe(0);
      });
      expect((await prisma.flight.findUniqueOrThrow({ where: { id: f.id } })).gate).toBe("A1");
      await prisma.flight.delete({ where: { id: f.id } });
    });
  });

  describe("the boundary", () => {
    it("two concurrent requests never see each other's scope", async () => {
      const get = (q: string) =>
        request(app).get(`/api/v1/flights${q}`).set("Cookie", cookie).query({ limit: 50 });
      const rows = (b: unknown): number =>
        ((b as { flights?: unknown[] }).flights ?? (Array.isArray(b) ? b : [])).length;
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          i % 2 === 0
            ? get("?onlyRecorded=true").then((r) => ["scoped", rows(r.body)] as const)
            : get("").then((r) => ["open", rows(r.body)] as const)
        )
      );
      for (const [kind, n] of results) expect(n).toBe(kind === "scoped" ? 2 : 3);
    });

    it("a route outside the scoped prefixes ignores the parameter", async () => {
      const q = `ZZ ${stamp % 1000}`;
      const [plain, flagged] = await Promise.all([
        request(app).get("/api/v1/search").query({ q }).set("Cookie", cookie),
        request(app).get("/api/v1/search").query({ q, onlyRecorded: "true" }).set("Cookie", cookie),
      ]);
      expect(plain.status).toBe(200);
      expect(JSON.stringify(flagged.body)).toBe(JSON.stringify(plain.body));
    });

    const fakeRes = () => Object.assign(new EventEmitter(), {}) as unknown as Response;
    const fakeReq = (method: string, query: object) => ({ method, query }) as unknown as Request;

    it("only a GET opens a scope", () => {
      let seen: boolean | null = null;
      recordedOnlyScope(fakeReq("POST", { onlyRecorded: "true" }), fakeRes(), () => {
        seen = recordedOnlyActive();
      });
      expect(seen).toBe(false);
    });

    it("removes the parameter before any handler sees it", () => {
      const req = fakeReq("GET", { onlyRecorded: "true", limit: "5" });
      recordedOnlyScope(req, fakeRes(), () => undefined);
      expect(req.query).toEqual({ limit: "5" });
    });

    it("ends with the response: work left running afterwards reads everything again", async () => {
      const res = fakeRes();
      let later: (() => Promise<boolean>) | null = null;
      recordedOnlyScope(fakeReq("GET", { onlyRecorded: "true" }), res, () => {
        later = async () => {
          await new Promise((r) => setImmediate(r));
          return recordedOnlyActive();
        };
      });
      res.emit("finish");
      expect(await later!()).toBe(false);
    });
  });
});

describe("recorded-only scope — _count", () => {
  it("narrows `_count: true` and leaves a `false` entry switched off", async () => {
    const stamp = Date.now();
    const u = (
      await prisma.user.create({
        data: { username: `rf-ct-${stamp}`, passwordHash: await hashPassword("test-password") },
      })
    ).id;
    try {
      const trip = await prisma.trip.create({ data: { userId: u, name: "Count" } });
      for (const provenance of ["remembered", "recorded"]) {
        await prisma.flight.create({
          data: {
            userId: u,
            tripId: trip.id,
            depIata: "FRA",
            depLat: 50,
            depLon: 8,
            arrIata: "LIS",
            arrLat: 38,
            arrLon: -9,
            status: "flown",
            provenance,
          },
        });
      }
      await runRecordedOnly(async () => {
        const all = await prisma.trip.findUniqueOrThrow({
          where: { id: trip.id },
          select: { _count: true },
        });
        expect(all._count.flights).toBe(1);
        const off = await prisma.trip.findUniqueOrThrow({
          where: { id: trip.id },
          select: { _count: { select: { flights: false, railJourneys: true } } },
        });
        expect((off._count as Record<string, unknown>).flights).toBeUndefined();
      });
    } finally {
      await prisma.user.delete({ where: { id: u } });
    }
  });
});
