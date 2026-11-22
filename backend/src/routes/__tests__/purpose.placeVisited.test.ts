import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `Place.visited` is stored. A place that is visited only through a hidden business visit — what
 * is visible is a plan — must stop counting as visited, in the list and in the totals.
 */
describe("purpose: a place visited only through a hidden business visit", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: `purpose-place-${stamp}`, passwordHash: await hashPassword("x") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    const future = new Date(Date.now() + 90 * 86_400_000);
    await prisma.place.create({
      data: {
        userId,
        name: "Messehalle",
        lat: 50.1,
        lon: 8.6,
        visited: true,
        visits: {
          create: [
            { userId, visitedAt: new Date("2025-03-02T09:00:00Z"), purpose: "business" },
            { userId, visitedAt: future, purpose: "private" },
          ],
        },
      },
    });
    await prisma.place.create({
      data: {
        userId,
        name: "Stammcafe",
        lat: 50.2,
        lon: 8.7,
        visited: true,
        visits: {
          create: [
            { userId, visitedAt: new Date("2025-03-03T09:00:00Z"), purpose: "business" },
            { userId, visitedAt: new Date("2025-03-04T09:00:00Z"), purpose: "private" },
          ],
        },
      },
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const visitedByName = async (): Promise<Record<string, boolean>> => {
    const res = await request(app)
      .get("/api/v1/places?limit=100")
      .set("Cookie", cookie)
      .expect(200);
    const rows = (res.body.places ?? res.body.data ?? res.body) as Array<{
      name: string;
      visited: boolean;
    }>;
    return Object.fromEntries(rows.map((p) => [p.name, p.visited]));
  };

  it("is not visited while its business visit is hidden, and is again once shown", async () => {
    expect(await visitedByName()).toMatchObject({ Messehalle: true, Stammcafe: true });
    await request(app)
      .put("/api/v1/purpose/visibility")
      .set("Cookie", cookie)
      .send({ poi: ["business"] })
      .expect(200);
    // The café still has a visible visit that happened; the hall has only a plan left.
    expect(await visitedByName()).toMatchObject({ Messehalle: false, Stammcafe: true });
    await request(app).put("/api/v1/purpose/visibility").set("Cookie", cookie).send({}).expect(200);
    expect(await visitedByName()).toMatchObject({ Messehalle: true });
  });
});
