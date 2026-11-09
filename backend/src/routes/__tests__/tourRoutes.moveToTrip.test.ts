import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * tours-own-domain T2: a day tour attaches to a trip and detaches again through
 * the same PATCH a roadtrip uses. It used to answer 400 "Only a roadtrip can be
 * attached", so the tour page could not offer "move to trip / detach".
 */
describe("a tour moves between trips and none", () => {
  const username = "tours-move-to-trip";
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    userId = (
      await prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  });

  it("attaches a standalone tour to a trip and detaches it again", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Norwegen" } });
    const tour = await prisma.tripRoute.create({
      data: { userId, name: "Preikestolen", mode: "foot", kind: "tour" },
    });

    const attached = await request(app)
      .patch(`/api/v1/tours/${tour.id}`)
      .set("Cookie", cookie)
      .send({ tripId: trip.id });
    expect(attached.status).toBe(200);
    expect((await prisma.tripRoute.findUniqueOrThrow({ where: { id: tour.id } })).tripId).toBe(
      trip.id
    );

    const detached = await request(app)
      .patch(`/api/v1/tours/${tour.id}`)
      .set("Cookie", cookie)
      .send({ tripId: null });
    expect(detached.status).toBe(200);
    expect(
      (await prisma.tripRoute.findUniqueOrThrow({ where: { id: tour.id } })).tripId
    ).toBeNull();
  });

  it("refuses a tour drawn over a trip's timeline stops, naming why", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Timeline" } });
    const other = await prisma.trip.create({ data: { userId, name: "Andere" } });
    const tour = await prisma.tripRoute.create({
      data: { userId, tripId: trip.id, name: "Über Timeline", mode: "foot", kind: "tour" },
    });
    await prisma.tripStop.create({
      data: {
        tripId: trip.id,
        title: "Start",
        lat: 58,
        lon: 6,
        routeId: tour.id,
        routeOrderIdx: 0,
      },
    });

    const res = await request(app)
      .patch(`/api/v1/tours/${tour.id}`)
      .set("Cookie", cookie)
      .send({ tripId: other.id });
    expect(res.status).toBe(409);
    expect((await prisma.tripRoute.findUniqueOrThrow({ where: { id: tour.id } })).tripId).toBe(
      trip.id
    );
  });

  it("refuses a trip that belongs to someone else", async () => {
    const stranger = await prisma.user.create({
      data: { username: "tours-move-stranger", passwordHash: await hashPassword("password123") },
    });
    try {
      const foreign = await prisma.trip.create({ data: { userId: stranger.id, name: "Fremd" } });
      const tour = await prisma.tripRoute.create({
        data: { userId, name: "Meine", mode: "foot", kind: "tour" },
      });
      const res = await request(app)
        .patch(`/api/v1/tours/${tour.id}`)
        .set("Cookie", cookie)
        .send({ tripId: foreign.id });
      expect(res.status).toBe(404);
    } finally {
      await prisma.user.deleteMany({ where: { username: "tours-move-stranger" } });
    }
  });
});
