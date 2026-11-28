import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import {
  linkWithConsent,
  makeAccount,
  makeFullTrip,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * Owner decision 2026-11-28, after sharing UAT 2: an entry only one copy of a linked trip holds is
 * NEVER added silently. The dry run lists it unticked, with a duplicate warning where the other side
 * holds something similar; only the ticked refs are created on the other side, with the link's key
 * so they sync; leaving the group (the undo) removes what the link added.
 */
const rail = (owner: TestAccount, tripId: string, over: object = {}) =>
  prisma.railJourney.create({
    data: {
      userId: owner.id,
      tripId,
      operator: "VR",
      trainNumber: "961",
      depStationName: "Helsinki",
      depLat: 60.17,
      depLon: 24.94,
      arrStationName: "Turku",
      arrLat: 60.45,
      arrLon: 22.25,
      departureTime: new Date("2025-05-02T06:00:00Z"),
      arrivalTime: new Date("2025-05-02T08:00:00Z"),
      ...over,
    },
  });

describe("one-sided entries in a link (owner, 2026-11-28)", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let annas: Awaited<ReturnType<typeof makeFullTrip>>;
  let bens: Awaited<ReturnType<typeof makeFullTrip>>;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-os");
    ben = await makeAccount("ben-os");
    annas = await makeFullTrip(anna);
    bens = await makeFullTrip(ben);
    await linkWithConsent(anna, ben);
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const as = (u: TestAccount) => ({
    post: (url: string, body: object = {}) =>
      request(app).post(`/api/v1/sharing${url}`).set("Cookie", u.cookie).send(body),
  });
  const proposal = async () =>
    (await as(anna).post(`/trips/${annas.trip.id}/link-proposal`, { userId: ben.id }).expect(200))
      .body.data.id as string;
  const railsOf = (u: TestAccount, tripId: string) =>
    prisma.railJourney.findMany({
      where: { userId: u.id, tripId, depStationName: "Helsinki" },
      orderBy: { createdAt: "asc" },
    });

  it("adds nothing one-sided the person did not tick", async () => {
    const extra = await rail(anna, annas.trip.id);
    const id = await proposal();
    const preview = await as(ben)
      .post(`/link-proposals/${id}/preview`, { tripId: bens.trip.id })
      .expect(200);
    const only = preview.body.data.onlyThere as { ref: string; duplicateOf: unknown }[];
    expect(only.find((o) => o.ref === `rail:${extra.id}`)).toMatchObject({ duplicateOf: null });
    const plain = await as(ben)
      .post(`/link-proposals/${id}/link`, { tripId: bens.trip.id, decision: "best" })
      .expect(200);
    expect(plain.body.data.added).toBe(0);
    expect(await railsOf(ben, bens.trip.id)).toHaveLength(0);
  });

  it("creates a ticked entry on the other side with the link's key, and the undo removes it", async () => {
    const extra = await rail(anna, annas.trip.id);
    const id = await proposal();
    const linked = await as(ben)
      .post(`/link-proposals/${id}/link`, {
        tripId: bens.trip.id,
        decision: "best",
        add: [`rail:${extra.id}`],
      })
      .expect(200);
    expect(linked.body.data.added).toBe(1);
    const [copy] = await railsOf(ben, bens.trip.id);
    const original = await prisma.railJourney.findUniqueOrThrow({ where: { id: extra.id } });
    expect(copy).toMatchObject({ trainNumber: "961", depStationName: "Helsinki" });
    expect(copy.shareKey).not.toBeNull();
    expect(copy.shareKey).toBe(original.shareKey);

    // The undo: Ben leaves; the added copy goes, Anna keeps her own ride.
    await as(ben).post(`/trips/${bens.trip.id}/leave`).expect(200);
    expect(await railsOf(ben, bens.trip.id)).toHaveLength(0);
    expect(await railsOf(anna, annas.trip.id)).toHaveLength(1);
  });

  it("warns that a one-sided entry is perhaps a duplicate of one on the other side", async () => {
    // Same train number and day, but another departure time: not the same journey for the
    // matcher, yet perhaps the same ride.
    await rail(anna, annas.trip.id);
    await rail(ben, bens.trip.id, {
      departureTime: new Date("2025-05-02T09:00:00Z"),
      arrivalTime: new Date("2025-05-02T11:00:00Z"),
      depStationName: "Helsingfors",
      arrStationName: "Åbo",
    });
    const id = await proposal();
    const preview = await as(ben)
      .post(`/link-proposals/${id}/preview`, { tripId: bens.trip.id })
      .expect(200);
    const there = (preview.body.data.onlyThere as { entity: string; duplicateOf: unknown }[]).find(
      (o) => o.entity === "rail"
    );
    expect(there?.duplicateOf).toMatchObject({ label: expect.stringContaining("Helsingfors") });
  });
});
