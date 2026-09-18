import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { documentPath } from "../../services/documents/documentStore";
import { createDocument } from "../../services/documents/documentService";

/**
 * `documentIds` on the create routes (forgejo#116): documents uploaded before
 * their entry existed are filed with it in the same request.
 *
 * The half that matters most is the refusal. A bad id must fail the create
 * BEFORE the entry is written — otherwise the user gets an entry whose
 * documents silently never attached, and a retry makes a second entry.
 */
const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);

describe("documentIds on the create routes", () => {
  const stamp = Date.now();
  let userId: string;
  let strangerId: string;
  let cookie: string;

  const upload = async (tag: string, owner = userId): Promise<string> =>
    (await createDocument({ userId: owner, buffer: PDF(`${tag}-${stamp}`) })).document.id;

  const flightBody = (day: string, documentIds?: unknown) => ({
    departure: { iata: "MUC", lat: 48.35, lon: 11.79 },
    arrival: { iata: "CGN", lat: 50.87, lon: 7.14 },
    departureLocal: `${day}T08:25`,
    depTimezone: "Europe/Berlin",
    arrivalLocal: `${day}T09:30`,
    arrTimezone: "Europe/Berlin",
    status: "flown",
    ...(documentIds !== undefined ? { documentIds } : {}),
  });

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `doc-ids-${stamp}`, passwordHash } }))
      .id;
    strangerId = (
      await prisma.user.create({ data: { username: `doc-ids-other-${stamp}`, passwordHash } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterAll(async () => {
    const rows = await prisma.document.findMany({
      where: { userId: { in: [userId, strangerId] } },
    });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  it("files documents with a new flight", async () => {
    const ids = [await upload("flight-a"), await upload("flight-b")];
    const res = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookie)
      .send(flightBody("2007-07-26", ids));

    expect(res.status).toBe(201);
    const filed = await prisma.document.findMany({ where: { id: { in: ids } } });
    expect(filed.map((d) => d.flightId)).toEqual([res.body.flight.id, res.body.flight.id]);
  });

  it("files documents with a new cruise", async () => {
    const port = await prisma.port.findFirst({ where: { isUserAdded: false } });
    if (!port) throw new Error("Missing seeded port — run seeders first");
    const id = await upload("cruise");

    const res = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", cookie)
      .send({
        cruiseLine: "Doc Line",
        departurePortId: port.id,
        arrivalPortId: port.id,
        startDate: "2024-08-01T12:00:00Z",
        endDate: "2024-08-03T10:00:00Z",
        status: "flown",
        documentIds: [id],
      });

    expect(res.status).toBe(201);
    expect((await prisma.document.findUniqueOrThrow({ where: { id } })).cruiseId).toBe(
      res.body.data.id
    );
  });

  it("refuses a flight whose documentIds name another user's document, and writes no flight", async () => {
    const foreign = await upload("foreign", strangerId);
    const before = await prisma.flight.count({ where: { userId } });

    const res = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookie)
      .send(flightBody("2007-08-01", [foreign]));

    expect(res.status).toBe(404);
    expect(await prisma.flight.count({ where: { userId } })).toBe(before);
  });

  it("refuses a document already filed with another entry (409) before creating the trip", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Already" } });
    const filed = await createDocument({
      userId,
      buffer: PDF(`filed-${stamp}`),
      entry: { type: "trip", id: trip.id },
    });
    const before = await prisma.trip.count({ where: { userId } });

    const res = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", cookie)
      .send({ name: "Second", documentIds: [filed.document.id] });

    expect(res.status).toBe(409);
    expect(await prisma.trip.count({ where: { userId } })).toBe(before);
  });

  it("rejects a malformed documentIds list with 400", async () => {
    const res = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", cookie)
      .send({ name: "Malformed", documentIds: ["not-a-uuid"] });
    expect(res.status).toBe(400);
  });

  it("files documents with a new trip, stay and place visit", async () => {
    const [tripDoc, stayDoc, visitDoc] = [
      await upload("trip"),
      await upload("stay"),
      await upload("visit"),
    ];

    const trip = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", cookie)
      .send({ name: "With bill", documentIds: [tripDoc] });
    expect(trip.status).toBe(201);

    const lodging = await prisma.lodging.create({
      data: { userId, name: "Doc Hotel", type: "hotel" },
    });
    const stay = await request(app)
      .post(`/api/v1/lodging/${lodging.id}/stays`)
      .set("Cookie", cookie)
      .send({ documentIds: [stayDoc] });
    expect(stay.status).toBe(201);

    const place = await prisma.place.create({
      data: { userId, name: "Doc Place", lat: 41.9, lon: 12.5 },
    });
    const visit = await request(app)
      .post(`/api/v1/places/${place.id}/visits`)
      .set("Cookie", cookie)
      .send({ visitedAt: "2024-05-01", documentIds: [visitDoc] });
    expect(visit.status).toBe(201);

    const rows = await prisma.document.findMany({
      where: { id: { in: [tripDoc, stayDoc, visitDoc] } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(tripDoc)?.tripId).toBe(trip.body.trip.id);
    expect(byId.get(stayDoc)?.lodgingStayId).toBe(stay.body.data.id);
    expect(byId.get(visitDoc)?.placeVisitId).toBe(visit.body.data.id);
  });
});
