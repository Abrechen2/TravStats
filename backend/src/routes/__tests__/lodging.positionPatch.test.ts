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
});
