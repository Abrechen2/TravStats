import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * First and last name (#241). They live on `User`, not in the UserSettings JSON
 * blob that holds profilePicture: the header renders the name on every page
 * from the /auth/me payload, and reading it out of settings would make the
 * header wait for a second fetch and flash the username first.
 *
 * So /auth/me and the login response have to carry them.
 */
describe("the auth payload carries the user's real name", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "profileNameUser" } });
    const user = await prisma.user.create({
      data: {
        username: "profileNameUser",
        passwordHash: await hashPassword("password123"),
        firstName: "Alex",
        lastName: "Künzel",
      },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("returns first and last name from /auth/me", async () => {
    const res = await request(app).get("/api/v1/auth/me").set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe("Alex");
    expect(res.body.user.lastName).toBe("Künzel");
  });

  it("returns them from the login response too, so the header has a name before any other fetch", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "profileNameUser", password: "password123" });
    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe("Alex");
    expect(res.body.user.lastName).toBe("Künzel");
  });

  it("carries nulls for someone who never entered a name — a logbook does not require one", async () => {
    await prisma.user.deleteMany({ where: { username: "namelessUser" } });
    const nameless = await prisma.user.create({
      data: { username: "namelessUser", passwordHash: await hashPassword("password123") },
    });

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", `auth_token=${generateToken(nameless.id)}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe("namelessUser");
    expect(res.body.user.firstName).toBeNull();
    expect(res.body.user.lastName).toBeNull();

    await prisma.user.delete({ where: { id: nameless.id } });
  });

  it("never leaks the password hash alongside the name", async () => {
    const res = await request(app).get("/api/v1/auth/me").set("Cookie", authCookie);
    expect(res.body.user.passwordHash).toBeUndefined();
  });
});
