import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * The 2.7 migration classifies every existing tour section by rule
 * (design 2026-09-24 §3.4). The rule is SQL, so it is tested as SQL: the
 * classification block of the real migration file runs against rows shaped
 * like the ones that exist, and the outcome is read back.
 */

const MIGRATION = path.join(
  __dirname,
  "../../prisma/migrations/20260924160000_roadtrips_and_day_tours/migration.sql"
);

function classificationStatements(): string[] {
  const sql = fs.readFileSync(MIGRATION, "utf-8");
  const block = sql.slice(sql.indexOf("-- Classify the rows that exist"));
  // Comments go first: they contain semicolons of their own.
  return block
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const USER = "migrationclassify";
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("migration 20260924160000 — classifying existing sections", () => {
  let userId: string;

  async function section(mode: string, dates: Array<[string, string | null]>) {
    const route = await prisma.tripRoute.create({ data: { userId, name: mode, mode } });
    for (const [i, [start, end]] of dates.entries()) {
      await prisma.tripStop.create({
        data: {
          title: `stop ${i}`,
          lat: 60,
          lon: 10 + i,
          routeId: route.id,
          routeOrderIdx: i,
          startDate: d(start),
          endDate: end ? d(end) : null,
        },
      });
    }
    return route.id;
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  });

  it("makes a multi-night road section a roadtrip and leaves the rest tours, all flagged", async () => {
    const roadTrip = await section("road", [
      ["2024-07-01", null],
      ["2024-07-04", "2024-07-06"],
    ]);
    const ferryDay = await section("ferry", [["2024-07-02", "2024-07-02"]]);
    const hike = await section("foot", [
      ["2024-07-03", null],
      ["2024-07-03", null],
    ]);
    const bikeTrip = await section("bike", [
      ["2024-08-01", null],
      ["2024-08-09", null],
    ]);
    const undated = await prisma.tripRoute.create({ data: { userId, name: "u", mode: "road" } });

    for (const statement of classificationStatements()) {
      await prisma.$executeRawUnsafe(statement);
    }

    const rows = await prisma.tripRoute.findMany({
      where: { userId },
      select: { id: true, kind: true, activity: true, kindAssignedAutomatically: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(roadTrip)).toMatchObject({ kind: "roadtrip", activity: null });
    expect(byId.get(ferryDay)).toMatchObject({ kind: "tour" });
    expect(byId.get(hike)).toMatchObject({ kind: "tour", activity: "hike" });
    // The case the flag exists for: nine days on a bike is a journey, but the
    // rule reads `bike` as a day tour. The owner corrects it in the UI.
    expect(byId.get(bikeTrip)).toMatchObject({ kind: "tour", activity: "bike" });
    expect(byId.get(undated.id)).toMatchObject({ kind: "tour" });
    expect(rows.every((r) => r.kindAssignedAutomatically)).toBe(true);
  });
});
