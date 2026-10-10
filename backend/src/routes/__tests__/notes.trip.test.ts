import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { TRIP_NOTES_MAX } from "../../services/notes/tripNotes";
import {
  makeAccount,
  makeFullTrip,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * Notes on a trip's days and the private/shareable flag (forgejo#146,
 * `docs/superpowers/specs/2026-10-10-note-visibility.md`). The trip of
 * `makeFullTrip` runs from 2025-05-01 to 2025-05-08.
 */

const note = (
  owner: TestAccount,
  body: string,
  utc: string,
  zone: string,
  visibility: "private" | "shareable" = "private"
) =>
  prisma.note.create({
    data: {
      userId: owner.id,
      body,
      occurredAt: new Date(utc),
      occurredZone: zone,
      visibility,
      lat: 38.7223,
      lon: -9.1393,
    },
  });

const tripNotes = (as: TestAccount, tripId: string) =>
  request(app).get(`/api/v1/notes/trip/${tripId}`).set("Cookie", as.cookie);

describe("notes on a trip's days", () => {
  let anna: TestAccount;
  let eve: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    eve = await makeAccount("eve");
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("matches a note by its day on its own clock, oldest first, private and shareable alike", async () => {
    const { trip } = await makeFullTrip(anna);
    // 00:30 in Tokyo on the 1st is still the 30th in UTC — on the trip.
    await note(anna, "Tokyo, first morning", "2025-04-30T15:30:00Z", "Asia/Tokyo");
    // 23:30 in New York on the 30th is the 1st in UTC — before the trip.
    await note(anna, "New York, the night before", "2025-05-01T03:30:00Z", "America/New_York");
    // 00:30 in Berlin on the 9th is the 8th in UTC — after the trip.
    await note(anna, "Berlin, home again", "2025-05-08T22:30:00Z", "Europe/Berlin");
    await note(anna, "Lisbon, last evening", "2025-05-08T21:00:00Z", "Europe/Lisbon", "shareable");
    await note(anna, "Lisbon, tram 28", "2025-05-03T10:00:00Z", "Europe/Lisbon");

    const res = await tripNotes(anna, trip.id).expect(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.span).toEqual({
      start: { date: "2025-05-01", zone: "Europe/Berlin", precision: "day" },
      end: { date: "2025-05-08", zone: "Europe/Lisbon", precision: "day" },
    });
    expect(data.notes.map((n: { body: string }) => n.body)).toEqual([
      "Tokyo, first morning",
      "Lisbon, tram 28",
      "Lisbon, last evening",
    ]);
    expect(data.notes[2].visibility).toBe("shareable");
    expect(data.notes[1].visibility).toBe("private");
    expect(data.memberNotes).toEqual([]);
    expect(data.truncated).toBe(false);
  });

  it("answers 404 for another account's trip and a malformed id, and never lists another account's notes", async () => {
    const { trip } = await makeFullTrip(anna);
    await note(eve, "Eve was in Lisbon too", "2025-05-03T10:00:00Z", "Europe/Lisbon", "shareable");

    const foreign = await tripNotes(eve, trip.id).expect(404);
    expect(foreign.body.code).toBe("TRIP_NOT_FOUND");
    expect((await tripNotes(anna, "not-a-uuid").expect(404)).body.code).toBe("TRIP_NOT_FOUND");
    const own = await tripNotes(anna, trip.id).expect(200);
    expect(JSON.stringify(own.body)).not.toContain("Eve was in Lisbon");
  });

  it("places no note on a trip without a first or last day", async () => {
    const trip = await prisma.trip.create({ data: { userId: anna.id, name: "Someday" } });
    await note(anna, "Some note", "2025-05-03T10:00:00Z", "Europe/Lisbon");
    const res = await tripNotes(anna, trip.id).expect(200);
    expect(res.body.data).toEqual({ span: null, notes: [], memberNotes: [], truncated: false });
  });

  it("says so when the bound cuts the list", async () => {
    const { trip } = await makeFullTrip(anna);
    await prisma.note.createMany({
      data: Array.from({ length: TRIP_NOTES_MAX + 1 }, (_, i) => ({
        userId: anna.id,
        body: `n${i}`,
        occurredAt: new Date(Date.parse("2025-05-04T08:00:00Z") + i * 60_000),
        occurredZone: "Europe/Lisbon",
      })),
    });
    const res = await tripNotes(anna, trip.id).expect(200);
    expect(res.body.data.notes).toHaveLength(TRIP_NOTES_MAX);
    expect(res.body.data.truncated).toBe(true);
  });
});

describe("notes on a shared trip", () => {
  let anna: TestAccount;
  let ben: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
  });

  it("shows a member the other's SHAREABLE notes only — never a private one", async () => {
    const { full, memberTrip } = await sharedPair(anna, ben);
    await note(
      anna,
      "Anna's shareable sunset",
      "2025-05-04T19:00:00Z",
      "Europe/Lisbon",
      "shareable"
    );
    await note(anna, "PRIVATE diary of Anna", "2025-05-04T21:00:00Z", "Europe/Lisbon");
    await note(ben, "Ben's own private line", "2025-05-05T09:00:00Z", "Europe/Lisbon");

    const forBen = await tripNotes(ben, memberTrip.id).expect(200);
    expect(forBen.body.data.notes.map((n: { body: string }) => n.body)).toEqual([
      "Ben's own private line",
    ]);
    expect(forBen.body.data.memberNotes).toHaveLength(1);
    const shared = forBen.body.data.memberNotes[0];
    expect(shared.body).toBe("Anna's shareable sunset");
    expect(shared.author).toMatchObject({ id: anna.id, displayName: "anna" });
    expect(shared.times.day.date).toBe("2025-05-04");
    // A member reads text, place and moment — no position, photo or owner id.
    expect(Object.keys(shared).sort()).toEqual(["author", "body", "id", "placeName", "times"]);
    expect(JSON.stringify(forBen.body)).not.toContain("PRIVATE diary of Anna");

    // And the other way round: Ben's private line stays with Ben.
    const forAnna = await tripNotes(anna, full.trip.id).expect(200);
    expect(forAnna.body.data.memberNotes).toEqual([]);
    expect(JSON.stringify(forAnna.body)).not.toContain("Ben's own private line");
  });

  it("hides a note at once when its owner makes it private again", async () => {
    const { memberTrip } = await sharedPair(anna, ben);
    const shared = await note(anna, "Was shareable", "2025-05-04T19:00:00Z", "UTC", "shareable");
    expect((await tripNotes(ben, memberTrip.id)).body.data.memberNotes).toHaveLength(1);

    await request(app)
      .patch(`/api/v1/notes/${shared.id}`)
      .set("Cookie", anna.cookie)
      .send({ visibility: "private" })
      .expect(200);
    expect((await tripNotes(ben, memberTrip.id)).body.data.memberNotes).toEqual([]);
  });

  it("reads only the days of the member's own shared trip", async () => {
    const { full, memberTrip } = await sharedPair(anna, ben);
    // Ben's copy keeps the days; Anna's trip is shortened to 1–3 May afterwards.
    await prisma.trip.update({
      where: { id: full.trip.id },
      data: { endDay: new Date("2025-05-03T00:00:00Z"), endDate: new Date("2025-05-03T00:00:00Z") },
    });
    await note(anna, "Inside Anna's trip", "2025-05-02T10:00:00Z", "UTC", "shareable");
    await note(anna, "After Anna's trip", "2025-05-06T10:00:00Z", "UTC", "shareable");
    const res = await tripNotes(ben, memberTrip.id).expect(200);
    expect(res.body.data.memberNotes.map((n: { body: string }) => n.body)).toEqual([
      "Inside Anna's trip",
    ]);
  });

  it("stops showing a member's notes once consent between the two is withdrawn", async () => {
    const { memberTrip } = await sharedPair(anna, ben);
    await note(anna, "Shareable", "2025-05-04T19:00:00Z", "UTC", "shareable");
    await prisma.shareConsent.updateMany({
      where: { requesterId: anna.id, targetId: ben.id },
      data: { status: "withdrawn" },
    });
    const res = await tripNotes(ben, memberTrip.id).expect(200);
    expect(res.body.data.memberNotes).toEqual([]);
  });
});

describe("the private/shareable flag on a note", () => {
  let anna: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
  });

  const write = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/v1/notes")
      .set("Cookie", anna.cookie)
      .send({ body: "A line", occurredAt: { local: "2025-05-04T10:00", zone: "UTC" }, ...body });

  it("is private unless the writer says otherwise", async () => {
    const res = await write({}).expect(201);
    expect(res.body.data.visibility).toBe("private");
    const shared = await write({ visibility: "shareable" }).expect(201);
    expect(shared.body.data.visibility).toBe("shareable");
  });

  it("refuses a value outside the vocabulary instead of storing it", async () => {
    await write({ visibility: "public" }).expect(400);
    const created = await write({}).expect(201);
    await request(app)
      .patch(`/api/v1/notes/${created.body.data.id}`)
      .set("Cookie", anna.cookie)
      .send({ visibility: "everyone" })
      .expect(400);
    expect(await prisma.note.count({ where: { userId: anna.id } })).toBe(1);
  });

  it("leaves the flag alone on an edit that does not name it", async () => {
    const created = await write({ visibility: "shareable" }).expect(201);
    const edited = await request(app)
      .patch(`/api/v1/notes/${created.body.data.id}`)
      .set("Cookie", anna.cookie)
      .send({ body: "Edited" })
      .expect(200);
    expect(edited.body.data.visibility).toBe("shareable");
  });
});
