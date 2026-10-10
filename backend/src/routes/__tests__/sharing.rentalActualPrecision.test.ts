import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { rentalTimes } from "../../services/rental/timesDto";
import { rentalFacts } from "../../services/sharing/facts/rental";
import {
  makeAccount,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * forgejo#278: a shared rental's copy carried the ACTUAL hand-over instants but
 * not how precisely they were known, so a hand-over known only to the day
 * (stored as local midnight) reached the recipient as a claimed 00:00. The
 * copy and every later propagation carry instant, station zone and precision
 * together, and the recipient's `times` DTO equals the sharer's.
 *
 * Every value is invented. Berlin left summer time on 25 Oct 2026 at 03:00:
 * 02:30 happened twice, at 00:30Z and at 01:30Z.
 */
const BERLIN = "Europe/Berlin";

describe("sharing a rental keeps the precision of its actual hand-overs (forgejo#278)", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let pair: Awaited<ReturnType<typeof sharedPair>>;

  const source = () =>
    prisma.rentalBooking.findUniqueOrThrow({ where: { id: pair.full.rental.id } });
  const copy = () => prisma.rentalBooking.findFirstOrThrow({ where: { userId: ben.id } });

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna278");
    ben = await makeAccount("ben278");
    pair = await sharedPair(anna, ben);
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("names the precision columns as facts", () => {
    const facts = rentalFacts({
      actualPickupPrecision: "day",
      actualReturnPrecision: "minute",
    } as never);
    expect(facts).toMatchObject({ actualPickupPrecision: "day", actualReturnPrecision: "minute" });
  });

  it.each([
    ["day", "minute"],
    ["minute", "day"],
  ] as const)(
    "propagates pickup %s / return %s with the same date and precision",
    async (pickupPrecision, returnPrecision) => {
      const local = (day: string, time: string, precision: string) =>
        precision === "day" ? day : `${day}T${time}`;
      const res = await request(app)
        .patch(`/api/v1/rentals/${pair.full.rental.id}`)
        .set("Cookie", anna.cookie)
        .send({
          actualPickupLocal: local("2025-05-06", "15:10", pickupPrecision),
          actualReturnLocal: local("2025-05-08", "11:45", returnPrecision),
        });
      expect(res.status).toBe(200);

      const [a, b] = [await source(), await copy()];
      expect(a.actualPickupPrecision).toBe(pickupPrecision);
      expect(a.actualReturnPrecision).toBe(returnPrecision);
      expect(b.actualPickupTime).toEqual(a.actualPickupTime);
      expect(b.actualReturnTime).toEqual(a.actualReturnTime);
      expect(b.actualPickupPrecision).toBe(pickupPrecision);
      expect(b.actualReturnPrecision).toBe(returnPrecision);
      expect(rentalTimes(b).actualPickup).toEqual(rentalTimes(a).actualPickup);
      expect(rentalTimes(b).actualReturn).toEqual(rentalTimes(a).actualReturn);
    }
  );

  it("propagates an unknown actual hand-over as unknown", async () => {
    await request(app)
      .patch(`/api/v1/rentals/${pair.full.rental.id}`)
      .set("Cookie", anna.cookie)
      .send({ actualPickupLocal: "2025-05-06" })
      .expect(200);
    await request(app)
      .patch(`/api/v1/rentals/${pair.full.rental.id}`)
      .set("Cookie", anna.cookie)
      .send({ actualPickupLocal: null })
      .expect(200);
    const b = await copy();
    expect(b.actualPickupTime).toBeNull();
    expect(b.actualPickupPrecision).toBeNull();
    expect(rentalTimes(b).actualPickup).toBeNull();
    expect(rentalTimes(b).actualReturn).toBeNull();
  });

  it("copies a day-only hand-over on share without inventing 00:00", async () => {
    // The issue's case: known only as 6 July in Berlin, stored as its midnight.
    const carl = await makeAccount("carl278");
    const dora = await makeAccount("dora278");
    const [a, b] = await sharedPairWithRental(carl, dora, {
      actualPickupTime: new Date("2026-07-05T22:00:00.000Z"),
      actualPickupPrecision: "day",
      // The later 02:30 of the repeated autumn hour.
      actualReturnTime: new Date("2026-10-25T01:30:00.000Z"),
      actualReturnPrecision: "minute",
    });
    expect(b.actualPickupTime).toEqual(new Date("2026-07-05T22:00:00.000Z"));
    expect(b.actualPickupPrecision).toBe("day");
    expect(rentalTimes(b).actualPickup).toMatchObject({
      local: "2026-07-06T00:00:00",
      precision: "day",
    });
    expect(b.actualReturnTime).toEqual(new Date("2026-10-25T01:30:00.000Z"));
    expect(rentalTimes(b).actualReturn).toMatchObject({
      local: "2026-10-25T02:30:00",
      offset: "+01:00",
      precision: "minute",
    });
    expect(rentalTimes(b)).toEqual(rentalTimes(a));
  });
});

/** Shares a fresh full trip whose rental carries `actual` (station zone Berlin). */
async function sharedPairWithRental(
  owner: TestAccount,
  member: TestAccount,
  actual: {
    actualPickupTime: Date;
    actualPickupPrecision: string;
    actualReturnTime: Date;
    actualReturnPrecision: string;
  }
) {
  const { makeFullTrip, linkWithConsent } = await import("./sharingFixtures");
  const { shareTrip } = await import("../../services/sharing/shareTrip");
  const full = await makeFullTrip(owner);
  const source = await prisma.rentalBooking.update({
    where: { id: full.rental.id },
    data: {
      ...actual,
      pickupTimezone: BERLIN,
      returnTimezone: BERLIN,
      pickupTime: new Date("2026-07-05T08:00:00.000Z"),
      returnTime: new Date("2026-10-25T08:00:00.000Z"),
    },
  });
  const companion = await linkWithConsent(owner, member);
  await shareTrip(owner.id, full.trip.id, companion.id);
  const copy = await prisma.rentalBooking.findFirstOrThrow({ where: { userId: member.id } });
  return [source, copy] as const;
}
