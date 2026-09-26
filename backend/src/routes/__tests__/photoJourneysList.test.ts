import { describe, it, expect, jest, beforeAll, afterAll } from "@jest/globals";

const reverseGeocode = jest.fn();
jest.mock("../../services/geo/nominatim", () => ({
  ...jest.requireActual<object>("../../services/geo/nominatim"),
  reverseGeocode: (...args: unknown[]) => reverseGeocode(...args),
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#132 item 20: `GET /photo-journeys` names each finding, so a place
 * find is no longer titled "Warst du hier?". The name is resolved on the
 * server from what is already stored — the own place a finding points at, else
 * the reverse lookup the scan stored — and never by a network call per request.
 * Nothing known is null, not an invented name.
 */
describe("GET /api/v1/photo-journeys names its findings", () => {
  const stamp = Date.now();
  let cookie: string;
  let userId: string;

  const journey = (over: Record<string, unknown>) =>
    prisma.photoJourney.create({
      data: {
        userId,
        fingerprint: `pj-list-${stamp}-${Math.random()}`,
        startDate: new Date("2024-05-01T09:00:00Z"),
        endDate: new Date("2024-05-01T18:00:00Z"),
        photoCount: 5,
        locatedCount: 5,
        lat: 38.72,
        lon: -9.14,
        previewAssetIds: [],
        ...over,
      },
    });

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `pj-list-${stamp}`, passwordHash } }))
      .id;
    cookie = `auth_token=${generateToken(userId)}`;
    const place = await prisma.place.create({
      data: { userId, name: "Café Norte", lat: 38.72, lon: -9.14, city: "Lissabon" },
    });
    await journey({
      kind: "place",
      placeId: place.id,
      city: "Lisboa",
      startDate: new Date("2024-05-03"),
    });
    await journey({
      kind: "trip",
      city: "Porto",
      countryName: "Portugal",
      startDate: new Date("2024-05-02"),
    });
    await journey({ kind: "trip", countryName: "Portugal", startDate: new Date("2024-05-01") });
    await journey({ kind: "trip", startDate: new Date("2024-04-30") });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("gives each finding the own place's name, else the stored city or country, else null", async () => {
    const res = await request(app).get("/api/v1/photo-journeys").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(
      res.body.data.map((j: { placeName: string | null; label: string | null }) => [
        j.placeName,
        j.label,
      ])
    ).toEqual([
      ["Café Norte", "Café Norte"],
      [null, "Porto"],
      [null, "Portugal"],
      [null, null],
    ]);
    // The raw columns the Companion already reads are still there.
    expect(res.body.data[1]).toMatchObject({ city: "Porto", countryName: "Portugal" });
    expect(reverseGeocode).not.toHaveBeenCalled();
  });
});
