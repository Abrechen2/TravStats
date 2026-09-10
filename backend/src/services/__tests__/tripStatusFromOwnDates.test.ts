import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { recomputeTripStatus } from "../tripStatusService";

/**
 * A trip's status has to follow its own dates when it has nothing else.
 *
 * Derivation read flights and cruises only, so a trip with neither produced no
 * bounds at all and returned null — and null means "leave the stored status
 * alone". A manual trip created as `completed` from a January 2020 date and
 * then moved to January 2030 answered 200 and stayed `completed`, through the
 * edit, through an explicit recompute and through the nightly sweep. The PATCH
 * handler never recomputed anything either (audit finding AUD-024).
 *
 * The rule the three callers now share: what the trip HOLDS wins, and its own
 * dates are the fallback — never a mix of the two.
 */
const USERNAME = `trip-own-dates-${Date.now()}`;

describe("a trip with no flight and no cruise", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
  });

  it("becomes planned again when its dates move into the future", async () => {
    const trip = await prisma.trip.create({
      data: {
        userId,
        name: "Rail to Vienna",
        startDate: new Date("2020-01-05"),
        endDate: new Date("2020-01-10"),
        status: "completed",
      },
    });

    const res = await request(app)
      .patch(`/api/v1/trips/${trip.id}`)
      .set("Cookie", cookie)
      .send({ startDate: "2030-01-05T00:00:00.000Z", endDate: "2030-01-10T00:00:00.000Z" });

    expect(res.status).toBe(200);
    // The response must not say `completed` either — a client that reloads
    // would then see the row change under it.
    expect(res.body.trip.status).toBe("planned");
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).status).toBe(
      "planned",
    );
  });

  it("is corrected by an explicit recompute too", async () => {
    const trip = await prisma.trip.create({
      data: {
        userId,
        name: "Road trip",
        startDate: new Date("2030-06-01"),
        endDate: new Date("2030-06-10"),
        status: "completed",
      },
    });

    await recomputeTripStatus(trip.id);

    expect((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).status).toBe(
      "planned",
    );
  });

  it("derives from a hotel stay when that is all it holds", async () => {
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Status Hotel", type: "hotel" },
    });
    const trip = await prisma.trip.create({
      data: { userId, name: "Hotel weekend", status: "planned" },
    });
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        tripId: trip.id,
        checkIn: new Date("2020-03-01"),
        checkOut: new Date("2020-03-03"),
        status: "completed",
      },
    });

    await recomputeTripStatus(trip.id);

    expect((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).status).toBe(
      "completed",
    );
  });

  it("lets what the trip HOLDS win over its own dates", async () => {
    // The ordering matters: a stale plan must not widen or override the record.
    // The trip says 2030; the stay says 2020, and the stay is what happened.
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Ordering Hotel", type: "hotel" },
    });
    const trip = await prisma.trip.create({
      data: {
        userId,
        name: "Plan versus record",
        startDate: new Date("2030-01-01"),
        endDate: new Date("2030-01-05"),
        status: "planned",
      },
    });
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        tripId: trip.id,
        checkIn: new Date("2020-03-01"),
        checkOut: new Date("2020-03-03"),
        status: "completed",
      },
    });

    await recomputeTripStatus(trip.id);

    expect((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).status).toBe(
      "completed",
    );
  });
});
