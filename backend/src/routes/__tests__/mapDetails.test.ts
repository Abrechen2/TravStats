import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { answerSubjectImage } from "../../services/mapDetails/subjectImageService";
import { stopWikipediaSummary } from "../../services/mapDetails/stopWikipedia";
import { OpenDataUnavailableError } from "../../services/openData/http";

/**
 * Rich map details (2026-10-21): the HTTP contract of the subject pictures and
 * the station Wikipedia opening. The lookups are mocked — their own failure
 * paths are driven in `services/mapDetails/__tests__` — so what is pinned
 * here: only the caller's OWN vessel / station is ever looked up (another
 * user's ferry costs no request and reveals nothing), answers are `private`,
 * a missing picture is a 404, the open-data switch answers 409, and an outage
 * is `unavailable`, not "no article".
 */
jest.mock("../../services/mapDetails/subjectImageService", () => ({
  ...jest.requireActual("../../services/mapDetails/subjectImageService"),
  answerSubjectImage: jest.fn(),
}));
jest.mock("../../services/mapDetails/stopWikipedia", () => ({
  ...jest.requireActual("../../services/mapDetails/stopWikipedia"),
  stopWikipediaSummary: jest.fn(),
}));
const answer = answerSubjectImage as jest.MockedFunction<typeof answerSubjectImage>;
const wiki = stopWikipediaSummary as jest.MockedFunction<typeof stopWikipediaSummary>;

const USERS = ["mapdetails-anna", "mapdetails-ben"];
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const CREDIT = {
  qid: "Q1",
  file: "Color Fantasy.jpg",
  licence: "CC BY-SA 4.0",
  licenceUrl: null,
  artist: "Jane Doe",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Color_Fantasy.jpg",
};
const SUMMARY = {
  title: "Kieler Hafen",
  extract: "Der Kieler Hafen ist ein Hafen.",
  thumbnailUrl: null,
  pageUrl: "https://de.wikipedia.org/wiki/Kieler_Hafen",
  lang: "de" as const,
};

describe("/api/v1/map-details", () => {
  let anna: string;
  let ben: string;
  let settingsId: number;
  let previousSwitch: boolean;
  const setSwitch = (on: boolean) =>
    prisma.adminSettings.update({ where: { id: settingsId }, data: { openDataEnabled: on } });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    const [a, b] = await Promise.all(
      USERS.map(async (username) =>
        prisma.user.create({
          data: { username, passwordHash: await hashPassword("password123") },
        })
      )
    );
    anna = `auth_token=${generateToken(a.id)}`;
    ben = `auth_token=${generateToken(b.id)}`;
    await prisma.ferryJourney.create({
      data: {
        userId: a.id,
        operator: "Color Line",
        vesselName: "Color Fantasy",
        depStationName: "Kiel",
        depLat: 54.3234,
        depLon: 10.1356,
        depTimezone: "Europe/Berlin",
        arrStationName: "Oslo",
        arrLat: 59.9021,
        arrLon: 10.7392,
        arrTimezone: "Europe/Oslo",
        departureTime: new Date("2024-06-01T12:00:00Z"),
        status: "completed",
      },
    });
    const settings =
      (await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } })) ??
      (await prisma.adminSettings.create({ data: {} }));
    settingsId = settings.id;
    previousSwitch = settings.openDataEnabled;
  });

  afterAll(async () => {
    await setSwitch(previousSwitch);
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    answer.mockReset();
    wiki.mockReset();
    await setSwitch(true);
  });

  describe("subject pictures", () => {
    it("requires a session", async () => {
      const res = await request(app).get("/api/v1/map-details/subject?kind=vessel&name=X");
      expect(res.status).toBe(401);
    });

    it("answers the credit of the caller's own vessel, privately cached", async () => {
      answer.mockResolvedValue({
        picture: { image: { body: JPEG, contentType: "image/jpeg" }, credit: CREDIT },
        pending: false,
        unavailable: false,
      });
      const res = await request(app)
        .get("/api/v1/map-details/subject?kind=vessel&name=color%20fantasy")
        .set("Cookie", anna);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: { available: true, pending: false, unavailable: false, credit: CREDIT },
      });
      expect(res.headers["cache-control"]).toMatch(/^private/);
    });

    it("looks up nothing another user's journeys record", async () => {
      const res = await request(app)
        .get("/api/v1/map-details/subject?kind=vessel&name=Color%20Fantasy")
        .set("Cookie", ben);
      expect(res.body.data).toEqual({
        available: false,
        pending: false,
        unavailable: false,
        credit: null,
      });
      expect(answer).not.toHaveBeenCalled();
    });

    it("serves the bytes inert and private, and a 404 without a stand-in", async () => {
      answer.mockResolvedValueOnce({
        picture: { image: { body: JPEG, contentType: "image/jpeg" }, credit: CREDIT },
        pending: false,
        unavailable: false,
      });
      const ok = await request(app)
        .get("/api/v1/map-details/subject/image?kind=vessel&name=Color%20Fantasy")
        .set("Cookie", anna);
      expect(ok.status).toBe(200);
      expect(ok.headers["content-type"]).toBe("image/jpeg");
      expect(ok.headers["cache-control"]).toBe("private, max-age=604800");
      expect(ok.headers["content-security-policy"]).toContain("sandbox");
      answer.mockResolvedValueOnce({ picture: null, pending: true, unavailable: false });
      const missing = await request(app)
        .get("/api/v1/map-details/subject/image?kind=vessel&name=Color%20Fantasy")
        .set("Cookie", anna);
      expect(missing.status).toBe(404);
      // A pending answer is not cached: the next view asks again.
      expect(missing.headers["cache-control"]).toBe("private, no-store");
    });

    it("says when Wikimedia did not answer, uncached, instead of 'no picture'", async () => {
      answer.mockResolvedValue({ picture: null, pending: false, unavailable: true });
      const res = await request(app)
        .get("/api/v1/map-details/subject?kind=vessel&name=Color%20Fantasy")
        .set("Cookie", anna);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        available: false,
        pending: false,
        unavailable: true,
        credit: null,
      });
      expect(res.headers["cache-control"]).toBe("private, no-store");
      const image = await request(app)
        .get("/api/v1/map-details/subject/image?kind=vessel&name=Color%20Fantasy")
        .set("Cookie", anna);
      expect(image.status).toBe(503);
      expect(image.headers["cache-control"]).toBe("private, no-store");
    });

    it("refuses an unknown kind", async () => {
      const res = await request(app)
        .get("/api/v1/map-details/subject?kind=spaceship&name=X")
        .set("Cookie", anna);
      expect(res.status).toBe(400);
    });
  });

  describe("stop Wikipedia", () => {
    const KIEL = "/api/v1/map-details/stop?domain=ferry&name=Kiel&lat=54.3236&lon=10.1352&lang=de";

    it("answers the summary for the caller's own port", async () => {
      wiki.mockResolvedValue(SUMMARY);
      const res = await request(app).get(KIEL).set("Cookie", anna);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { summary: SUMMARY, unavailable: false } });
      expect(res.headers["cache-control"]).toMatch(/^private/);
      expect(wiki).toHaveBeenCalledWith("ferry", "Kiel", 54.3236, 10.1352, "de");
    });

    it("asks nothing for a point that is not one of the caller's stations", async () => {
      const res = await request(app).get(KIEL).set("Cookie", ben);
      expect(res.body.data).toEqual({ summary: null, unavailable: false });
      expect(wiki).not.toHaveBeenCalled();
    });

    it("says when Wikipedia did not answer, instead of 'no article'", async () => {
      wiki.mockRejectedValue(new OpenDataUnavailableError("wikipedia"));
      const res = await request(app).get(KIEL).set("Cookie", anna);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ summary: null, unavailable: true });
    });

    it("answers 409 while the instance's open-data switch is off", async () => {
      await setSwitch(false);
      const res = await request(app).get(KIEL).set("Cookie", anna);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("openDataDisabled");
      expect(wiki).not.toHaveBeenCalled();
    });

    it("refuses a position off the globe", async () => {
      const res = await request(app)
        .get("/api/v1/map-details/stop?domain=ferry&name=Kiel&lat=91&lon=10")
        .set("Cookie", anna);
      expect(res.status).toBe(400);
    });
  });
});
