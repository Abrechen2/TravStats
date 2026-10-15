import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { loadRoadtripStations } from "../../services/stats/roadtripEvidenceLoader";
import { roadtripEvidence } from "../../services/stats/roadtripEvidence";

jest.mock("../../services/geo/nominatim", () => ({
  ...jest.requireActual("../../services/geo/nominatim"),
  completeAddressFromCoordinates: jest.fn(async () => null),
  resolveCoordinates: jest.fn(async () => null),
}));

describe("country visit purpose — persistence and the shared passport", () => {
  let userId: string;
  let cookie: string;
  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { username: `country-purpose-${crypto.randomUUID()}`, passwordHash: "test" },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
  });
  afterEach(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("excludes planned wishlist places and keeps explicit undated confirmations", async () => {
    const place = await prisma.place.create({
      data: {
        userId,
        name: "Future visit",
        lat: 50.8,
        lon: 4.3,
        isoCountryCode: "BE",
        visited: false,
        visits: { create: { userId, visitedAt: new Date("2099-01-01T12:00:00Z") } },
      },
    });
    const result = await request(app).get("/api/v1/stats/passport").set("Cookie", cookie);
    expect(result.body.summary).toMatchObject({ groundCountries: 0, visitedCountries: 0 });
    await prisma.placeVisit.deleteMany({ where: { placeId: place.id } });
    await prisma.place.update({ where: { id: place.id }, data: { visited: true } });
    const undated = await request(app).get("/api/v1/stats/passport").set("Cookie", cookie);
    expect(undated.body.summary.visitedCountries).toBe(1);
  });

  it("keeps a service-area overnight as transit through station edits", async () => {
    const route = await prisma.tripRoute.create({
      data: { userId, name: "Roadtrip", mode: "road", kind: "roadtrip" },
    });
    const station = {
      title: "Raststätte",
      lat: 50.1,
      lon: 8.6,
      startDate: "2025-01-01",
      endDate: "2025-01-02",
      night: { kind: "free", countryVisitKind: "transit" },
    };
    const write = await request(app)
      .put(`/api/v1/roadtrips/${route.id}/stations`)
      .set("Cookie", cookie)
      .send({ stations: [station] });
    expect(write.status).toBe(200);
    expect(write.body.stations[0].countryVisitKind).toBe("transit");
    // An older client omitting the new field must not reset an explicit classification.
    const rewrite = await request(app)
      .put(`/api/v1/roadtrips/${route.id}/stations`)
      .set("Cookie", cookie)
      .send({ stations: [{ ...station, id: write.body.stations[0].id, night: { kind: "free" } }] });
    expect(rewrite.status).toBe(200);
    expect(rewrite.body.stations[0].countryVisitKind).toBe("transit");
    const stations = await loadRoadtripStations(userId, new Date());
    expect(stations).toHaveLength(1);
    expect(roadtripEvidence(stations)[0]).toMatchObject({ country: "DE", tier: "transited" });
  });

  it("retains linked transit purpose after the lodging stay is removed", async () => {
    const lodging = await prisma.lodging.create({
      data: {
        userId,
        name: "Transit hotel",
        visited: true,
        isoCountryCode: "DE",
        countryVisitKind: "transit",
      },
    });
    const stay = await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkIn: new Date("2025-01-01"),
        checkOut: new Date("2025-01-02"),
        status: "completed",
      },
    });
    const route = await prisma.tripRoute.create({
      data: { userId, name: "Roadtrip", mode: "road", kind: "roadtrip" },
    });
    const write = await request(app)
      .put(`/api/v1/roadtrips/${route.id}/stations`)
      .set("Cookie", cookie)
      .send({
        stations: [
          {
            title: "Transit",
            lat: 50.1,
            lon: 8.6,
            startDate: "2025-01-01",
            endDate: "2025-01-02",
            night: { kind: "stay", lodgingStayId: stay.id },
          },
        ],
      });
    expect(write.status).toBe(200);
    expect(write.body.stations[0].countryVisitKind).toBe("transit");
    await prisma.lodgingStay.delete({ where: { id: stay.id } });
    expect(roadtripEvidence(await loadRoadtripStations(userId, new Date()))[0].tier).toBe(
      "transited"
    );
  });

  it.each(["places", "lodging"])(
    "round-trips transit purpose for %s and changes only the visit set",
    async (domain) => {
      const created = await request(app).post(`/api/v1/${domain}`).set("Cookie", cookie).send({
        name: "Airport stop",
        country: "QA",
        lat: 25.27,
        lon: 51.61,
        visited: true,
        countryVisitKind: "transit",
      });
      expect(created.status).toBe(201);
      expect(created.body.data.countryVisitKind).toBe("transit");
      const id = created.body.data.id;
      const read = await request(app).get(`/api/v1/${domain}/${id}`).set("Cookie", cookie);
      expect(read.body.data.countryVisitKind).toBe("transit");
      const before = await request(app).get("/api/v1/stats/passport").set("Cookie", cookie);
      expect(before.body.summary).toMatchObject({ groundCountries: 1, visitedCountries: 0 });
      const changed = await request(app)
        .patch(`/api/v1/${domain}/${id}`)
        .set("Cookie", cookie)
        .send({ countryVisitKind: "visit" });
      expect(changed.status).toBe(200);
      const after = await request(app).get("/api/v1/stats/passport").set("Cookie", cookie);
      expect(after.body.summary).toMatchObject({ groundCountries: 1, visitedCountries: 1 });
      const detail = await request(app).get("/api/v1/stats/countries/QA").set("Cookie", cookie);
      expect(detail.body).toMatchObject({ groundPresence: true, visited: true });
      const invalid = await request(app)
        .patch(`/api/v1/${domain}/${id}`)
        .set("Cookie", cookie)
        .send({ countryVisitKind: "guessed" });
      expect(invalid.status).toBe(400);
    }
  );
});
