import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";
import { WEB_PREFS_LIMITS } from "../../services/webPrefs/sections";

/**
 * `/api/v1/settings/web-prefs` — the web app's synced display preferences
 * (forgejo#200). What matters beyond a round-trip: it merges per section, it
 * never touches the Companion's `app_prefs`, and one account never sees
 * another's.
 */

const PATH = "/api/v1/settings/web-prefs";
const USERS = ["webprefs_a", "webprefs_b"];

async function createPat(userId: string, scope: "read" | "write"): Promise<string> {
  const tok = await generateApiToken();
  await prisma.apiToken.create({
    data: {
      userId,
      label: `webprefs-test-${scope}`,
      lookupHash: tok.lookupHash,
      hash: tok.hash,
      scope,
    },
  });
  return tok.plaintext;
}

describe("Web preferences API", () => {
  let userAId: string;
  let userBId: string;
  let cookieA: string;
  let cookieB: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    const a = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword("password123") },
    });
    const b = await prisma.user.create({
      data: { username: USERS[1], passwordHash: await hashPassword("password123") },
    });
    userAId = a.id;
    userBId = b.id;
    cookieA = `auth_token=${generateToken(a.id)}`;
    cookieB = `auth_token=${generateToken(b.id)}`;
  });

  beforeEach(async () => {
    await prisma.userSettings.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
  });

  afterAll(async () => {
    await prisma.userSettings.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.apiToken.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.$disconnect();
  });

  it("requires authentication", async () => {
    expect((await request(app).get(PATH)).status).toBe(401);
    expect((await request(app).put(PATH).send({ sections: {} })).status).toBe(401);
  });

  it("answers an empty state for an account that never saved (no settings row)", async () => {
    const res = await request(app).get(PATH).set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sections: {}, updatedAt: null });
  });

  it("round-trips a section and stamps it with the device's instant", async () => {
    const updatedAt = "2026-10-01T08:00:00.000Z";
    const put = await request(app)
      .put(PATH)
      .set("Cookie", cookieA)
      .send({ sections: { theme: { value: { mapTheme: "classic" }, updatedAt } } });
    expect(put.status).toBe(200);
    expect(put.body.sections.theme).toEqual({ value: { mapTheme: "classic" }, updatedAt });
    expect(put.body.stale).toEqual([]);
    expect(put.body.dropped).toEqual([]);

    const get = await request(app).get(PATH).set("Cookie", cookieA);
    expect(get.body.sections.theme.value).toEqual({ mapTheme: "classic" });
    expect(get.body.updatedAt).toBe(updatedAt);
  });

  it("merges per section — a write of one section keeps the others", async () => {
    await request(app)
      .put(PATH)
      .set("Cookie", cookieA)
      .send({ sections: { domainColors: { value: { flight: "#112233" } } } });
    await request(app)
      .put(PATH)
      .set("Cookie", cookieA)
      .send({ sections: { dashboardHiddenDomains: { value: ["cruise"] } } });

    const get = await request(app).get(PATH).set("Cookie", cookieA);
    expect(get.body.sections.domainColors.value).toEqual({ flight: "#112233" });
    expect(get.body.sections.dashboardHiddenDomains.value).toEqual(["cruise"]);
  });

  it("keeps the newer value when an older write arrives late, and says so", async () => {
    await request(app)
      .put(PATH)
      .set("Cookie", cookieA)
      .send({
        sections: { theme: { value: { mapTheme: "classic" }, updatedAt: "2026-10-03T00:00:00Z" } },
      });
    const late = await request(app)
      .put(PATH)
      .set("Cookie", cookieA)
      .send({
        sections: {
          theme: { value: { mapTheme: "glassmorphism" }, updatedAt: "2026-10-02T00:00:00Z" },
        },
      });
    expect(late.status).toBe(200);
    expect(late.body.stale).toEqual(["theme"]);
    expect(late.body.sections.theme.value).toEqual({ mapTheme: "classic" });
  });

  it("drops an unknown section and stores the known ones beside it", async () => {
    const res = await request(app)
      .put(PATH)
      .set("Cookie", cookieA)
      .send({
        sections: { bogus: { value: { x: 1 } }, globeChrome: { value: { showNight: false } } },
      });
    expect(res.status).toBe(200);
    expect(res.body.dropped).toEqual(["bogus"]);
    expect(Object.keys(res.body.sections)).toEqual(["globeChrome"]);
  });

  it("refuses a value of the wrong kind with 400 WEB_PREFS_INVALID and stores nothing", async () => {
    const res = await request(app)
      .put(PATH)
      .set("Cookie", cookieA)
      .send({ sections: { dashboardHiddenDomains: { value: "cruise" } } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("WEB_PREFS_INVALID");
    const get = await request(app).get(PATH).set("Cookie", cookieA);
    expect(get.body.sections).toEqual({});
  });

  it("refuses an over-large section with 413 WEB_PREFS_TOO_LARGE", async () => {
    const chunk = "x".repeat(WEB_PREFS_LIMITS.maxStringLength);
    const value = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, chunk]));
    const res = await request(app)
      .put(PATH)
      .set("Cookie", cookieA)
      .send({ sections: { mapAppearance: { value } } });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("WEB_PREFS_TOO_LARGE");
  });

  it("refuses a malformed body with 400", async () => {
    const res = await request(app).put(PATH).set("Cookie", cookieA).send({ prefs: {} });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("WEB_PREFS_INVALID");
  });

  it("never touches the Companion's app_prefs", async () => {
    await request(app)
      .put("/api/v1/app-settings")
      .set("Cookie", cookieA)
      .send({ prefs: { units: "metric" } });
    await request(app)
      .put(PATH)
      .set("Cookie", cookieA)
      .send({ sections: { theme: { value: { mapTheme: "classic" } } } });

    const companion = await request(app).get("/api/v1/app-settings").set("Cookie", cookieA);
    expect(companion.body.prefs).toEqual({ units: "metric" });
  });

  it("isolates accounts — B sees none of A's sections", async () => {
    await request(app)
      .put(PATH)
      .set("Cookie", cookieA)
      .send({ sections: { domainColors: { value: { flight: "#abcdef" } } } });
    const res = await request(app).get(PATH).set("Cookie", cookieB);
    expect(res.status).toBe(200);
    expect(res.body.sections).toEqual({});
  });

  it("lets two concurrent writes of different sections both land", async () => {
    await Promise.all([
      request(app)
        .put(PATH)
        .set("Cookie", cookieA)
        .send({ sections: { statsCompare: { value: { compareEnabled: true } } } }),
      request(app)
        .put(PATH)
        .set("Cookie", cookieA)
        .send({ sections: { tablePrefs: { value: { sort: {} } } } }),
    ]);
    const get = await request(app).get(PATH).set("Cookie", cookieA);
    expect(Object.keys(get.body.sections).sort()).toEqual(["statsCompare", "tablePrefs"]);
  });

  describe("personal access tokens", () => {
    it("a read-scoped token may GET but not PUT", async () => {
      const pat = await createPat(userAId, "read");
      const get = await request(app).get(PATH).set("Authorization", `Bearer ${pat}`);
      expect(get.status).toBe(200);
      const put = await request(app)
        .put(PATH)
        .set("Authorization", `Bearer ${pat}`)
        .send({ sections: { theme: { value: {} } } });
      expect(put.status).toBe(403);
    });

    it("a write-scoped token writes its own owner's sections", async () => {
      const pat = await createPat(userBId, "write");
      const put = await request(app)
        .put(PATH)
        .set("Authorization", `Bearer ${pat}`)
        .send({ sections: { globeChrome: { value: { autoRotate: true } } } });
      expect(put.status).toBe(200);
      const viaCookie = await request(app).get(PATH).set("Cookie", cookieB);
      expect(viaCookie.body.sections.globeChrome.value).toEqual({ autoRotate: true });
      const other = await request(app).get(PATH).set("Cookie", cookieA);
      expect(other.body.sections).toEqual({});
    });
  });
});
