/**
 * AUD-092 to AUD-094: what a flight suggestion is allowed to do to a flight.
 *
 * A suggestion carries a full snapshot of the flight as the provider saw it,
 * plus a `changes` list naming what it actually proposes and `originalData`
 * recording the flight as it stood when the snapshot was taken. Applying it
 * wrote the WHOLE snapshot back, compared nothing against the current row, and
 * skipped the invariants the ordinary flight write path enforces.
 */
import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

const USERNAME = `pendingintegrity${Date.now()}`;

describe("applying a flight suggestion", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.pendingFlightUpdate.deleteMany({ where: { userId } });
    await prisma.pendingUpdateStatistics.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const DEP = new Date("2025-06-01T08:00:00Z");
  const ARR = new Date("2025-06-01T10:00:00Z");

  async function makeFlight(over: Record<string, unknown> = {}) {
    return prisma.flight.create({
      data: {
        userId,
        airline: "Lufthansa",
        flightNumber: "LH400",
        depIata: "FRA",
        arrIata: "JFK",
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 40.6413,
        arrLon: -73.7781,
        departureTime: DEP,
        arrivalTime: ARR,
        status: "scheduled",
        ...over,
      },
    });
  }

  /** A suggestion that proposes exactly one field. */
  async function makeSuggestion(
    flightId: string,
    field: string,
    oldValue: unknown,
    newValue: unknown,
    original: Record<string, unknown>,
    proposed: Record<string, unknown>
  ) {
    return prisma.pendingFlightUpdate.create({
      data: {
        flightId,
        userId,
        status: "pending",
        originalData: original,
        proposedData: proposed,
        changes: [{ field, oldValue, newValue, type: "changed" }],
        apiSource: "airlabs",
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  describe("AUD-092 — it applies what it proposed, and nothing else", () => {
    it("leaves a field the suggestion never mentioned alone", async () => {
      const flight = await makeFlight();
      const suggestion = await makeSuggestion(
        flight.id,
        "gate",
        null,
        "B12",
        { gate: null, airline: "Lufthansa" },
        // The snapshot also carries an airline — which the provider is simply
        // reporting, not proposing to change.
        { gate: "B12", airline: "Deutsche Lufthansa AG" }
      );

      // Meanwhile the user renames the airline by hand.
      await prisma.flight.update({
        where: { id: flight.id },
        data: { airline: "LH (meine Schreibweise)" },
      });

      const res = await request(app)
        .post(`/api/v1/pending-updates/${suggestion.id}/apply`)
        .set("Cookie", cookie);
      expect(res.status).toBe(200);

      const after = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(after.gate).toBe("B12");
      // Reverted to the snapshot's value before the fix — silently, with
      // nothing on screen to say the edit had been undone.
      expect(after.airline).toBe("LH (meine Schreibweise)");
    });

    it("leaves a PROPOSED field alone once the user has changed it themselves", async () => {
      const flight = await makeFlight({ gate: null });
      const suggestion = await makeSuggestion(
        flight.id,
        "gate",
        null,
        "B12",
        { gate: null },
        { gate: "B12" }
      );

      // The user picks a gate before getting round to the suggestion. Theirs
      // is the more recent statement of intent.
      await prisma.flight.update({ where: { id: flight.id }, data: { gate: "A99" } });

      const res = await request(app)
        .post(`/api/v1/pending-updates/${suggestion.id}/apply`)
        .set("Cookie", cookie);
      expect(res.status).toBe(200);

      expect((await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } })).gate).toBe(
        "A99"
      );
    });

    it("still applies a proposed field the user has not touched", async () => {
      // The control — otherwise the fix could be "apply nothing".
      const flight = await makeFlight({ gate: null });
      const suggestion = await makeSuggestion(
        flight.id,
        "gate",
        null,
        "C7",
        { gate: null },
        { gate: "C7" }
      );

      const res = await request(app)
        .post(`/api/v1/pending-updates/${suggestion.id}/apply`)
        .set("Cookie", cookie);
      expect(res.status).toBe(200);

      expect((await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } })).gate).toBe("C7");
    });
  });

  describe("AUD-093 — the flight it would produce has to be possible", () => {
    it("rejects an edit whose times are not real timestamps", async () => {
      const flight = await makeFlight();
      const suggestion = await makeSuggestion(
        flight.id,
        "departureTime",
        DEP.toISOString(),
        "2025-06-01T09:00:00.000Z",
        { departureTime: DEP.toISOString() },
        { departureTime: "2025-06-01T09:00:00.000Z" }
      );

      const res = await request(app)
        .put(`/api/v1/pending-updates/${suggestion.id}`)
        .set("Cookie", cookie)
        .send({ editedData: { departureTime: "irgendwann morgen" } });

      expect(res.status).toBe(400);
    });

    it("refuses to store an arrival before its departure", async () => {
      const flight = await makeFlight();
      const suggestion = await makeSuggestion(
        flight.id,
        "arrivalTime",
        ARR.toISOString(),
        "2025-06-01T12:00:00.000Z",
        { arrivalTime: ARR.toISOString() },
        { arrivalTime: "2025-06-01T12:00:00.000Z" }
      );

      // An edit the schema accepts and the flight cannot survive: two hours
      // BEFORE the stored departure.
      await request(app)
        .put(`/api/v1/pending-updates/${suggestion.id}`)
        .set("Cookie", cookie)
        .send({ editedData: { arrivalTime: "2025-06-01T06:00:00.000Z" } })
        .expect(200);

      const res = await request(app)
        .post(`/api/v1/pending-updates/${suggestion.id}/apply`)
        .set("Cookie", cookie);

      expect(res.status).toBeGreaterThanOrEqual(400);
      const after = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(after.arrivalTime?.toISOString()).toBe(ARR.toISOString());
    });
  });

  describe("AUD-094 — an edited suggestion can be edited again", () => {
    it("accepts a second edit before anything is applied", async () => {
      const flight = await makeFlight();
      const suggestion = await makeSuggestion(
        flight.id,
        "gate",
        null,
        "B12",
        { gate: null },
        { gate: "B12" }
      );

      await request(app)
        .put(`/api/v1/pending-updates/${suggestion.id}`)
        .set("Cookie", cookie)
        .send({ editedData: { gate: "D1" } })
        .expect(200);

      // The card offers "edit" for an edited suggestion, and the server used
      // to refuse it — the button was there and did not work.
      const second = await request(app)
        .put(`/api/v1/pending-updates/${suggestion.id}`)
        .set("Cookie", cookie)
        .send({ editedData: { gate: "D2" } });

      expect(second.status).toBe(200);
      const stored = await prisma.pendingFlightUpdate.findUniqueOrThrow({
        where: { id: suggestion.id },
      });
      expect((stored.editedData as { gate?: string })?.gate).toBe("D2");
    });
  });
});
