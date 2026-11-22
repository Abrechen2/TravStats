import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The airline-logo style ("tile" | "icon") travels in the settings `units`
 * block so it follows the user across devices. It must survive the round trip
 * and the server must refuse a style the display cannot draw.
 */
describe("the airline logo style preference in the settings units block", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "settingsAirlineLogoStyleUser" } });
    const user = await prisma.user.create({
      data: {
        username: "settingsAirlineLogoStyleUser",
        passwordHash: await hashPassword("password123"),
      },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("stores the style and returns it on the next read", async () => {
    const put = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", authCookie)
      .send({ units: { distanceUnit: "miles", airlineLogoStyle: "icon" } });
    expect(put.status).toBe(200);

    const get = await request(app).get("/api/v1/settings").set("Cookie", authCookie);
    expect(get.body.units.airlineLogoStyle).toBe("icon");
    expect(get.body.units.distanceUnit).toBe("miles");
  });

  it("refuses an unknown style and keeps the stored one", async () => {
    const res = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", authCookie)
      .send({ units: { airlineLogoStyle: "wordmark" } });
    expect(res.status).toBe(400);

    const get = await request(app).get("/api/v1/settings").set("Cookie", authCookie);
    expect(get.body.units.airlineLogoStyle).toBe("icon");
  });
});
