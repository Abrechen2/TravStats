/**
 * Data-integrity audit 2026-09-19 — the SCOPE of the demo reset.
 *
 * `seedDemoAccount.ts` runs on every boot with `CREATE_DEMO_USER=true` and is
 * the only thing that empties an account wholesale without a click. The
 * question here is what it reaches: does it delete the demo user's rows and
 * nothing else — not a second user's, not the shared catalogues'?
 *
 * WHICH account it picks is the other question, and it is NOT asked here.
 * `ensureUser()` takes the username from a constant, so the only way to pose
 * it is to make the `demo` row itself look like somebody else's — and on a
 * database that already has a demo account, that means writing a foreign
 * password hash onto a row this suite does not own. `seedDemoAccount.isDemo`
 * asks it instead: that suite deletes and recreates the demo row around every
 * case, which is its documented convention, so it can shape the row freely.
 *
 * This one never writes to a pre-existing demo account beyond what
 * `ensureUser()` itself does, and it removes every row it created.
 */
import { prisma } from "../../db";
import { ensureUser } from "../../seedDemoAccount";
import { DEMO_USERNAME } from "../../utils/sharedDemo";

const TAG = `i2scope-${Date.now()}`;
let otherId = "";
let demoId = "";
let demoPreexisted = false;
let seededOwnDemoContent = false;
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
    // Used as found, and NOTHING is written into it — not a credential, and
    // not a row.
    //
    // Seeding content here was a real race, measured in 1 of 4 full-gate runs
    // on 2026-09-19: `seedDemoAccount.isDemo.test.ts` deletes and recreates
    // the `demo` row by id in its `beforeEach`, so a row this suite had
    // inserted under the old id was cascaded away mid-insert. The symptom was
    // `places_user_id_fkey` violations here and a failing `afterAll` delete —
    // neither of which says anything about the code under test.
    //
    // The single `demo` username is shared by three suites and cannot be
    // parameterised (`ensureUser()` reads it from a constant), so the only
    // safe rule is: a suite writes rows only into an account it created
    // itself. On this branch the wipe is therefore observed against whatever
    // the account already holds, which is enough — what the reset must not
    // touch is the second user, and that is asserted in full either way.
    demoId = existingDemo.id;
  } else {
    // Ours, so it can be filled: a genuine demo account with content to
    // remove. The flag is what the seeder goes by since the 2026-09-19 fix.
    const created = await prisma.user.create({
      data: { username: DEMO_USERNAME, passwordHash: "seeded-demo-hash", isDemo: true },
    });
    demoId = created.id;
    await seedContentFor(demoId, `${TAG}-demo`);
    seededOwnDemoContent = true;
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
    // At least the rows this suite seeded, when it seeded any. On a database
    // that already had a demo account this suite adds nothing to it (see
    // `beforeAll`), so the floor is whatever that account happens to hold —
    // possibly zero, which still lets the assertion that matters run: after
    // the reset, every count is zero.
    const before = await countsFor(demoId);
    const floor = seededOwnDemoContent ? 1 : 0;
    expect(before.flights).toBeGreaterThanOrEqual(floor);
    expect(before.documents).toBeGreaterThanOrEqual(floor * 2);

    // Read back rather than compared to the id captured in `beforeAll`: the
    // same neighbouring suite may have deleted and recreated the row under a
    // new id in between, and a mismatch there would be that suite's timing,
    // not this one's subject. What must hold is that the seeder picks the
    // account CURRENTLY called `demo` and empties it.
    const returned = await ensureUser();
    const demoNow = await prisma.user.findUniqueOrThrow({
      where: { username: DEMO_USERNAME },
      select: { id: true },
    });
    expect(returned).toBe(demoNow.id);

    const after = await countsFor(returned);
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

  it("clears the reset account's PasswordResetRequest", async () => {
    // `PasswordResetRequest` arrived on 2026-09-19 (migration
    // 20260919140631_password_reset_requests) and was in none of the three
    // lists in `wipeDemoUser`'s enumeration — the same omission `Document`
    // had two days earlier. It carries no token (the row is an ADMIN INBOX
    // item: "this user asked"), so what survived a reset was an open admin
    // task about an account that no longer held the data it was raised for,
    // not a credential.
    await prisma.passwordResetRequest.create({ data: { userId: demoId } });
    await ensureUser();
    const left = await prisma.passwordResetRequest.count({ where: { userId: demoId } });
    expect(left).toBe(0);
  });
});
