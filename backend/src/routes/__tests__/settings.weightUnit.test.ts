import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#186: a baggage allowance typed as a bare "23" is shown with the
 * user's weight unit. The preference travels in the `units` block of the
 * settings blob, beside the distance unit — it has to survive the round trip,
 * and the server has to refuse a unit the display could not name.
 */
describe("the weight unit preference in the settings units block", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "settingsWeightUnitUser" } });
    const user = await prisma.user.create({
      data: {
        username: "settingsWeightUnitUser",
        passwordHash: await hashPassword("password123"),
      },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("stores the unit and returns it on the next read", async () => {
    const put = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", authCookie)
      .send({ units: { distanceUnit: "miles", weightUnit: "lb" } });
    expect(put.status).toBe(200);

    const get = await request(app).get("/api/v1/settings").set("Cookie", authCookie);
    expect(get.status).toBe(200);
    expect(get.body.units.weightUnit).toBe("lb");
    expect(get.body.units.distanceUnit).toBe("miles");
  });

  it("refuses a unit a baggage allowance is never quoted in", async () => {
    const res = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", authCookie)
      .send({ units: { weightUnit: "tonnes" } });
    expect(res.status).toBe(400);

    const get = await request(app).get("/api/v1/settings").set("Cookie", authCookie);
    expect(get.body.units.weightUnit).toBe("lb");
  });
});
