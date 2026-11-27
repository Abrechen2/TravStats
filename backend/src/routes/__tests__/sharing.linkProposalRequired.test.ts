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
 * Codex P1 (2026-11-27): B's "may offer trips" consent let A list B's unshared trips
 * (link-candidates), read their entries (link-preview) and attach or overwrite them (link,
 * `mine`). An offer consent authorises incoming offers only: nothing of B's existing trips is
 * shown to A, and nothing is linked, without B's own decision per trip.
 */
describe("linking another account's trip needs that account's decision (Codex P1)", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let annas: Awaited<ReturnType<typeof makeFullTrip>>;
  let bens: Awaited<ReturnType<typeof makeFullTrip>>;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-p1");
    ben = await makeAccount("ben-p1");
    annas = await makeFullTrip(anna);
    bens = await makeFullTrip(ben);
    await prisma.trip.update({ where: { id: bens.trip.id }, data: { name: "Bens Geheimreise" } });
    await prisma.flight.update({
      where: { id: bens.flight.id },
      data: { departureTime: new Date("2025-05-01T08:30:00.000Z") },
    });
    // Ben lets Anna OFFER him trips — nothing more.
    await linkWithConsent(anna, ben);
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const refused = (res: request.Response) => {
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SHARE_LINK_PROPOSAL_REQUIRED");
    expect(JSON.stringify(res.body)).not.toContain("Geheimreise");
    expect(JSON.stringify(res.body)).not.toContain(bens.trip.id);
  };

  it("A cannot list B's trips with only an offer consent", async () => {
    refused(
      await request(app)
        .get(`/api/v1/sharing/trips/${annas.trip.id}/link-candidates`)
        .query({ userId: ben.id })
        .set("Cookie", anna.cookie)
    );
    refused(
      await request(app)
        .get("/api/v1/sharing/link-bulk")
        .query({ userId: ben.id })
        .set("Cookie", anna.cookie)
    );
  });

  it("A cannot preview B's trip", async () => {
    refused(
      await request(app)
        .post(`/api/v1/sharing/trips/${annas.trip.id}/link-preview`)
        .set("Cookie", anna.cookie)
        .send({ userId: ben.id, targetTripId: bens.trip.id })
    );
  });

  it("A's link with 'mine' neither links nor overwrites anything of B's", async () => {
    refused(
      await request(app)
        .post(`/api/v1/sharing/trips/${annas.trip.id}/link`)
        .set("Cookie", anna.cookie)
        .send({ userId: ben.id, targetTripId: bens.trip.id, decision: "mine" })
    );
    const bensTrip = await prisma.trip.findUniqueOrThrow({ where: { id: bens.trip.id } });
    const bensFlight = await prisma.flight.findUniqueOrThrow({ where: { id: bens.flight.id } });
    expect(bensTrip.shareGroupId).toBeNull();
    expect(bensFlight.shareKey).toBeNull();
    expect(bensFlight.departureTime.toISOString()).toBe("2025-05-01T08:30:00.000Z");
  });

  it("B cannot read A's trip either without A's own decision", async () => {
    await linkWithConsent(ben, anna);
    refused(
      await request(app)
        .post(`/api/v1/sharing/trips/${bens.trip.id}/link-preview`)
        .set("Cookie", ben.cookie)
        .send({ userId: anna.id, targetTripId: annas.trip.id })
    );
  });
});
