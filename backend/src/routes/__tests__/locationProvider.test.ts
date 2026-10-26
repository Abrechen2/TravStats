import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";
import { encryptApiKey } from "../../utils/encryption";

/**
 * `/api/v1/settings/location-provider` (TravTrack plan, task S2): GET says
 * what is chosen, whether it works and what may be chosen; PUT switches and
 * refuses a choice that cannot work with its own code — never a 200 that
 * quietly kept the old value.
 */

const PATH = "/api/v1/settings/location-provider";
const USERNAME = "location-provider-route";

async function createPat(userId: string, scope: "read" | "write"): Promise<string> {
  const tok = await generateApiToken();
  await prisma.apiToken.create({
    data: {
      userId,
      label: `location-provider-${scope}`,
      lookupHash: tok.lookupHash,
      hash: tok.hash,
      scope,
    },
  });
  return tok.plaintext;
}

describe("settings — location provider", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  beforeEach(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.apiToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("GET answers kind, rev, status and the choices", async () => {
    const res = await request(app).get(PATH).set("Cookie", cookie).expect(200);
    expect(res.body).toEqual({
      kind: "none",
      rev: 0,
      status: "ok",
      choices: { none: true, travtrack: false, dawarich: false },
    });
  });

  it("offers dawarich once the user has an own connection, and PUT switches to it", async () => {
    await prisma.userSettings.create({
      data: {
        userId,
        data: {},
        dawarichBaseUrl: "http://dawarich.local:3000",
        dawarichApiKey: encryptApiKey("own-key"),
      },
    });
    const get = await request(app).get(PATH).set("Cookie", cookie).expect(200);
    expect(get.body.choices).toEqual({ none: true, travtrack: false, dawarich: true });

    const put = await request(app)
      .put(PATH)
      .set("Cookie", cookie)
      .send({ kind: "dawarich" })
      .expect(200);
    expect(put.body).toEqual({
      kind: "dawarich",
      rev: 1,
      status: "ok",
      choices: { none: true, travtrack: false, dawarich: true },
    });
  });

  it("PUT answers 409 DAWARICH_NOT_CONFIGURED and TRAVTRACK_UNAVAILABLE", async () => {
    const dawarich = await request(app)
      .put(PATH)
      .set("Cookie", cookie)
      .send({ kind: "dawarich" })
      .expect(409);
    expect(dawarich.body.code).toBe("DAWARICH_NOT_CONFIGURED");

    const travtrack = await request(app)
      .put(PATH)
      .set("Cookie", cookie)
      .send({ kind: "travtrack" })
      .expect(409);
    expect(travtrack.body.code).toBe("TRAVTRACK_UNAVAILABLE");
  });

  it("PUT refuses an unknown kind with 400", async () => {
    await request(app).put(PATH).set("Cookie", cookie).send({ kind: "owntracks" }).expect(400);
  });

  it("a read-only token may GET but not PUT", async () => {
    const pat = await createPat(userId, "read");
    await request(app).get(PATH).set("Authorization", `Bearer ${pat}`).expect(200);
    await request(app)
      .put(PATH)
      .set("Authorization", `Bearer ${pat}`)
      .send({ kind: "none" })
      .expect(403);
  });
});
