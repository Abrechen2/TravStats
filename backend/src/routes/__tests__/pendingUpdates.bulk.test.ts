import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Forgejo #33. The refresh of existing flights is a batch operation and the
 * review was not: every action was `/:id/...` and the page held a single
 * selected id, so a run that produced fifty proposals cost fifty clicks and
 * fifty round trips.
 *
 * The assertion that matters is the PARTIAL one. A bulk endpoint that answers
 * with a single success flag would look correct in every green-path test and
 * would silently drop the proposals that failed — which the user believes they
 * accepted, because they pressed the button that said so.
 */
const USERNAME = "uat-bulk-33";

describe("pending updates can be answered in bulk", () => {
  let cookie: string;
  let userId: string;
  let otherUserId: string;
  let flightId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [USERNAME, USERNAME + "-other"] } } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;

    const other = await prisma.user.create({
      data: { username: USERNAME + "-other", passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;

    const flight = await prisma.flight.create({
      data: {
        userId,
        flightNumber: "LH1000",
        depIata: "MUC",
        arrIata: "FRA",
        departureTime: new Date("2026-03-01T08:00:00Z"),
        arrivalTime: new Date("2026-03-01T09:00:00Z"),
        status: "scheduled",
        depLat: 48.3538,
        depLon: 11.7861,
        arrLat: 50.0379,
        arrLon: 8.5622,
      },
    });
    flightId = flight.id;
  });

  afterAll(async () => {
    await prisma.pendingFlightUpdate.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  async function makeProposal(owner: string) {
    return prisma.pendingFlightUpdate.create({
      data: {
        userId: owner,
        flightId,
        originalData: {} as object,
        proposedData: { gate: "A12" } as object,
        changes: [{ field: "gate", from: null, to: "A12" }] as object,
        apiSource: "airlabs",
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: "pending",
      },
    });
  }

  it("rejects several at once and reports an outcome for each", async () => {
    const a = await makeProposal(userId);
    const b = await makeProposal(userId);

    const res = await request(app)
      .post("/api/v1/pending-updates/reject")
      .set("Cookie", cookie)
      .send({ ids: [a.id, b.id] });

    expect(res.status).toBe(200);
    expect(res.body.requested).toBe(2);
    expect(res.body.rejected).toBe(2);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results.every((r: { status: string }) => r.status === "rejected")).toBe(true);
  });

  it("reports the failures instead of hiding them behind a success flag", async () => {
    // The case the issue is actually about: one real proposal, one id that is
    // not this user's, one that does not exist. A single boolean would either
    // claim total success or total failure; both are lies.
    const mine = await makeProposal(userId);
    const theirs = await makeProposal(otherUserId);

    const res = await request(app)
      .post("/api/v1/pending-updates/reject")
      .set("Cookie", cookie)
      .send({ ids: [mine.id, theirs.id, "00000000-0000-0000-0000-000000000000"] });

    expect(res.status).toBe(200);
    expect(res.body.requested).toBe(3);
    expect(res.body.rejected).toBe(1);
    expect(res.body.failed).toBe(2);

    const byId = Object.fromEntries(
      res.body.results.map((r: { id: string; status: string }) => [r.id, r.status])
    );
    expect(byId[mine.id]).toBe("rejected");
    expect(byId[theirs.id]).toBe("failed");

    // And the other user's proposal is untouched — "not found" must mean not
    // touched, not merely not reported.
    const still = await prisma.pendingFlightUpdate.findUnique({ where: { id: theirs.id } });
    expect(still?.status).toBe("pending");
  });

  it("refuses an empty list and an oversized one", async () => {
    const empty = await request(app)
      .post("/api/v1/pending-updates/reject")
      .set("Cookie", cookie)
      .send({ ids: [] });
    expect(empty.status).toBe(400);

    const huge = await request(app)
      .post("/api/v1/pending-updates/reject")
      .set("Cookie", cookie)
      .send({ ids: Array.from({ length: 201 }, (_, i) => `id-${i}`) });
    expect(huge.status).toBe(400);
  });
});
