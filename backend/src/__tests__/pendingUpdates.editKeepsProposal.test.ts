/**
 * Editing a suggestion must not throw away the parts of it that were not edited.
 *
 * The inbox card sends the whole proposal with the user's draft on top. The PUT
 * schema knew only ten optional strings: Zod stripped actual times, status and
 * route, and `applyPendingUpdate` applied `editedData || proposedData` — so an
 * edited gate cost the flight its actual times and its cancellation. A gate the
 * provider reported as `null` turned the whole edit into a 400.
 */
import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

const USERNAME = `pendingeditkeeps${Date.now()}`;

describe("editing a flight suggestion", () => {
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

  const DEP = "2025-06-01T08:00:00.000Z";
  const ARR = "2025-06-01T10:00:00.000Z";
  const ACTUAL_DEP = "2025-06-01T08:40:00.000Z";
  const ACTUAL_ARR = "2025-06-01T10:35:00.000Z";

  async function makeCancelledProposal() {
    const flight = await prisma.flight.create({
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
        departureTime: new Date(DEP),
        arrivalTime: new Date(ARR),
        status: "scheduled",
      },
    });
    const original = {
      airline: "Lufthansa",
      gate: null,
      terminal: null,
      depIata: "FRA",
      arrIata: "JFK",
      departureTime: DEP,
      arrivalTime: ARR,
      actualDeparture: null,
      actualArrival: null,
      status: "scheduled",
    };
    // The shape convertApiDataToProposed writes: nullable strings, actual
    // times, the provider's status.
    const proposed = {
      ...original,
      gate: null,
      terminal: "1",
      actualDeparture: ACTUAL_DEP,
      actualArrival: ACTUAL_ARR,
      status: "cancelled",
    };
    const suggestion = await prisma.pendingFlightUpdate.create({
      data: {
        flightId: flight.id,
        userId,
        status: "pending",
        originalData: original,
        proposedData: proposed,
        changes: [
          { field: "terminal", oldValue: null, newValue: "1", type: "changed" },
          { field: "actualDeparture", oldValue: null, newValue: ACTUAL_DEP, type: "changed" },
          { field: "actualArrival", oldValue: null, newValue: ACTUAL_ARR, type: "changed" },
          { field: "status", oldValue: "scheduled", newValue: "cancelled", type: "changed" },
        ],
        apiSource: "airlabs",
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    return { flight, proposed, suggestion };
  }

  it("keeps actual times and the cancellation when only the gate is edited", async () => {
    const { flight, proposed, suggestion } = await makeCancelledProposal();

    const put = await request(app)
      .put(`/api/v1/pending-updates/${suggestion.id}`)
      .set("Cookie", cookie)
      .send({ editedData: { ...proposed, gate: "B12" } });
    expect(put.status).toBe(200);

    const apply = await request(app)
      .post(`/api/v1/pending-updates/${suggestion.id}/apply`)
      .set("Cookie", cookie);
    expect(apply.status).toBe(200);

    const after = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    expect(after.gate).toBe("B12");
    expect(after.terminal).toBe("1");
    expect(after.actualDeparture?.toISOString()).toBe(ACTUAL_DEP);
    expect(after.actualArrival?.toISOString()).toBe(ACTUAL_ARR);
    expect(after.status).toBe("cancelled");
  });

  it("keeps the proposal when the edit sends only the changed field", async () => {
    const { flight, suggestion } = await makeCancelledProposal();

    const put = await request(app)
      .put(`/api/v1/pending-updates/${suggestion.id}`)
      .set("Cookie", cookie)
      .send({ editedData: { gate: "C3" } });
    expect(put.status).toBe(200);

    const apply = await request(app)
      .post(`/api/v1/pending-updates/${suggestion.id}/apply`)
      .set("Cookie", cookie);
    expect(apply.status).toBe(200);

    const after = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    expect(after.gate).toBe("C3");
    expect(after.actualDeparture?.toISOString()).toBe(ACTUAL_DEP);
    expect(after.status).toBe("cancelled");
  });

  it("keeps an earlier edit when a later one sends a different field", async () => {
    const { flight, suggestion } = await makeCancelledProposal();
    const put = (editedData: Record<string, unknown>) =>
      request(app)
        .put(`/api/v1/pending-updates/${suggestion.id}`)
        .set("Cookie", cookie)
        .send({ editedData });

    expect((await put({ gate: "D4" })).status).toBe(200);
    expect((await put({ terminal: "2" })).status).toBe(200);
    await request(app)
      .post(`/api/v1/pending-updates/${suggestion.id}/apply`)
      .set("Cookie", cookie)
      .expect(200);

    const after = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    expect(after.gate).toBe("D4");
    expect(after.terminal).toBe("2");
    expect(after.status).toBe("cancelled");
  });

  it("accepts a null gate in the edited snapshot", async () => {
    const { proposed, suggestion } = await makeCancelledProposal();

    const put = await request(app)
      .put(`/api/v1/pending-updates/${suggestion.id}`)
      .set("Cookie", cookie)
      .send({ editedData: { ...proposed, gate: null, terminal: "2" } });
    expect(put.status).toBe(200);
  });

  it("accepts a time typed to the minute (datetime-local omits :00 seconds)", async () => {
    const { flight, proposed, suggestion } = await makeCancelledProposal();

    const put = await request(app)
      .put(`/api/v1/pending-updates/${suggestion.id}`)
      .set("Cookie", cookie)
      .send({ editedData: { ...proposed, actualDeparture: "2025-06-01T08:45Z" } });
    expect(put.status).toBe(200);

    await request(app)
      .post(`/api/v1/pending-updates/${suggestion.id}/apply`)
      .set("Cookie", cookie)
      .expect(200);
    const after = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    expect(after.actualDeparture?.toISOString()).toBe("2025-06-01T08:45:00.000Z");
  });

  it("still refuses a time that is not a time", async () => {
    const { suggestion } = await makeCancelledProposal();

    const put = await request(app)
      .put(`/api/v1/pending-updates/${suggestion.id}`)
      .set("Cookie", cookie)
      .send({ editedData: { actualDeparture: "yesterday-ish" } });
    expect(put.status).toBe(400);
  });
});
