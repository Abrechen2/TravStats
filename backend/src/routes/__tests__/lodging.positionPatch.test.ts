import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as geo from "../../services/geo/nominatim";

/**
 * `PATCH /lodging/:id { lat, lon }` is the whole of the "repair a missing
 * location in place" write (forgejo#228): the house keeps every other field,
 * the pin the user chose is stored as sent, and the geocoder is not asked to
 * second-guess it.
 */
describe("PATCH /api/v1/lodging/:id - position only", () => {
  let authCookie: string;
  let userId: string;
  let lodgingId: string;

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: {
        username: `lodging-position-${Date.now()}`,
        passwordHash: await hashPassword("password123"),
      },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;
    const lodging = await prisma.lodging.create({
      data: {
        userId,
        name: "Hotel Adlon",
        type: "hotel",
        address: "Unter den Linden 77",
        city: "Berlin",
        country: "Deutschland",
        stars: 5,
        notes: "Lobby bar",
        website: "https://adlon.example",
        amenities: ["Pool"],
      },
    });
    lodgingId = lodging.id;
  });

  afterAll(async () => {
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  afterEach(() => jest.restoreAllMocks());

  it("stores the chosen pin and leaves every other field exactly as it was", async () => {
    // The geocoder finds nothing and reverse-completes nothing: whatever the
    // pin does to the house, it must not be a side effect of a lookup.
    const forward = jest
      .spyOn(geo, "resolveCoordinates")
      .mockImplementation(async (input) =>
        input.lat != null && input.lon != null ? { lat: input.lat, lon: input.lon } : null
      );
    jest.spyOn(geo, "completeAddressFromCoordinates").mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/v1/lodging/${lodgingId}`)
      .set("Cookie", authCookie)
      .send({ lat: 52.5163, lon: 13.3777 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      lat: 52.5163,
      lon: 13.3777,
      name: "Hotel Adlon",
      address: "Unter den Linden 77",
      city: "Berlin",
      country: "Deutschland",
      stars: 5,
      notes: "Lobby bar",
      website: "https://adlon.example",
      amenities: ["Pool"],
    });
    // The caller's pin was handed to the resolver as the caller's: it wins.
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ lat: 52.5163, lon: 13.3777 }));

    const stored = await prisma.lodging.findUniqueOrThrow({ where: { id: lodgingId } });
    expect(stored).toMatchObject({ lat: 52.5163, lon: 13.3777, notes: "Lobby bar", stars: 5 });
  });

  it("refuses coordinates out of range", async () => {
    const res = await request(app)
      .patch(`/api/v1/lodging/${lodgingId}`)
      .set("Cookie", authCookie)
      .send({ lat: 95, lon: 13.3777 });
    expect(res.status).toBe(400);
  });

  // forgejo#228 review: a position write is not "nothing else changes". The
  // route completes EMPTY address fields from the pin and replaces a country
  // value that is not a country - the dialog says so, and this pins it.
  describe("what the position write fills in, and what it keeps", () => {
    let sparseId: string;

    beforeAll(async () => {
      sparseId = (
        await prisma.lodging.create({
          data: {
            userId,
            name: "Burj View Suites",
            type: "hotel",
            address: "Sheikh Mohammed bin Rashid Blvd",
            city: null,
            country: "Dubai",
            notes: "Rooftop pool",
            stars: 4,
          },
        })
      ).id;
    });

    it("fills the empty city and replaces a 'country' that is none, and keeps address, name and the rest", async () => {
      jest
        .spyOn(geo, "resolveCoordinates")
        .mockImplementation(async (input) =>
          input.lat != null && input.lon != null ? { lat: input.lat, lon: input.lon } : null
        );
      // Stands in for the reverse lookup. The real function offers only what
      // the stored row is missing - so the stored address is NOT in this answer;
      // what the test pins is what the route does with the answer and what it
      // hands the lookup (the stored values, so nothing present is overwritten).
      const complete = jest
        .spyOn(geo, "completeAddressFromCoordinates")
        .mockResolvedValue({ city: "Dubai", country: "Vereinigte Arabische Emirate" });

      const res = await request(app)
        .patch(`/api/v1/lodging/${sparseId}`)
        .set("Cookie", authCookie)
        .send({ lat: 25.197, lon: 55.274 });

      expect(res.status).toBe(200);
      expect(complete).toHaveBeenCalledWith(
        expect.objectContaining({
          lat: 25.197,
          lon: 55.274,
          address: "Sheikh Mohammed bin Rashid Blvd",
          city: null,
          country: "Dubai",
        })
      );
      expect(res.body.data).toMatchObject({
        lat: 25.197,
        lon: 55.274,
        // Filled / replaced from the position:
        city: "Dubai",
        country: "Vereinigte Arabische Emirate",
        // Kept:
        name: "Burj View Suites",
        address: "Sheikh Mohammed bin Rashid Blvd",
        notes: "Rooftop pool",
        stars: 4,
      });
    });

    it("does not touch a country that really is one, even if the pin disagrees", async () => {
      jest
        .spyOn(geo, "resolveCoordinates")
        .mockImplementation(async (input) =>
          input.lat != null && input.lon != null ? { lat: input.lat, lon: input.lon } : null
        );
      jest.spyOn(geo, "completeAddressFromCoordinates").mockResolvedValue({ city: "Wien" });
      const res = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}`)
        .set("Cookie", authCookie)
        .send({ lat: 48.2, lon: 16.37 });
      expect(res.status).toBe(200);
      expect(res.body.data.country).toBe("Deutschland");
    });
  });

  // One coordinate on its own is not a position: it would store half a pin.
  describe("lat and lon travel together", () => {
    it.each([{ lat: 52.5 }, { lon: 13.4 }])("refuses %j on its own", async (body) => {
      const res = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}`)
        .set("Cookie", authCookie)
        .send(body);
      expect(res.status).toBe(400);
    });

    it("still accepts both, and both cleared", async () => {
      jest.spyOn(geo, "resolveCoordinates").mockResolvedValue(null);
      jest.spyOn(geo, "completeAddressFromCoordinates").mockResolvedValue(null);
      const set = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}`)
        .set("Cookie", authCookie)
        .send({ lat: 52.5, lon: 13.4 });
      expect(set.status).toBe(200);
      const cleared = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}`)
        .set("Cookie", authCookie)
        .send({ lat: null, lon: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data.lat).toBeNull();
    });
  });
});
