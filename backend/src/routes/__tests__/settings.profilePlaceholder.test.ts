import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Audit F-002 (2.7.0-rc.26). A fresh account's `GET /settings` answered
 * `profile.username: "Traveler"` and `profile.email: "traveler@example.com"`
 * while `/auth/me` named the real account — and the Companion shows the
 * profile block as account data. Both strings were placeholders from the
 * default settings blob, and migration 20261020171000 wrote the same blob into
 * every existing account that had no settings row, so the placeholder sits in
 * real rows and is masked on read rather than rewritten.
 *
 * The username is the `User` row's (it cannot be renamed — AUD-025); an
 * unknown e-mail is absent, never a made-up address.
 */
const USERNAME = "settingsplaceholderuser";

describe("the settings profile names the real account, never a placeholder", () => {
  let cookie: string;
  let userId: string;

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
  });

  const getProfile = async (): Promise<Record<string, unknown>> => {
    const res = await request(app).get("/api/v1/settings").set("Cookie", cookie);
    expect(res.status).toBe(200);
    return res.body.profile as Record<string, unknown>;
  };

  it("a fresh account answers its own username and no e-mail", async () => {
    const profile = await getProfile();
    expect(profile.username).toBe(USERNAME);
    expect(profile.email).toBeUndefined();
  });

  it("a fresh account's stored blob carries no placeholder identity", async () => {
    await getProfile();
    const row = await prisma.userSettings.findUnique({ where: { userId } });
    const blob = (row?.data ?? {}) as { profile?: Record<string, unknown> };
    expect(blob.profile?.username).toBeUndefined();
    expect(blob.profile?.email).toBeUndefined();
  });

  it("masks the placeholder an older row already holds", async () => {
    await prisma.userSettings.create({
      data: {
        userId,
        data: {
          profile: {
            username: "Traveler",
            email: "traveler@example.com",
            profilePicture: null,
          },
        },
      },
    });
    const profile = await getProfile();
    expect(profile.username).toBe(USERNAME);
    expect(profile.email).toBeUndefined();
  });

  it("keeps an e-mail address the user actually entered", async () => {
    const put = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ profile: { email: "real@example.org" } });
    expect(put.status).toBe(200);
    expect(put.body.profile.email).toBe("real@example.org");
    expect(put.body.profile.username).toBe(USERNAME);
    expect((await getProfile()).email).toBe("real@example.org");
  });
});
