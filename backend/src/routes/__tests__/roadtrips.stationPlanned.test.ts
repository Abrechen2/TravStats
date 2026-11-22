import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The dashboard map marks a roadtrip station that is still ahead as planned
 * (hollow). The flag is the roadtrip timeline's own phase rule, not a new one.
 */
const USER = "roadtripplanned";

describe("GET /roadtrips — station planned flag", () => {
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  });

  it("marks a future station planned and a past one not, in the list the map reads", async () => {
    const made = await request(app)
      .post("/api/v1/roadtrips")
      .set("Cookie", cookie)
      .send({ name: "Planned" });
    const id = made.body.roadtrip.id;
    const put = await request(app)
      .put(`/api/v1/roadtrips/${id}/stations`)
      .set("Cookie", cookie)
      .send({
        stations: [
          {
            title: "Past",
            lat: 53.55,
            lon: 9.99,
            startDate: "2020-07-12",
            night: { kind: "pass" },
          },
          {
            title: "Ahead",
            lat: 58.97,
            lon: 5.73,
            startDate: "2099-07-14",
            night: { kind: "pass" },
          },
        ],
      });
    expect(put.status).toBe(200);
    const list = await request(app).get("/api/v1/roadtrips").set("Cookie", cookie);
    const trip = list.body.roadtrips.find((r: { id: string }) => r.id === id);
    expect(
      trip.stations.map((s: { title: string; planned: boolean }) => [s.title, s.planned])
    ).toEqual([
      ["Past", false],
      ["Ahead", true],
    ]);
  });
});
