import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { achievementCountries } from "../../utils/achievementCountries";
import { generateApiToken } from "../../utils/apiTokens";
import { generateToken } from "../../utils/jwt";

/**
 * `/api/v1/passport/overrides` end to end (forgejo#308), through the real app
 * so the mount, the auth, the demo guard and the error handler are the ones a
 * browser meets — and through `/stats/passport` and `/stats/hero`, because an
 * override that the passport and its consumers did not see would be a note
 * and nothing more.
 */

const PREFIX = "ovr308-";
const BASE = "/api/v1/passport/overrides";

interface Account {
  id: string;
  cookie: string;
}

const ids: string[] = [];

async function account(name: string, isDemo = false): Promise<Account> {
  const user = await prisma.user.create({
    data: {
      username: name.startsWith("demo") ? name : `${PREFIX}${name}`,
      passwordHash: "x",
      isDemo,
    },
  });
  ids.push(user.id);
  return { id: user.id, cookie: `auth_token=${generateToken(user.id)}` };
}

let owner: Account;
let other: Account;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  owner = await account("owner");
  other = await account("other");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

const put = (who: Account, code: string, body: object) =>
  request(app).put(`${BASE}/${code}`).set("Cookie", who.cookie).send(body);

describe("passport overrides — the API", () => {
  it("requires a session", async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
    expect((await request(app).put(`${BASE}/PT`).send({})).status).toBe(401);
  });

  it("lists nothing at first, with the codes a write accepts", async () => {
    const res = await request(app).get(BASE).set("Cookie", owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.overrides).toEqual([]);
    expect(res.body.data.knownCountries).toEqual(expect.arrayContaining(["DE", "PT", "RU"]));
    expect(res.body.data.knownCountries).not.toContain("ZZ");
  });

  it("refuses a code that names no country, with a stable code", async () => {
    const res = await put(owner, "QQ", { verdict: "visited", note: "x" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("COUNTRY_UNKNOWN");
    expect((await put(owner, "Portugal", { verdict: "visited", note: "x" })).body.code).toBe(
      "COUNTRY_UNKNOWN"
    );
  });

  it.each([
    ["an empty note", { verdict: "visited", note: "   " }],
    ["a note over 500 characters", { verdict: "visited", note: "x".repeat(501) }],
    ["an unknown verdict", { verdict: "maybe", note: "x" }],
    ["a day that is no calendar day", { verdict: "visited", note: "x", day: "2025-02-30" }],
    ["an unknown field", { verdict: "visited", note: "x", tier: "slept" }],
  ])("refuses %s", async (_label, body) => {
    const res = await put(owner, "PT", body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("creates, then replaces, one override per country — case-insensitively", async () => {
    const created = await put(owner, "pt", {
      verdict: "visited",
      note: "  Lisbon weekend, no records  ",
      day: "2019-05-04",
    });
    expect(created.status).toBe(200);
    expect(created.body.data).toMatchObject({
      countryCode: "PT",
      verdict: "visited",
      note: "Lisbon weekend, no records",
      day: "2019-05-04",
    });

    const replaced = await put(owner, "PT", { verdict: "ground", note: "only the airport" });
    expect(replaced.status).toBe(200);
    expect(replaced.body.data).toMatchObject({ verdict: "ground", day: null });
    expect(await prisma.countryOverride.count({ where: { userId: owner.id } })).toBe(1);
  });

  it("shows the override in the passport, marked and counted", async () => {
    await put(owner, "PT", { verdict: "visited", note: "Lisbon weekend", day: "2019-05-04" });
    const res = await request(app).get("/api/v1/stats/passport").set("Cookie", owner.cookie);
    expect(res.status).toBe(200);
    const pt = res.body.countries.find((c: { code: string }) => c.code === "PT");
    expect(pt).toMatchObject({
      visited: true,
      evidence: "manual",
      override: { verdict: "visited", note: "Lisbon weekend", day: "2019-05-04" },
    });
    expect(res.body.summary.visitedCountries).toBe(1);
    expect(res.body.excludedCountries).toEqual([]);
  });

  it("is seen by the hero and the country badges, not only by the passport page", async () => {
    await put(owner, "PT", { verdict: "visited", note: "Lisbon weekend" });
    const hero = await request(app).get("/api/v1/stats/hero").set("Cookie", owner.cookie);
    expect(hero.status).toBe(200);
    expect(hero.body.countries).toBe(1);
    expect([...(await achievementCountries(owner.id, new Set()))]).toEqual(["PT"]);
  });

  it("lists an excluded country apart, out of every total", async () => {
    await put(owner, "FR", { verdict: "excluded", note: "hotel geocoded wrongly" });
    const res = await request(app).get("/api/v1/stats/passport").set("Cookie", owner.cookie);
    expect(res.body.excludedCountries).toEqual([
      { code: "FR", note: "hotel geocoded wrongly", day: null },
    ]);
    expect(res.body.countries.map((c: { code: string }) => c.code)).not.toContain("FR");
  });

  it("gives the country drill-down the same verdict as the passport row", async () => {
    await prisma.place.create({
      data: {
        userId: owner.id,
        name: "Belvedere",
        lat: 48.19,
        lon: 16.38,
        isoCountryCode: "AT",
        visited: true,
        visits: { create: [{ userId: owner.id, visitedAt: new Date("2024-04-03T00:00:00Z") }] },
      },
    });
    const before = await request(app).get("/api/v1/stats/countries/AT").set("Cookie", owner.cookie);
    expect(before.body).toMatchObject({ visited: true, override: null });

    await put(owner, "AT", { verdict: "ground", note: "geocoded into the wrong country" });
    const after = await request(app).get("/api/v1/stats/countries/AT").set("Cookie", owner.cookie);
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({
      visited: false,
      visitUncertain: false,
      override: { verdict: "ground", note: "geocoded into the wrong country" },
    });

    await put(owner, "AT", { verdict: "excluded", note: "not there" });
    const excluded = await request(app)
      .get("/api/v1/stats/countries/AT")
      .set("Cookie", owner.cookie);
    expect(excluded.body).toMatchObject({
      groundPresence: false,
      visited: false,
      visitUncertain: false,
      override: { verdict: "excluded", note: "not there" },
    });
    await request(app).delete(`${BASE}/AT`).set("Cookie", owner.cookie);
    await prisma.place.deleteMany({ where: { userId: owner.id } });
  });

  it("opens the drill-down of a country only a manual verdict puts in the passport", async () => {
    await put(owner, "PT", { verdict: "visited", note: "Lisbon weekend", day: "2019-05-04" });
    const res = await request(app).get("/api/v1/stats/countries/PT").set("Cookie", owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      code: "PT",
      evidence: "manual",
      visited: true,
      entries: 0,
      timeline: [],
      override: { verdict: "visited", note: "Lisbon weekend", day: "2019-05-04" },
    });
    // A country neither evidenced nor overridden stays a 404.
    const none = await request(app).get("/api/v1/stats/countries/NO").set("Cookie", owner.cookie);
    expect(none.status).toBe(404);
  });

  it("never shows one user's override to another", async () => {
    const list = await request(app).get(BASE).set("Cookie", other.cookie);
    expect(list.body.data.overrides).toEqual([]);
    const passport = await request(app).get("/api/v1/stats/passport").set("Cookie", other.cookie);
    expect(passport.body.countries).toEqual([]);
    // Nor delete it.
    const del = await request(app).delete(`${BASE}/PT`).set("Cookie", other.cookie);
    expect(del.status).toBe(404);
    expect(
      await prisma.countryOverride.count({ where: { userId: owner.id, countryCode: "PT" } })
    ).toBe(1);
  });

  it("deletes an override, and says so when there is none", async () => {
    const del = await request(app).delete(`${BASE}/pt`).set("Cookie", owner.cookie);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ success: true, data: { countryCode: "PT" } });
    const again = await request(app).delete(`${BASE}/PT`).set("Cookie", owner.cookie);
    expect(again.status).toBe(404);
    expect(again.body.code).toBe("COUNTRY_OVERRIDE_NOT_FOUND");
    const passport = await request(app).get("/api/v1/stats/passport").set("Cookie", owner.cookie);
    expect(passport.body.countries.map((c: { code: string }) => c.code)).not.toContain("PT");
  });

  it("refuses writes from a read-only token", async () => {
    const tok = await generateApiToken();
    await prisma.apiToken.create({
      data: {
        userId: owner.id,
        label: `${PREFIX}read`,
        lookupHash: tok.lookupHash,
        hash: tok.hash,
        scope: "read",
      },
    });
    const auth = { Authorization: `Bearer ${tok.plaintext}` };
    expect((await request(app).get(BASE).set(auth)).status).toBe(200);
    const res = await request(app)
      .put(`${BASE}/PT`)
      .set(auth)
      .send({ verdict: "visited", note: "x" });
    expect(res.status).toBe(403);
  });

  it("refuses writes from the shared demo account, which may still read", async () => {
    await prisma.user.deleteMany({ where: { username: "demo" } });
    const demo = await account("demo", true);
    expect((await request(app).get(BASE).set("Cookie", demo.cookie)).status).toBe(200);
    const res = await put(demo, "PT", { verdict: "visited", note: "x" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
    expect(await prisma.countryOverride.count({ where: { userId: demo.id } })).toBe(0);
  });
});
