import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import {
  linkWithConsent,
  makeAccount,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * "Alle passenden Reisen verknüpfen" on one server (UAT 2026-11-27): every trip pair is listed
 * after consent only, one trip to one trip, two equally good matches are not guessed, a linked
 * pair comes back as linked (a repeat duplicates nothing) and leaving undoes one pair.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function trip(owner: TestAccount, name: string, from: string, to: string) {
  return prisma.trip.create({
    data: { userId: owner.id, name, startDay: day(from), endDay: day(to) },
  });
}

async function flight(owner: TestAccount, tripId: string, departure: string) {
  return prisma.flight.create({
    data: {
      userId: owner.id,
      tripId,
      flightNumber: "LH100",
      depIata: "FRA",
      arrIata: "MUC",
      depLat: 50.03,
      depLon: 8.57,
      arrLat: 48.35,
      arrLon: 11.78,
      departureTime: new Date(departure),
      depTimezone: "Europe/Berlin",
    },
  });
}

describe("bulk link on one server (UAT 2026-11-27)", () => {
  let owner: TestAccount;
  let father: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    owner = await makeAccount("owner");
    father = await makeAccount("father");
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const pairs = () =>
    request(app)
      .get("/api/v1/sharing/link-bulk")
      .query({ userId: father.id })
      .set("Cookie", owner.cookie)
      .expect(200);

  it("lists nothing before the father agreed", async () => {
    await trip(owner, "Rom", "2030-04-01", "2030-04-04");
    await trip(father, "Rom", "2030-04-01", "2030-04-04");
    expect((await pairs()).body.data).toEqual({ access: "awaitingConsent" });
  });

  it("pairs one to one, marks a guess as ambiguous, and a linked pair comes back as linked", async () => {
    const rome = await trip(owner, "Rom", "2030-04-01", "2030-04-04");
    const hisRome = await trip(father, "Rom", "2030-04-01", "2030-04-04");
    await flight(owner, rome.id, "2030-04-01T08:00:00Z");
    await flight(father, hisRome.id, "2030-04-01T08:00:00Z");
    // Two trips of his overlap one of the owner's equally: no guess.
    await trip(owner, "Sommer", "2030-07-01", "2030-07-20");
    await trip(father, "Juli A", "2030-07-02", "2030-07-05");
    await trip(father, "Juli B", "2030-07-10", "2030-07-12");
    await linkWithConsent(owner, father);

    const first = (await pairs()).body.data.pairs;
    const romePair = first.find((p: { id: string }) => p.id === rome.id);
    expect(romePair).toMatchObject({
      other: { id: hisRome.id },
      reason: "period",
      linked: false,
      ambiguous: false,
    });
    expect(first.find((p: { trip: { name: string } }) => p.trip.name === "Sommer").ambiguous).toBe(
      true
    );

    const preview = await request(app)
      .post(`/api/v1/sharing/trips/${rome.id}/link-preview`)
      .set("Cookie", owner.cookie)
      .send({ userId: father.id, targetTripId: hisRome.id })
      .expect(200);
    expect(preview.body.data).toMatchObject({ automatic: true, counts: { needsReview: 0 } });
    // The bulk run's budget is its own and announced.
    expect(
      Number(
        preview.headers["ratelimit-limit"] ?? preview.headers["ratelimit-policy"]?.split(";")[0]
      )
    ).toBe(300);

    const link = () =>
      request(app)
        .post(`/api/v1/sharing/trips/${rome.id}/link`)
        .set("Cookie", owner.cookie)
        .send({ userId: father.id, targetTripId: hisRome.id, decision: "best" })
        .expect(200);
    expect((await link()).body.data).toMatchObject({ linked: 1 });
    // Interrupted and run again: nothing linked twice, nothing created.
    expect((await link()).body.data).toMatchObject({ linked: 0, alreadyLinked: 1 });
    expect(await prisma.flight.count({ where: { userId: father.id } })).toBe(1);

    const second = (await pairs()).body.data.pairs;
    expect(second.find((p: { id: string }) => p.id === rome.id)).toMatchObject({ linked: true });

    // Undo per pair: leaving the group.
    await request(app)
      .post(`/api/v1/sharing/trips/${rome.id}/leave`)
      .set("Cookie", owner.cookie)
      .expect(200);
    const third = (await pairs()).body.data.pairs;
    // The pair is detached: no longer listed as linked (the father's trip keeps its own group).
    expect(third.some((p: { id: string; linked: boolean }) => p.id === rome.id && p.linked)).toBe(
      false
    );
  });
});
