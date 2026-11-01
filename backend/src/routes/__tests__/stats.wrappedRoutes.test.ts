import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";

/**
 * forgejo#405 item 15: the year in review's roadtrip and tour chapters carried
 * a count and nothing else. They now state their kilometres and (roadtrips)
 * nights — and abstain, never zero, when the record has no legs or no dates.
 */
describe("wrapped — roadtrip and tour kilometres and nights", () => {
  const username = "wrapped-routes";
  let userId: string;
  let cookie: string;
  let betaBefore: boolean;
  let legKm = 0;

  const wrapped = (year: number) =>
    request(app).get(`/api/v1/stats/wrapped?year=${year}`).set("Cookie", cookie);

  beforeAll(async () => {
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    await prisma.user.deleteMany({ where: { username } });
    userId = (
      await prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.userSettings.create({
      data: { userId, enabledDomains: ["flight", "roadtrip"], data: {} },
    });

    // A roadtrip with two free nights and a pass-through, all in 2024.
    const created = await request(app)
      .post("/api/v1/roadtrips")
      .set("Cookie", cookie)
      .send({ name: "Norwegen 2024" });
    const put = await request(app)
      .put(`/api/v1/roadtrips/${created.body.roadtrip.id}/stations`)
      .set("Cookie", cookie)
      .send({
        stations: [
          {
            title: "Hamburg",
            lat: 53.55,
            lon: 9.99,
            startDate: "2024-07-12",
            night: { kind: "pass" },
          },
          {
            title: "bei Odda",
            lat: 60.07,
            lon: 6.55,
            startDate: "2024-07-16",
            endDate: "2024-07-18",
            night: { kind: "free" },
          },
        ],
      });
    expect(put.status).toBe(200);
    legKm = (put.body.legs as Array<{ distanceKm: number }>).reduce((n, l) => n + l.distanceKm, 0);

    // A roadtrip in the same year without any leg: one station, one free night.
    const lone = await request(app)
      .post("/api/v1/roadtrips")
      .set("Cookie", cookie)
      .send({ name: "Ein Halt" });
    await request(app)
      .put(`/api/v1/roadtrips/${lone.body.roadtrip.id}/stations`)
      .set("Cookie", cookie)
      .send({
        stations: [
          {
            title: "Stellplatz",
            lat: 48.1,
            lon: 11.5,
            startDate: "2024-09-01",
            endDate: "2024-09-02",
            night: { kind: "free" },
          },
        ],
      });

    // A day tour with two points (legs) and one without any.
    for (const [name, withPoints] of [
      ["Gipfel", true],
      ["Spaziergang", false],
    ] as const) {
      const tour = await request(app)
        .post("/api/v1/tours")
        .set("Cookie", cookie)
        .send({ name, mode: "foot", date: "2024-05-01" });
      expect(tour.status).toBe(201);
      if (withPoints) {
        const points = await request(app)
          .put(`/api/v1/tours/${tour.body.route.id}/points`)
          .set("Cookie", cookie)
          .send({
            points: [
              { title: "Start", lat: 47.0, lon: 11.0 },
              { title: "Gipfel", lat: 47.05, lon: 11.05 },
            ],
          });
        expect(points.status).toBe(200);
      }
    }
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { username } });
  });

  it("states a roadtrip year's kilometres and nights, and counts the leg-less trip as unmeasured", async () => {
    const res = await wrapped(2024);
    expect(res.status).toBe(200);
    const { roadtrips } = res.body.chapters;
    expect(roadtrips.roadtrips).toBe(2);
    expect(roadtrips.km).toBe(Math.round(legKm));
    expect(roadtrips.km).toBeGreaterThan(0);
    expect(roadtrips.unmeasured).toBe(1);
    // Two free nights at Odda + one at the lone pitch; both trips' nights are known.
    expect(roadtrips.nights).toBe(3);
    expect(roadtrips.nightsUnknown).toBe(0);
  });

  it("states a tour year's kilometres from the legs it has, not 0 for the one without", async () => {
    const { tours } = (await wrapped(2024)).body.chapters;
    expect(tours.tours).toBe(2);
    expect(tours.km).toBeGreaterThan(0);
    expect(tours.unmeasured).toBe(1);
  });
});
