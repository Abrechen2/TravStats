import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { keepUnknownDomains } from "../../services/domainVisibility";

/**
 * tours-own-domain T1: `tour` joined `enabledDomains` after Companion builds
 * shipped. An older client writes the list without it; that must not switch
 * tours off. A client that names the key in `knownDomains` owns it.
 */
describe("settings — knownDomains guard", () => {
  let cookie: string[];
  let userId: string;

  const clean = async (): Promise<void> => {
    await prisma.userSettings.deleteMany();
    await prisma.user.deleteMany();
  };
  const stored = async (): Promise<string[]> =>
    (await prisma.userSettings.findUniqueOrThrow({ where: { userId } })).enabledDomains;

  beforeEach(async () => {
    await clean();
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: "known-domains", password: "password123" })
      .expect(201);
    cookie = [registration.headers["set-cookie"]].flat();
    userId = (await prisma.user.findUniqueOrThrow({ where: { username: "known-domains" } })).id;
    await request(app).get("/api/v1/settings").set("Cookie", cookie).expect(200);
    await prisma.userSettings.update({
      where: { userId },
      data: { enabledDomains: ["flight", "tour"] },
    });
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  const put = (body: object) =>
    request(app).put("/api/v1/settings").set("Cookie", cookie).send(body);

  it("an old client's write (no knownDomains) cannot drop tour", async () => {
    await put({ enabledDomains: ["flight", "cruise"] }).expect(200);
    expect(await stored()).toEqual(["flight", "cruise", "tour"]);
  });

  it("a client that knows tour can switch it off", async () => {
    await put({ enabledDomains: ["flight"], knownDomains: ["flight", "cruise", "tour"] }).expect(
      200
    );
    expect(await stored()).toEqual(["flight"]);
  });

  it("a client that knows tour can keep it on", async () => {
    await put({ enabledDomains: ["flight", "tour"], knownDomains: ["tour"] }).expect(200);
    expect(await stored()).toEqual(["flight", "tour"]);
  });

  it("an old client does not switch tour ON for an account that never had it", async () => {
    await prisma.userSettings.update({ where: { userId }, data: { enabledDomains: ["flight"] } });
    await put({ enabledDomains: ["flight", "cruise"] }).expect(200);
    expect(await stored()).toEqual(["flight", "cruise"]);
  });

  it("does not store knownDomains in the settings blob", async () => {
    await put({ enabledDomains: ["flight"], knownDomains: ["tour"] }).expect(200);
    const row = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    expect(row.data).not.toHaveProperty("knownDomains");
  });

  it("keepUnknownDomains never duplicates", () => {
    expect(keepUnknownDomains(["flight", "tour"], ["flight", "tour"], undefined)).toEqual([
      "flight",
      "tour",
    ]);
  });
});
