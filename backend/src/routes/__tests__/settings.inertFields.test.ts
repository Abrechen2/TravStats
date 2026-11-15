import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";

/**
 * forgejo#389: the auto-update check interval, "only during flight", the
 * boarding-pass parser strategy, map.zoomLevel / map.markerStyle and
 * notifications.emailNotifications were saved and returned but read by
 * nothing. They are gone. An OLD client still sending them must not get a 400,
 * and the server must not echo them back as if they meant something.
 */
describe("settings — retired inert fields (forgejo#389)", () => {
  let cookie: string[];

  const clean = async (): Promise<void> => {
    await prisma.userSettings.deleteMany();
    await prisma.user.deleteMany();
  };

  beforeEach(async () => {
    await clean();
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: "inert-settings", password: "password123" })
      .expect(201);
    cookie = [registration.headers["set-cookie"]].flat();
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("an old client PUTting the retired fields still gets 200 and no echo of them", async () => {
    const put = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({
        autoUpdate: { enabled: true, checkInterval: 30, onlyDuringFlight: false, expiryHours: 12 },
        boardingPassParserStrategy: "api-only",
        map: { mapStyle: "satellite", zoomLevel: 9, markerStyle: "circle" },
        notifications: { emailNotifications: false, flightReminder: "48h" },
      })
      .expect(200);

    for (const body of [
      put.body,
      (await request(app).get("/api/v1/settings").set("Cookie", cookie).expect(200)).body,
    ]) {
      expect(body.autoUpdate).toEqual({ enabled: true, requireApproval: true, expiryHours: 12 });
      expect(body).not.toHaveProperty("boardingPassParserStrategy");
      expect(body.map.mapStyle).toBe("satellite");
      expect(body.map).not.toHaveProperty("zoomLevel");
      expect(body.map).not.toHaveProperty("markerStyle");
      expect(body.notifications.flightReminder).toBe("48h");
      expect(body.notifications).not.toHaveProperty("emailNotifications");
    }
  });
});
