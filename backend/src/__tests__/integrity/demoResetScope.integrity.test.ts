/**
 * Auditor I2, data-integrity audit 2026-09-19 — NOT COMMITTED.
 *
 * Two questions about the demo reset (`seedDemoAccount.ts`, run on every boot
 * with `CREATE_DEMO_USER=true`, and the only thing that empties an account
 * wholesale without a click):
 *
 *  1. Does it delete ONLY the shared demo user's rows?  (scope)
 *  2. WHICH account does it pick?  `ensureUser()` looks the account up by
 *     `username = "demo"` alone. It never asks whether the row it found is the
 *     seeded demo account (`isDemo`), and no reserved-username list stops a real
 *     person from registering that name.
 *
 * The test creates its own throwaway `demo` user and deletes it again, so it
 * leaves the shared 5437 database exactly as it found it.
 */
import { prisma } from "../../db";
import { ensureUser } from "../../seedDemoAccount";
import { DEMO_USERNAME } from "../../utils/sharedDemo";

const TAG = `i2scope-${Date.now()}`;
let otherId = "";
let demoId = "";
let demoPreexisted = false;
let otherBefore: Record<string, number> = {};
let userAddedAirportId = 0;
let userAddedChainId = 0;

async function countsFor(userId: string): Promise<Record<string, number>> {
  const [flights, lodgings, stays, places, visits, trips, journal, documents, templates, batches] =
    await Promise.all([
      prisma.flight.count({ where: { userId } }),
      prisma.lodging.count({ where: { userId } }),
      prisma.lodgingStay.count({ where: { userId } }),
      prisma.place.count({ where: { userId } }),
      prisma.placeVisit.count({ where: { userId } }),
      prisma.trip.count({ where: { userId } }),
      prisma.tripJournalEntry.count({ where: { trip: { userId } } }),
      prisma.document.count({ where: { userId } }),
      prisma.parserTemplate.count({ where: { userId } }),
      prisma.importBatch.count({ where: { userId } }),
    ]);
  return {
    flights,
    lodgings,
    stays,
    places,
    visits,
    trips,
    journal,
    documents,
    templates,
    batches,
  };
}

async function seedContentFor(userId: string, tag: string): Promise<void> {
  const batch = await prisma.importBatch.create({
    data: { userId, domain: "lodging", source: "csv", fileName: `${tag}.csv` },
  });
  const trip = await prisma.trip.create({ data: { userId, name: `${tag}-trip` } });
  await prisma.tripJournalEntry.create({
    data: { tripId: trip.id, date: new Date(), title: `${tag}-j`, body: "handwritten" },
  });
  await prisma.flight.create({
    data: {
      userId,
      flightNumber: "LH123",
      depLat: 48.3,
      depLon: 11.7,
      arrLat: 50.0,
      arrLon: 8.5,
      tripId: trip.id,
    },
  });
  const lodging = await prisma.lodging.create({
    data: { userId, name: `${tag}-hotel`, batchId: batch.id },
  });
  const stay = await prisma.lodgingStay.create({
    data: { userId, lodgingId: lodging.id, checkIn: new Date(), batchId: batch.id },
  });
  const place = await prisma.place.create({
    data: { userId, name: `${tag}-place`, lat: 48.1, lon: 11.6, batchId: batch.id },
  });
  await prisma.placeVisit.create({ data: { userId, placeId: place.id } });
  await prisma.parserTemplate.create({
    data: { userId, name: `${tag}-tpl`, fingerprint: {}, patterns: {} },
  });
  await prisma.document.create({
    data: {
      userId,
      storedName: `${tag}-a.pdf`,
      mimetype: "application/pdf",
      sizeBytes: 1,
      sha256: `${tag}a`,
      format: "pdf",
      lodgingStayId: stay.id,
    },
  });
  await prisma.document.create({
    data: {
      userId,
      storedName: `${tag}-b.pdf`,
      mimetype: "application/pdf",
      sizeBytes: 1,
      sha256: `${tag}b`,
      format: "pdf",
    },
  });
}

beforeAll(async () => {
  const other = await prisma.user.create({
    data: { username: `${TAG}-other`, passwordHash: "hash-other" },
  });
  otherId = other.id;
  await seedContentFor(otherId, `${TAG}-other`);

  // Catalogue rows this user added — the reset must never touch the catalogues.
  const airport = await prisma.airport.create({
    data: { name: `${TAG}-airport`, lat: 1, lon: 1, isUserAdded: true },
  });
  userAddedAirportId = airport.id;
  const chain = await prisma.lodgingChain.create({
    data: { name: `${TAG}-chain`, isUserAdded: true },
  });
  userAddedChainId = chain.id;

  otherBefore = await countsFor(otherId);

  const existingDemo = await prisma.user.findUnique({ where: { username: DEMO_USERNAME } });
  demoPreexisted = existingDemo !== null;
  if (existingDemo) {
    demoId = existingDemo.id;
  } else {
    // Deliberately NOT a demo account: a real person who registered the name.
    const created = await prisma.user.create({
      data: {
        username: DEMO_USERNAME,
        passwordHash: "a-real-persons-hash",
        isDemo: false,
        firstName: "Real",
      },
    });
    demoId = created.id;
    await seedContentFor(demoId, `${TAG}-demo`);
  }
});

afterAll(async () => {
  if (!demoPreexisted && demoId) {
    await prisma.user.delete({ where: { id: demoId } });
  }
  await prisma.user.deleteMany({ where: { username: { startsWith: TAG } } });
  await prisma.airport.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.lodgingChain.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("the demo reset (ensureUser -> wipeDemoUser)", () => {
  it("empties the account it picked", async () => {
    expect(demoPreexisted).toBe(false); // the throwaway account this test made
    const before = await countsFor(demoId);
    expect(before.flights).toBe(1);
    expect(before.documents).toBe(2);

    const returned = await ensureUser();
    expect(returned).toBe(demoId);

    const after = await countsFor(demoId);
    expect(after).toEqual({
      flights: 0,
      lodgings: 0,
      stays: 0,
      places: 0,
      visits: 0,
      trips: 0,
      journal: 0,
      documents: 0,
      templates: 0,
      batches: 0,
    });
  });

  it("leaves every row of a DIFFERENT user untouched", async () => {
    expect(await countsFor(otherId)).toEqual(otherBefore);
  });

  it("leaves catalogue rows another user added untouched", async () => {
    expect(await prisma.airport.findUnique({ where: { id: userAddedAirportId } })).not.toBeNull();
    expect(
      await prisma.lodgingChain.findUnique({ where: { id: userAddedChainId } })
    ).not.toBeNull();
  });

  it("picked an account that was NOT a demo account, and took it over", async () => {
    // The finding: no `isDemo` check, no reserved-username list. The row this
    // test created had `isDemo: false`, a private password hash and a first
    // name — after the reset it is the public shared login.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: demoId } });
    expect(after.isDemo).toBe(true);
    expect(after.passwordHash).not.toBe("a-real-persons-hash");
    expect(after.firstName).toBeNull();
  });

  it("does NOT clear the reset account's PasswordResetRequest (a gap, low harm)", async () => {
    // `PasswordResetRequest` arrived on 2026-09-19 (migration
    // 20260919140631_password_reset_requests) and is in neither of the three
    // lists in `wipeDemoUser`'s enumeration — the same omission `Document` had.
    // It carries no token (the row is an ADMIN INBOX item: "this user asked"),
    // so the consequence is an open admin task about an account that no longer
    // holds the data it was raised for, not a credential leak.
    await prisma.passwordResetRequest.create({ data: { userId: demoId } });
    await ensureUser();
    const left = await prisma.passwordResetRequest.count({ where: { userId: demoId } });
    expect(left).toBe(1);
  });
});
