import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The settings profile block lives in the UserSettings JSON blob, but the name
 * lives on `User` (see auth.profileName.test.ts for why). The settings endpoint
 * therefore has to bridge the two: read the name out of the user row into the
 * profile block, and write it back to the row rather than into the blob.
 *
 * A name that landed in the JSON blob would be invisible to /auth/me, so the
 * header would keep greeting the username while the settings page showed the
 * name — the two-surfaces-disagree bug this project keeps re-learning.
 */
describe("settings carry first and last name to and from the user row", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "settingsNameUser" } });
    const user = await prisma.user.create({
      data: {
        username: "settingsNameUser",
        passwordHash: await hashPassword("password123"),
      },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("saves the name onto the user row, not into the settings blob", async () => {
    const res = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", authCookie)
      .send({ profile: { firstName: "Alex", lastName: "Künzel" } });
    expect(res.status).toBe(200);

    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    expect(row?.firstName).toBe("Alex");
    expect(row?.lastName).toBe("Künzel");

    const settings = await prisma.userSettings.findUnique({ where: { userId } });
    const blob = settings?.data as Record<string, unknown> | null;
    const profile = (blob?.profile ?? {}) as Record<string, unknown>;
    expect(profile.firstName).toBeUndefined();
    expect(profile.lastName).toBeUndefined();
  });

  it("returns the name in the profile block on GET", async () => {
    const res = await request(app).get("/api/v1/settings").set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body.profile.firstName).toBe("Alex");
    expect(res.body.profile.lastName).toBe("Künzel");
  });

  it("clears a name when the field is emptied instead of silently keeping the old one", async () => {
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", authCookie)
      .send({ profile: { firstName: "", lastName: "" } });

    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    expect(row?.firstName).toBeNull();
    expect(row?.lastName).toBeNull();
  });

  it("leaves the name untouched when the request does not mention it", async () => {
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", authCookie)
      .send({ profile: { firstName: "Dennis" } });

    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", authCookie)
      .send({ display: { theme: "dark" } });

    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true },
    });
    expect(row?.firstName).toBe("Dennis");
  });
});
