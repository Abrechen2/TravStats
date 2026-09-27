import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { DEMO_USERNAME } from "../../utils/sharedDemo";
import { hashPassword } from "../../utils/password";

// A visitor deciding whether the setup screen can offer "try the demo" has
// no other way to ask this: `/setup/status` is the one endpoint reachable
// before an admin account exists, so it has to carry the answer.
describe("GET /setup/status carries whether the demo account can be offered", () => {
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { username: DEMO_USERNAME } });
  });

  it("is false when no demo account exists", async () => {
    await prisma.user.deleteMany({ where: { username: DEMO_USERNAME } });

    const res = await request(app).get("/api/v1/setup/status");

    expect(res.status).toBe(200);
    expect(res.body.demoAccountAvailable).toBe(false);
  });

  it("is true once the shared demo account has been seeded", async () => {
    await prisma.user.deleteMany({ where: { username: DEMO_USERNAME } });
    const passwordHash = await hashPassword("demo123");
    await prisma.user.create({
      data: {
        username: DEMO_USERNAME,
        passwordHash,
        isAdmin: false,
        isDemo: true,
      },
    });

    const res = await request(app).get("/api/v1/setup/status");

    expect(res.status).toBe(200);
    expect(res.body.demoAccountAvailable).toBe(true);
  });

  it("is false for an ordinary account merely named 'demo' without the isDemo flag", async () => {
    // A row can carry the reserved name only through data that predates the
    // reservation (isReservedUsername), so this guards against ever reading
    // username alone as "the demo account is available".
    await prisma.user.deleteMany({ where: { username: DEMO_USERNAME } });
    const passwordHash = await hashPassword("demo123");
    await prisma.user.create({
      data: {
        username: DEMO_USERNAME,
        passwordHash,
        isAdmin: false,
        isDemo: false,
      },
    });

    const res = await request(app).get("/api/v1/setup/status");

    expect(res.status).toBe(200);
    expect(res.body.demoAccountAvailable).toBe(false);
  });
});
