import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { prisma } from "../../../db";
import { now } from "../../../shared/time/clock";

/**
 * An itinerary link's end is only ever LOWERED as the trip moves. Two
 * settlements that read the row, then compute and write in reverse order used
 * to let the slower one write its later end over the earlier one already
 * stored — an end raised after all, which is the one thing the rule forbids.
 */
const newGate = (): { open: () => void; wait: Promise<void> } => {
  let open = () => {};
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { open: () => open(), wait };
};
let gate = newGate();
let loads = 0;

jest.mock("../tripView", () => {
  const actual = jest.requireActual<typeof import("../tripView")>("../tripView");
  return {
    ...actual,
    // The first load is held until the second settlement has finished.
    loadOwnedTrip: async (userId: string, tripId: string) => {
      loads += 1;
      if (loads === 1) await gate.wait;
      return actual.loadOwnedTrip(userId, tripId);
    },
  };
});

const autoExpiry = jest.fn<(end: unknown) => Date | null>();
jest.mock("../itineraryNow", () => ({
  ...jest.requireActual<object>("../itineraryNow"),
  itineraryAutoExpiry: (end: unknown) => autoExpiry(end),
}));

// Imported after the mocks so it binds to them.
import { listShareLinks } from "../linkService";

const USERNAME = `sharelink-race-${Date.now()}`;
const DAY = 86_400_000;

describe("itinerary link expiry — two settlements in reverse order", () => {
  let userId: string;

  beforeEach(async () => {
    gate = newGate();
    loads = 0;
    autoExpiry.mockReset();
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({ data: { username: USERNAME, passwordHash: "x" } });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  it("never lets the slower settlement raise an end the faster one lowered", async () => {
    const at = now().getTime();
    const trip = await prisma.trip.create({ data: { userId, name: "Race" } });
    const stored = new Date(at + 30 * DAY);
    const link = await prisma.publicShareLink.create({
      data: {
        userId,
        kind: "trip",
        tripId: trip.id,
        fields: ["itinerary"],
        tokenHash: `race-${trip.id}`,
        expiresAt: stored,
        effectiveExpiresAt: stored,
      },
    });
    const lower = new Date(at + 5 * DAY);
    const higher = new Date(at + 10 * DAY);
    // The fast settlement computes the lower end and stores it first; the slow
    // one, holding a stale view of the trip, computes the higher end after.
    autoExpiry.mockReturnValueOnce(lower).mockReturnValueOnce(higher);

    const slow = listShareLinks(userId);
    while (loads < 1) await new Promise((r) => setImmediate(r));
    const fast = await listShareLinks(userId);
    gate.open();
    const slowResult = await slow;

    expect(fast[0].effectiveExpiresAt).toBe(lower.toISOString());
    const row = await prisma.publicShareLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(row.effectiveExpiresAt.toISOString()).toBe(lower.toISOString());
    expect(slowResult[0].effectiveExpiresAt).toBe(lower.toISOString());
  });

  it("answers the stored end when the slower settlement finds nothing to lower", async () => {
    // A read the end before B lowered it; A's trip was then extended, so A
    // computes no earlier end and must not answer the end it read.
    const at = now().getTime();
    const trip = await prisma.trip.create({ data: { userId, name: "Race extended" } });
    const stored = new Date(at + 30 * DAY);
    await prisma.publicShareLink.create({
      data: {
        userId,
        kind: "trip",
        tripId: trip.id,
        fields: ["itinerary"],
        tokenHash: `race-ext-${trip.id}`,
        expiresAt: stored,
        effectiveExpiresAt: stored,
      },
    });
    const lower = new Date(at + 5 * DAY);
    autoExpiry.mockReturnValueOnce(lower).mockReturnValueOnce(new Date(at + 60 * DAY));

    const slow = listShareLinks(userId);
    while (loads < 1) await new Promise((r) => setImmediate(r));
    await listShareLinks(userId);
    gate.open();
    const slowResult = await slow;

    expect(slowResult[0].effectiveExpiresAt).toBe(lower.toISOString());
  });
});
