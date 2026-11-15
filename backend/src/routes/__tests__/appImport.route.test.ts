import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/** POST /app-import — request validation and the dry-run default (forgejo#401). */
describe("POST /app-import", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "app-import-route-user" } });
    const user = await prisma.user.create({
      data: {
        username: "app-import-route-user",
        passwordHash: await hashPassword("password123"),
        isActive: true,
      },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const post = (body: unknown) =>
    request(app)
      .post("/api/v1/app-import")
      .set("Cookie", cookie)
      .send(body as object);

  it("requires a login", async () => {
    expect((await request(app).post("/api/v1/app-import").send({})).status).toBe(401);
  });

  it("rejects an unknown source and an empty file", async () => {
    expect((await post({ source: "wanderlog", content: "x" })).status).toBe(400);
    expect((await post({ source: "tripit", content: "" })).status).toBe(400);
  });

  it("answers an unreadable file with an error row, not a 200 with nothing in it", async () => {
    const res = await post({ source: "polarsteps", content: "not json" });
    expect(res.status).toBe(200);
    expect(res.body.data.dryRun).toBe(true);
    expect(res.body.data.clean).toBe(false);
    expect(res.body.data.sheets[0].rows[0]).toMatchObject({
      action: "error",
      message: "invalid_file",
    });
  });

  it("refuses a CSV over the record cap with IMPORT_TOO_MANY_ROWS", async () => {
    const lines = ["Date,Flight,From,To"];
    for (let i = 0; i < 5001; i++) lines.push("2026-03-01,LH1,FRA,JFK");
    const res = await post({ source: "jetlovers", content: lines.join("\n") });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("IMPORT_TOO_MANY_ROWS");
  });

  it("refuses a body over the text ceiling", async () => {
    const res = await post({ source: "jetlovers", content: "x".repeat(8_000_001) });
    expect(res.status).toBe(400);
  });
});
