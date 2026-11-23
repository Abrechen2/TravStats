import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { computeSchematicRoute } from "../../services/schematicRouter";
import { ferryCreationLimiter } from "../../middleware/ferryCreationLimiter";
import { adoptLegacyManualLines } from "../../services/ferry/ferryPairMigration";

jest.mock("../../services/schematicRouter", () => ({
  ...jest.requireActual("../../services/schematicRouter"),
  computeSchematicRoute: jest.fn(),
}));

/**
 * GitHub #406/#407: a hand-drawn ferry line belongs to the pair of ports. The
 * owner redrew Galtby-Langnas once and the return trip, and a second trip on the
 * same corridor, kept the old sea route on the dashboard.
 */
const galtby = { name: "Galtby", lat: 60.0861, lon: 21.9906, country: "FI" };
const langnas = { name: "Långnäs", lat: 60.1046, lon: 20.2926, country: "AX" };
const via: Array<[number, number]> = [
  [21.5, 59.9],
  [20.9, 59.95],
];
const lineAB = [[galtby.lon, galtby.lat], ...via, [langnas.lon, langnas.lat]];
const chord = {
  waypoints: [lineAB[0], lineAB[3]],
  protectedPrefixCount: 0,
  protectedSuffixCount: 0,
  routed: false,
  method: "direct" as const,
};

let userId: string, cookie: string, otherId: string, otherCookie: string;

async function crossing(from: typeof galtby, to: typeof galtby, day: number, as = cookie) {
  jest.mocked(computeSchematicRoute).mockResolvedValue(chord);
  const res = await request(app)
    .post("/api/v1/ferry")
    .set("Cookie", as)
    .send({
      departureStation: from,
      arrivalStation: to,
      departureLocal: `2025-07-${String(day).padStart(2, "0")}T10:00`,
      arrivalLocal: `2025-07-${String(day).padStart(2, "0")}T14:00`,
    });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}
const row = (id: string) => prisma.ferryJourney.findUniqueOrThrow({ where: { id } });
const draw = (id: string, scope?: "pair" | "journey", points = lineAB) =>
  request(app)
    .put(`/api/v1/ferry/${id}/route-override`)
    .set("Cookie", cookie)
    .send({ waypoints: points, ...(scope && { scope }) });
const clear = (id: string, scope?: "all" | "journey") =>
  request(app)
    .delete(`/api/v1/ferry/${id}/route-override${scope ? `?scope=${scope}` : ""}`)
    .set("Cookie", cookie);

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { username: "pair-line-owner", passwordHash: "x" } }))
    .id;
  otherId = (await prisma.user.create({ data: { username: "pair-line-other", passwordHash: "x" } }))
    .id;
  cookie = `auth_token=${generateToken(userId)}`;
  otherCookie = `auth_token=${generateToken(otherId)}`;
});
afterEach(async () => {
  await prisma.ferryJourney.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  await prisma.ferryPairRoute.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  await ferryCreationLimiter.resetKey(`user:${userId}`);
  await ferryCreationLimiter.resetKey(`user:${otherId}`);
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
});

it("a redraw on A to B shows on B to A (reversed) and on a second A to B", async () => {
  const out = await crossing(galtby, langnas, 1);
  const back = await crossing(langnas, galtby, 2);
  const again = await crossing(galtby, langnas, 9);
  expect((await draw(out)).status).toBe(200);
  expect((await row(out)).geometry).toEqual(lineAB);
  expect((await row(again)).geometry).toEqual(lineAB);
  const backRow = await row(back);
  expect(backRow.geometrySource).toBe("manual");
  expect(backRow.geometry).toEqual([...lineAB].reverse());
  expect(backRow.manualScope).toBe("pair");
});

it("a crossing added after the pair line was drawn follows it", async () => {
  const out = await crossing(galtby, langnas, 1);
  await draw(out);
  const later = await crossing(langnas, galtby, 20);
  expect((await row(later)).geometry).toEqual([...lineAB].reverse());
});

it("another account's crossings on the same ports are not redrawn", async () => {
  const mine = await crossing(galtby, langnas, 1);
  const theirs = await crossing(galtby, langnas, 1, otherCookie);
  await draw(mine);
  expect((await row(theirs)).geometrySource).toBe("straight");
});

it("a port matches by normalised name AND coordinates: spelling folds, a different place does not", async () => {
  const out = await crossing(galtby, langnas, 1);
  const spelled = await crossing(galtby, { ...langnas, name: "LANGNAS" }, 2);
  const elsewhere = await crossing(galtby, { ...langnas, name: "Mariehamn" }, 3);
  const far = await crossing(galtby, { ...langnas, lat: 60.3, lon: 20.4 }, 4);
  await draw(out);
  expect((await row(spelled)).geometrySource).toBe("manual");
  expect((await row(elsewhere)).geometrySource).toBe("straight");
  expect((await row(far)).geometrySource).toBe("straight");
});

it('"only this crossing" stays local and a later pair redraw does not take it over', async () => {
  const out = await crossing(galtby, langnas, 1);
  const other = await crossing(galtby, langnas, 2);
  const third = await crossing(langnas, galtby, 3);
  await draw(out, "journey");
  expect((await row(out)).manualScope).toBe("journey");
  expect((await row(other)).geometrySource).toBe("straight");
  const newer: Array<[number, number]> = [
    [galtby.lon, galtby.lat],
    [21.0, 59.8],
    [langnas.lon, langnas.lat],
  ];
  await draw(third, "pair", [...newer].reverse());
  expect((await row(out)).geometry).toEqual(lineAB);
  expect((await row(other)).geometry).toEqual(newer);
});

it("clear for all drops the pair line everywhere; clear for one detaches only that crossing", async () => {
  const out = await crossing(galtby, langnas, 1);
  const back = await crossing(langnas, galtby, 2);
  const third = await crossing(galtby, langnas, 3);
  await draw(out);
  const one = await clear(back, "journey");
  expect(one.status).toBe(200);
  expect((await row(back)).geometrySource).toBe("straight");
  expect((await row(back)).manualScope).toBe("journey");
  expect((await row(out)).geometrySource).toBe("manual");
  expect((await row(third)).geometrySource).toBe("manual");
  expect(await prisma.ferryPairRoute.count({ where: { userId } })).toBe(1);
  // A detached crossing is not pulled back by the next pair save.
  await draw(out);
  expect((await row(back)).geometrySource).toBe("straight");
  const all = await clear(out);
  expect(all.status).toBe(200);
  expect(await prisma.ferryPairRoute.count({ where: { userId } })).toBe(0);
  expect((await row(out)).geometrySource).toBe("straight");
  expect((await row(third)).geometrySource).toBe("straight");
  expect((await row(third)).geometry).toBeNull();
});

it("reports how many crossings a pair line would reach", async () => {
  const out = await crossing(galtby, langnas, 1);
  await crossing(langnas, galtby, 2);
  await crossing(galtby, { ...langnas, name: "Mariehamn" }, 3);
  const res = await request(app).get(`/api/v1/ferry/${out}/route-pair`).set("Cookie", cookie);
  expect(res.body.data).toEqual({ count: 2, from: "Galtby", to: "Långnäs", hasPairLine: false });
});

it("a pair line reaches the linked roadtrip leg of a crossing it redraws", async () => {
  const out = await crossing(galtby, langnas, 1);
  const back = await crossing(langnas, galtby, 2);
  const trip = await prisma.trip.create({ data: { userId, name: "Pair trip" } });
  const route = await prisma.tripRoute.create({
    data: { userId, tripId: trip.id, name: "Archipelago", kind: "roadtrip", mode: "road" },
  });
  const mk = (title: string, p: { lat: number; lon: number }, orderIdx: number) =>
    prisma.tripStop.create({
      data: { tripId: trip.id, routeId: route.id, title, lat: p.lat, lon: p.lon, orderIdx },
    });
  const a = await mk("L", langnas, 0);
  const b = await mk("G", galtby, 1);
  const leg = await prisma.tripRouteLeg.create({
    data: {
      routeId: route.id,
      fromStopId: a.id,
      toStopId: b.id,
      mode: "road",
      source: "straight",
      distanceKm: 197,
    },
  });
  const link = await request(app)
    .put(`/api/v1/ferry/${back}/roadtrip-leg`)
    .set("Cookie", cookie)
    .send({ legId: leg.id });
  expect(link.status).toBeLessThan(300);
  await draw(out);
  const synced = await prisma.tripRouteLeg.findUniqueOrThrow({ where: { id: leg.id } });
  expect(synced.waypoints).toEqual([...lineAB].reverse());
});

describe("lines drawn before the pair line existed", () => {
  const seedManual = (id: string, line: unknown) =>
    prisma.ferryJourney.update({
      where: { id },
      data: { geometry: line as never, geometrySource: "manual", manualScope: null },
    });

  it("the only manual line on a pair becomes the pair line and redraws the rest", async () => {
    const out = await crossing(galtby, langnas, 1);
    const back = await crossing(langnas, galtby, 2);
    await seedManual(out, lineAB);
    await adoptLegacyManualLines();
    expect((await row(out)).manualScope).toBe("pair");
    expect(await prisma.ferryPairRoute.count({ where: { userId } })).toBe(1);
    expect((await row(back)).geometry).toEqual([...lineAB].reverse());
  });

  it("two manual lines on one pair conflict: each keeps its own, no pair line, nothing redrawn", async () => {
    const out = await crossing(galtby, langnas, 1);
    const back = await crossing(langnas, galtby, 2);
    const plain = await crossing(galtby, langnas, 3);
    const mine: Array<[number, number]> = [
      [galtby.lon, galtby.lat],
      [21.0, 59.8],
      [langnas.lon, langnas.lat],
    ];
    await seedManual(out, lineAB);
    await seedManual(back, [...mine].reverse());
    await adoptLegacyManualLines();
    expect(await prisma.ferryPairRoute.count({ where: { userId } })).toBe(0);
    expect((await row(out)).manualScope).toBe("journey");
    expect((await row(back)).manualScope).toBe("journey");
    expect((await row(out)).geometry).toEqual(lineAB);
    expect((await row(back)).geometry).toEqual([...mine].reverse());
    expect((await row(plain)).geometrySource).toBe("straight");
    // Idempotent.
    await adoptLegacyManualLines();
    expect((await row(out)).manualScope).toBe("journey");
  });
});
