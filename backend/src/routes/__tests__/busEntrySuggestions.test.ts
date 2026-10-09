import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * GET /bus/entry-suggestions: the bus form's chips come from the user's own
 * rides only — operators, the fare classes used with one, and the terminals
 * typed so far, read at either end. Another user's rides are the proof of
 * scoping; an empty logbook is an answer, not a 404.
 */
describe("GET /bus/entry-suggestions", () => {
  const stamp = Date.now();
  let userId: string;
  let otherId: string;
  let emptyId: string;
  let cookie: string;
  let emptyCookie: string;

  const SEOUL = {
    name: "Seoul Express Bus Terminal",
    lat: 37.5048,
    lon: 127.0046,
    country: "KR",
    address: null,
  };
  const SOKCHO = { name: "Sokcho Intercity Bus Terminal", lat: 38.2086, lon: 128.5912 };
  const JEONJU = { name: "Jeonju Express Bus Terminal", lat: 35.8334, lon: 127.1146 };

  type Terminal = { name: string; lat: number; lon: number; country?: string };

  function ride(
    owner: string,
    from: Terminal,
    to: Terminal,
    extra: Record<string, unknown>,
    day: string
  ) {
    return {
      userId: owner,
      depStationName: from.name,
      depLat: from.lat,
      depLon: from.lon,
      depCountry: from.country ?? null,
      arrStationName: to.name,
      arrLat: to.lat,
      arrLon: to.lon,
      arrCountry: to.country ?? null,
      depTimezone: "Asia/Seoul",
      arrTimezone: "Asia/Seoul",
      depPrecision: "minute",
      arrPrecision: "minute",
      departureTime: new Date(`${day}T01:00:00Z`),
      ...extra,
    };
  }

  const get = (query: Record<string, string> = {}, as = cookie) =>
    request(app).get("/api/v1/bus/entry-suggestions").query(query).set("Cookie", as);

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    const make = async (name: string) =>
      (await prisma.user.create({ data: { username: `${name}-${stamp}`, passwordHash } })).id;
    userId = await make("bus-suggest");
    otherId = await make("bus-suggest-other");
    emptyId = await make("bus-suggest-empty");
    cookie = `auth_token=${generateToken(userId)}`;
    emptyCookie = `auth_token=${generateToken(emptyId)}`;
    await prisma.busJourney.createMany({
      data: [
        ride(userId, SEOUL, SOKCHO, { operator: "Kobus", fareClass: "Udeung" }, "2025-01-10"),
        ride(userId, SEOUL, JEONJU, { operator: "Kobus" }, "2025-02-10"),
        ride(userId, JEONJU, SEOUL, { operator: "Kumho" }, "2025-03-10"),
        // Someone else's ride, with an operator, class and terminal the user never used.
        ride(
          otherId,
          { name: "Seoul Nambu Terminal", lat: 37.4856, lon: 127.0161 },
          SOKCHO,
          { operator: "Stranger", fareClass: "Premium" },
          "2025-03-11"
        ),
      ],
    });
    // The Seoul row the first suggestion must be read from, with its address.
    await prisma.busJourney.updateMany({
      where: {
        userId,
        depStationName: SEOUL.name,
        departureTime: new Date("2025-02-10T01:00:00Z"),
      },
      data: { depAddress: "2177-1 Banpo-dong, Seocho-gu", depCountry: "KR" },
    });
  });

  afterAll(async () => {
    const ids = [userId, otherId, emptyId];
    await prisma.busJourney.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it("offers the user's operators by count, then name, and never anyone else's", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.operators).toEqual(["Kobus", "Kumho"]);
    expect(res.body.data.fareClasses).toEqual(["Udeung"]);
    expect(JSON.stringify(res.body)).not.toContain("Stranger");
    expect(JSON.stringify(res.body)).not.toContain("Premium");
    expect(JSON.stringify(res.body)).not.toContain("Nambu");
  });

  it("offers the terminals that start with what was typed, with position and address", async () => {
    const res = await get({ depName: "seo" });

    expect(res.status).toBe(200);
    expect(res.body.data.terminals).toEqual([
      {
        name: SEOUL.name,
        // The newest Seoul ride (arriving, 03-10) has no address; the older one does.
        address: "2177-1 Banpo-dong, Seocho-gu",
        lat: 37.5048,
        lon: 127.0046,
        country: "KR",
      },
    ]);
  });

  it("answers null, not a guess, for a terminal stored without address or country", async () => {
    // Sokcho is only ever an arrival: the departure field still finds it.
    const res = await get({ depName: "sokcho" });

    expect(res.body.data.terminals).toEqual([
      { name: SOKCHO.name, address: null, lat: 38.2086, lon: 128.5912, country: null },
    ]);
  });

  it("reads every typed name at both ends, one chip per terminal, newest ride first", async () => {
    const res = await get({ depName: "j", arrName: "s" });

    // Dep side "j": Jeonju (2025-03-10). Arr side "s": Seoul (03-10), Sokcho (01-10).
    expect((res.body.data.terminals as Array<{ name: string }>).map((t) => t.name)).toEqual([
      JEONJU.name,
      SEOUL.name,
      SOKCHO.name,
    ]);
    // Jeonju and Seoul share the newest ride (03-10); Seoul is one chip although
    // it appears as a departure and as an arrival.
  });

  it("merges one terminal spelled in two cases into one chip", async () => {
    const extra = await prisma.busJourney.create({
      data: ride(
        userId,
        { name: "SEOUL EXPRESS BUS TERMINAL", lat: 37.5048, lon: 127.0046, country: "KR" },
        SOKCHO,
        { operator: "kobus", fareClass: "udeung" },
        "2025-04-01"
      ),
    });
    try {
      const res = await get({ depName: "seoul", operator: "KOBUS" });
      const names = (res.body.data.terminals as Array<{ name: string }>).map((t) => t.name);
      expect(names).toEqual(["SEOUL EXPRESS BUS TERMINAL"]);
      // "Kobus" x2 and "kobus" x1 are one operator, spelled as the larger group has it.
      expect((await get()).body.data.operators).toEqual(["Kobus", "Kumho"]);
      expect(res.body.data.fareClasses).toEqual(["Udeung"]);
    } finally {
      await prisma.busJourney.delete({ where: { id: extra.id } });
    }
  });

  it("offers the fare classes used with the typed operator, case-insensitively", async () => {
    const kobus = await get({ operator: "kobus" });
    expect(kobus.body.data.fareClasses).toEqual(["Udeung"]);

    const kumho = await get({ operator: "Kumho" });
    expect(kumho.body.data.fareClasses).toEqual([]);
  });

  it("treats a wildcard in the typed name as text", async () => {
    const res = await get({ depName: "%" });
    expect(res.status).toBe(200);
    expect(res.body.data.terminals).toEqual([]);
  });

  it("answers an empty logbook with empty lists", async () => {
    const res = await get({ depName: "seo", operator: "Kobus" }, emptyCookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { operators: [], fareClasses: [], terminals: [] },
    });
  });

  it("treats blank parameters as absent and refuses an over-long one", async () => {
    const blank = await get({ depName: "  ", arrName: "", operator: "" });
    expect(blank.status).toBe(200);

    const long = await get({ depName: "x".repeat(201) });
    expect(long.status).toBe(400);
  });

  it("answers 401 without a session", async () => {
    const res = await request(app).get("/api/v1/bus/entry-suggestions");
    expect(res.status).toBe(401);
  });
});
