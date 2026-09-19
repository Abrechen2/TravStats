import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

import "../../services/openapi/paths";
import { buildOpenApiDocument } from "../../services/openapi/registry";

/**
 * What `GET /flights` puts on the wire is what `components.schemas.Flight`
 * describes — measured against a real response, not against the model.
 *
 * `openapi.modelColumns.test.ts` next door asks the other half: that every
 * COLUMN of the Prisma model is published. That guard cannot see a key the
 * route adds on top of the row, which is exactly what went missing: the read
 * routes `include` the flight's trip, and the schema published 95 of the 96
 * keys a listed flight actually carries — `trip` was the gap (beta API audit
 * of 2026-09-19, unlisted finding 1). A client generated from the spec saw
 * `unknown` for a field the server sends on every list request.
 *
 * So this test reads the spec and the response and compares the key sets.
 * Comparing them wholesale rather than asserting `trip` specifically is the
 * point: the next key a route starts sending fails here too, and a test that
 * only restated the fix would not have caught this one either.
 */
describe("GET /api/v1/flights — every key it sends is in the published Flight schema", () => {
  let user: { id: string };
  let authCookie: string;
  let flightId: string;
  let tripId: string;

  beforeAll(async () => {
    const timestamp = Date.now();
    user = await prisma.user.create({
      data: {
        username: `flights-spec-contract-${timestamp}`,
        passwordHash: await hashPassword("test-password"),
        isAdmin: false,
        isActive: true,
      },
    });
    authCookie = `auth_token=${generateToken(user.id)}`;

    // A flight ASSIGNED to a trip, so the included relation is an object and
    // not the null an unassigned flight sends — a null would be published
    // just as wrongly and prove nothing about the shape.
    const trip = await prisma.trip.create({
      data: { userId: user.id, name: `spec contract ${timestamp}`, color: "#818cf8" },
    });
    tripId = trip.id;

    const flight = await prisma.flight.create({
      data: {
        userId: user.id,
        tripId: trip.id,
        depIata: "MUC",
        depLat: 48.3538,
        depLon: 11.7861,
        arrIata: "JFK",
        arrLat: 40.6413,
        arrLon: -73.7781,
        status: "flown",
      },
    });
    flightId = flight.id;
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: user?.id } }).catch(() => {});
    await prisma.trip.deleteMany({ where: { userId: user?.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  const publishedFlightKeys = (): string[] => {
    const doc = buildOpenApiDocument() as {
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    };
    return Object.keys(doc.components.schemas.Flight?.properties ?? {});
  };

  it("publishes the trip the list route includes", async () => {
    const res = await request(app).get("/api/v1/flights?limit=50").set("Cookie", authCookie);
    expect(res.status).toBe(200);

    const flights = res.body.flights as Array<Record<string, unknown>>;
    const flight = flights.find((f) => f.id === flightId);
    expect(flight).toBeDefined();
    // The relation really is on the wire, and really is the selected object.
    expect(flight!.trip).toEqual({
      id: tripId,
      name: expect.any(String),
      color: expect.any(String),
    });

    const published = publishedFlightKeys();
    expect(Object.keys(flight!).filter((key) => !published.includes(key))).toEqual([]);
  });

  it("publishes every key the single-flight route sends too", async () => {
    const res = await request(app).get(`/api/v1/flights/${flightId}`).set("Cookie", authCookie);
    expect(res.status).toBe(200);

    const published = publishedFlightKeys();
    const flight = res.body as Record<string, unknown>;
    expect(flight.trip).not.toBeUndefined();
    expect(Object.keys(flight).filter((key) => !published.includes(key))).toEqual([]);
  });
});
