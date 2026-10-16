import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { shareTrip } from "../../services/sharing/shareTrip";
import {
  linkWithConsent,
  makeAccount,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * A deactivated account is out of every share (rework 2026-10-16): no new
 * copy, no update and no notice lands in it while it is switched off — the
 * same list feeds the copy, the update and the removal notice.
 */
describe("trip sharing — a deactivated member receives nothing", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let cleo: TestAccount;
  let tripId: string;
  let rideId: string;

  const post = (who: TestAccount, url: string, body: object) =>
    request(app).post(`/api/v1${url}`).set("Cookie", who.cookie).send(body);
  const rides = (who: TestAccount) => prisma.busJourney.count({ where: { userId: who.id } });
  const notices = (who: TestAccount) => prisma.shareNotice.count({ where: { userId: who.id } });

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-inactive");
    ben = await makeAccount("ben-inactive");
    cleo = await makeAccount("cleo-inactive");
    tripId = (
      await prisma.trip.create({
        data: { userId: anna.id, name: "Busreise", startDate: new Date("2026-05-08T00:00:00Z") },
      })
    ).id;
    rideId = (
      await prisma.busJourney.create({
        data: {
          userId: anna.id,
          tripId,
          operator: "FlixBus",
          depStationName: "Lisboa Sete Rios",
          depLat: 38.73,
          depLon: -9.17,
          depTimezone: "Europe/Lisbon",
          arrStationName: "Porto Campanhã",
          arrLat: 41.15,
          arrLon: -8.59,
          arrTimezone: "Europe/Lisbon",
          departureTime: new Date("2026-05-08T09:15:00Z"),
          status: "scheduled",
        },
      })
    ).id;
    await shareTrip(anna.id, tripId, (await linkWithConsent(anna, ben)).id);
    await linkWithConsent(ben, cleo); // the onward-share rule: Cleo may join only with Ben's consent
    await shareTrip(anna.id, tripId, (await linkWithConsent(anna, cleo)).id);
    await prisma.shareNotice.deleteMany({ where: { userId: { in: [ben.id, cleo.id] } } });
    await prisma.user.update({ where: { id: ben.id }, data: { isActive: false } });
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("gets no copy when the actor adds an entry; an active member does", async () => {
    await post(anna, "/bus", {
      tripId,
      operator: "Alsa",
      departureStation: { name: "Porto Campanhã", lat: 41.15, lon: -8.59, country: "PT" },
      arrivalStation: { name: "Braga", lat: 41.55, lon: -8.42, country: "PT" },
      departureLocal: "2026-05-09T10:00",
    }).expect(201);
    expect(await rides(ben)).toBe(1);
    expect(await notices(ben)).toBe(0);
    expect(await rides(cleo)).toBe(2);
  });

  it("gets neither the update nor the removal notice", async () => {
    await request(app)
      .patch(`/api/v1/bus/${rideId}`)
      .set("Cookie", anna.cookie)
      .send({ operator: "Rede Expressos" })
      .expect(200);
    await request(app).delete(`/api/v1/bus/${rideId}`).set("Cookie", anna.cookie).expect(204);
    const bens = await prisma.busJourney.findFirstOrThrow({ where: { userId: ben.id } });
    expect(bens.operator).toBe("FlixBus");
    expect(await notices(ben)).toBe(0);
    expect(await notices(cleo)).toBeGreaterThan(0);
  });
});
