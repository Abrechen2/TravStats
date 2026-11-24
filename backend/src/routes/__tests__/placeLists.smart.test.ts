import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { clearBrandSearchCache } from "../../services/places/brandSearch";
import * as http from "../../services/openData/http";

const USERS = ["smartlistuser", "smartlistother"];
const BASE = "/api/v1/place-lists/smart";
const RULE = {
  brands: [{ brandWikidataId: "Q38076", brandName: "McDonald's" }],
  minDwellMinutes: 5,
  maxDwellMinutes: 60,
  maxDistanceM: 100,
  autoAcceptDistanceM: 60,
  autoAccept: false,
};

describe("Smart lists API", () => {
  let cookie: string;
  let otherCookie: string;
  let userId: string;
  let listId: string;
  const get = (url: string, c = cookie) => request(app).get(url).set("Cookie", c);
  const put = (url: string, body: unknown, c = cookie) =>
    request(app)
      .put(url)
      .set("Cookie", c)
      .send(body as object);

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    const u = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    const o = await prisma.user.create({
      data: { username: USERS[1], passwordHash: await hashPassword("password123") },
    });
    otherCookie = `auth_token=${generateToken(o.id)}`;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    jest.restoreAllMocks();
    clearBrandSearchCache();
    await prisma.placeList.deleteMany({ where: { userId } });
    listId = (await prisma.placeList.create({ data: { userId, name: "Maccis" } })).id;
  });

  it("stores the rule, reads it back, and refuses a window whose maximum is below its minimum", async () => {
    expect((await put(`${BASE}/${listId}/rule`, RULE)).status).toBe(200);
    const read = await get(`${BASE}/${listId}/rule`);
    expect(read.body.data).toMatchObject({
      listId,
      maxDistanceM: 100,
      autoAcceptDistanceM: 60,
      autoAccept: false,
    });
    expect(read.body.data.brands).toEqual(RULE.brands);
    const bad = await put(`${BASE}/${listId}/rule`, {
      ...RULE,
      minDwellMinutes: 30,
      maxDwellMinutes: 10,
    });
    expect(bad.status).toBe(400);
  });

  it("refuses an auto-accept distance above the suggestion distance", async () => {
    const bad = await put(`${BASE}/${listId}/rule`, { ...RULE, autoAcceptDistanceM: 150 });
    expect(bad.status).toBe(400);
  });

  it("does not let another account read or change the rule of a list that is not theirs", async () => {
    expect((await put(`${BASE}/${listId}/rule`, RULE, otherCookie)).status).toBe(404);
    expect((await get(`${BASE}/${listId}/rule`, otherCookie)).status).toBe(404);
  });

  it("a shipped checklist cannot follow a chain", async () => {
    const curated = await prisma.placeList.create({
      data: { userId, name: "Wonders", curatedKey: "world-wonders-new7" },
    });
    const res = await put(`${BASE}/${curated.id}/rule`, RULE);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LIST_IS_CURATED");
  });

  describe("brand search", () => {
    const claimsOf = (p31: string) => ({
      P31: [{ mainsnak: { datavalue: { value: { id: p31 } } } }],
    });
    /** The search answer, then the claims answer — the two requests a search makes. */
    const answerBoth = (search: unknown, entities: unknown) =>
      jest
        .spyOn(http, "fetchOpenData")
        .mockImplementation(async (_service, url) =>
          url.includes("wbgetentities")
            ? { ok: true, body: { entities } }
            : { ok: true, body: { search } }
        );

    it("returns Wikidata items and caches the answer", async () => {
      jest.spyOn(http, "isOpenDataEnabled").mockResolvedValue(true);
      const spy = answerBoth(
        [{ id: "Q38076", label: "McDonald's", description: "fast-food chain" }],
        { Q38076: { claims: claimsOf("Q18509232") } }
      );
      const first = await get(`${BASE}/brands?q=mcdon&lang=de`);
      expect(first.body.data).toEqual([
        { id: "Q38076", label: "McDonald's", description: "fast-food chain" },
      ]);
      await get(`${BASE}/brands?q=mcdon&lang=de`);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    // UAT rc.45: "McDonald" offered the surname and a crater beside the chain.
    it("offers only brands and chains — no surnames, no craters", async () => {
      jest.spyOn(http, "isOpenDataEnabled").mockResolvedValue(true);
      answerBoth(
        [
          { id: "Q38076", label: "McDonald's" },
          { id: "Q1", label: "McDonald", description: "family name" },
          { id: "Q2", label: "McDonald", description: "lunar crater" },
          { id: "Q3", label: "Lidl" },
        ],
        {
          Q38076: { claims: claimsOf("Q18509232") },
          Q1: { claims: claimsOf("Q101352") },
          Q2: { claims: {} },
          Q3: { claims: { P1454: [{ mainsnak: {} }] } },
        }
      );
      const res = await get(`${BASE}/brands?q=mcdonald-brands`);
      expect(res.body.data.map((h: { id: string }) => h.id)).toEqual(["Q38076", "Q3"]);
    });

    it("says why when the service is off, slow, refusing or malformed — never an empty list", async () => {
      jest.spyOn(http, "isOpenDataEnabled").mockResolvedValue(false);
      const off = await get(`${BASE}/brands?q=mcdon`);
      expect([off.status, off.body.code]).toEqual([409, "OPEN_DATA_DISABLED"]);
      jest.spyOn(http, "isOpenDataEnabled").mockResolvedValue(true);
      const fetchSpy = jest.spyOn(http, "fetchOpenData");
      for (const [failure, status, code] of [
        ["timeout", 504, "UPSTREAM_TIMEOUT"],
        ["rateLimited", 503, "UPSTREAM_RATE_LIMITED"],
        ["unavailable", 502, "UPSTREAM_UNAVAILABLE"],
      ] as const) {
        fetchSpy.mockResolvedValueOnce({ ok: false, failure, status: null });
        const res = await get(`${BASE}/brands?q=failure-${failure}`);
        expect([res.status, res.body.code]).toEqual([status, code]);
      }
      fetchSpy.mockResolvedValueOnce({ ok: true, body: { search: "nope" } });
      expect((await get(`${BASE}/brands?q=garbled`)).status).toBe(502);
      // A failure is not remembered as "no hits".
      fetchSpy.mockResolvedValueOnce({ ok: true, body: { search: [] } });
      expect((await get(`${BASE}/brands?q=failure-timeout`)).body.data).toEqual([]);
      // The claims read failing is a failure too, never the unfiltered list.
      fetchSpy
        .mockResolvedValueOnce({ ok: true, body: { search: [{ id: "Q9", label: "X" }] } })
        .mockResolvedValueOnce({ ok: false, failure: "timeout", status: null });
      expect((await get(`${BASE}/brands?q=claims-fail`)).status).toBe(504);
    });
  });

  it("answers the place page's suggestion query only for the owner's own place", async () => {
    const place = await prisma.place.create({
      data: { userId, name: "McDonald's", lat: 48, lon: 12 },
    });
    expect((await get(`${BASE}/place/${place.id}/suggestions`)).body.data).toEqual([]);
    expect((await get(`${BASE}/place/${place.id}/suggestions`, otherCookie)).status).toBe(404);
  });
});
