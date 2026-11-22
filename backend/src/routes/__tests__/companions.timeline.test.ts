import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { sortTimeline, type TimelineRow } from "../../services/companions/personTimeline";
import { makeFullTrip, type TestAccount } from "./sharingFixtures";

/**
 * One companion's page (spec 2026-11-22-person-timeline.md): the counting
 * rules are "Mit wem unterwegs"'s, planned trips are marked and uncounted,
 * and it is the caller's own data only.
 */
const PREFIX = "person-timeline-";

async function account(name: string, domains: string[]): Promise<TestAccount> {
  const user = await prisma.user.create({
    data: { username: `${PREFIX}${name}`, passwordHash: "x", firstName: name },
  });
  await prisma.userSettings.create({
    data: { userId: user.id, data: {}, enabledDomains: domains },
  });
  return { id: user.id, username: user.username, cookie: `auth_token=${generateToken(user.id)}` };
}

const companion = (userId: string, name: string, extra: Record<string, unknown> = {}) =>
  prisma.companion.create({
    data: {
      userId,
      canonicalName: name.toLowerCase(),
      displayName: name,
      searchName: name,
      ...extra,
    },
  });

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("companions — person timeline", () => {
  let anna: TestAccount;
  let full: Awaited<ReturnType<typeof makeFullTrip>>;
  let benId: string;

  const timeline = (who: TestAccount, id: string) =>
    request(app).get(`/api/v1/companions/${id}/timeline`).set("Cookie", who.cookie);

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    anna = await account("anna", ["flight", "cruise", "rail", "lodging"]);
    full = await makeFullTrip(anna);
    await prisma.railJourney.update({
      where: { id: full.rail.id },
      data: { depCountry: "PT", arrCountry: "PT" },
    });
    await prisma.lodging.update({ where: { id: full.lodging.id }, data: { isoCountryCode: "PT" } });
    const ben = await companion(anna.id, "Ben");
    benId = ben.id;
    await prisma.flightCompanion.create({
      data: {
        flightId: full.flight.id,
        companionId: ben.id,
        position: 0,
        seatNumber: "12A",
        seatClass: "Y",
        loyaltyNumber: "TP-123",
      },
    });
    await prisma.tripCompanion.create({
      data: { tripId: full.trip.id, companionId: ben.id, position: 0 },
    });
    await prisma.railJourneyCompanion.create({
      data: { railJourneyId: full.rail.id, companionId: ben.id, position: 0, seatNumber: "44" },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("counts shared trips, flights, days and first/last day by the together rules", async () => {
    const res = await timeline(anna, benId).expect(200);
    expect(res.body.companion).toMatchObject({ id: benId, name: "Ben", linkedUser: null });
    expect(res.body.summary).toMatchObject({
      firstTogether: "2025-05-01",
      lastTogether: "2025-05-08",
      trips: 1,
      flights: 1,
      entries: 3,
      days: 8,
      plannedTrips: 0,
    });
    expect(res.body.summary.firstJourney.kind).toBe("flight");
  });

  it("counts a stay's nights only after check-out, and abstains on nights when none is dated", async () => {
    // Nothing on a stay yet: zero nights is the truth.
    expect((await timeline(anna, benId)).body.summary.nights).toBe(0);
    await prisma.lodgingStay.update({
      where: { id: full.stay.id },
      data: { companions: ["ben"] },
    });
    const done = await timeline(anna, benId);
    expect(done.body.summary.nights).toBe(3); // 1-4 May fixture
    expect(done.body.summary.countries).toBe(1);
    // A stay still ahead is not counted.
    await prisma.lodgingStay.create({
      data: {
        userId: anna.id,
        lodgingId: full.lodging.id,
        checkIn: day("2099-05-01"),
        checkOut: day("2099-05-04"),
        status: "booked",
        companions: ["Ben"],
      },
    });
    expect((await timeline(anna, benId)).body.summary.nights).toBe(3);
  });

  it("marks a planned trip and counts it nowhere", async () => {
    const future = await prisma.trip.create({
      data: {
        userId: anna.id,
        name: "Madeira 2099",
        status: "planned",
        startDay: day("2099-03-01"),
        endDay: day("2099-03-05"),
        companionLinks: { create: { companionId: benId, position: 0 } },
      },
    });
    const res = await timeline(anna, benId).expect(200);
    expect(res.body.summary).toMatchObject({
      trips: 1,
      plannedTrips: 1,
      lastTogether: "2025-05-08",
    });
    const last = res.body.timeline[res.body.timeline.length - 1];
    expect(last).toMatchObject({ id: future.id, state: "planned", from: "2099-03-01" });
    expect(res.body.timeline.filter((r: { state: string }) => r.state === "happened")).toHaveLength(
      3
    );
  });

  it("orders the list oldest first, undated last, ties stably", () => {
    const row = (id: string, from: string | null, kind: TimelineRow["kind"]): TimelineRow => ({
      kind,
      id,
      href: null,
      title: { text: id },
      subtitle: null,
      from,
      to: from,
      state: "happened",
    });
    const kinds = ["flight", "trip", "rail"] as const;
    const out = sortTimeline(
      [
        row("u", null, "trip"),
        row("b", "2025-05-02", "rail"),
        row("z", "2025-05-01", "trip"),
        row("a", "2025-05-01", "flight"),
      ],
      kinds
    );
    expect(out.map((r) => r.id)).toEqual(["a", "z", "b", "u"]);
  });

  it("lists the seat history and loyalty numbers, never an unset one", async () => {
    const res = await timeline(anna, benId).expect(200);
    expect(res.body.facts.seats.map((s: { seat: string }) => s.seat)).toEqual(["12A", "44"]);
    expect(res.body.facts.loyalty).toEqual([{ number: "TP-123", kinds: ["flight"] }]);
  });

  it("lists the documents assigned to this person only, with their entry", async () => {
    const doc = (name: string) =>
      prisma.document.create({
        data: {
          userId: anna.id,
          storedName: `${PREFIX}${name}`,
          originalName: `${name}.pdf`,
          mimetype: "application/pdf",
          sizeBytes: 1,
          sha256: name,
          format: "pdf",
          kind: "boardingPass",
        },
      });
    const mine = await doc("ben-pass");
    const other = await doc("anna-pass");
    await prisma.documentLink.createMany({
      data: [
        {
          documentId: mine.id,
          flightId: full.flight.id,
          role: "primary",
          provenance: "user",
          companionId: benId,
          companionSource: "user",
        },
        { documentId: other.id, flightId: full.flight.id, role: "covers", provenance: "user" },
      ],
    });
    const res = await timeline(anna, benId).expect(200);
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.documents[0]).toMatchObject({
      id: mine.id,
      name: "ben-pass.pdf",
      entry: { kind: "flight", id: full.flight.id },
    });
  });

  it("is the caller's own: another account, and a linked companion, get 404", async () => {
    const eve = await account("eve", ["flight"]);
    const res = await timeline(eve, benId).expect(404);
    expect(res.body.code ?? res.body.error?.code).toBe("COMPANION_NOT_FOUND");
    // Ben's own account, once linked, still sees nothing of Anna's data.
    const ben = await account("ben", ["flight"]);
    await prisma.companion.update({ where: { id: benId }, data: { linkedUserId: ben.id } });
    await timeline(ben, benId).expect(404);
    const mine = await timeline(anna, benId).expect(200);
    expect(mine.body.companion.linkedUser).toMatchObject({ id: ben.id });
  });

  it("answers an empty person with zero entries and abstains where it cannot know", async () => {
    const cleo = await companion(anna.id, "Cleo");
    const res = await timeline(anna, cleo.id).expect(200);
    expect(res.body.summary).toMatchObject({
      firstTogether: null,
      lastTogether: null,
      firstJourney: null,
      entries: 0,
      days: 0,
      trips: 0,
      flights: 0,
      nights: 0,
      countries: null,
      plannedTrips: 0,
    });
    expect(res.body).toMatchObject({
      timeline: [],
      documents: [],
      facts: { seats: [], loyalty: [] },
    });
  });

  it("follows the domain switch: hidden kinds abstain instead of reading 0", async () => {
    await prisma.userSettings.update({
      where: { userId: anna.id },
      data: { enabledDomains: ["rail"] },
    });
    const res = await timeline(anna, benId).expect(200);
    expect(res.body.summary).toMatchObject({ flights: null, nights: null, trips: 1 });
    expect(res.body.facts.loyalty).toEqual([]);
  });
});
