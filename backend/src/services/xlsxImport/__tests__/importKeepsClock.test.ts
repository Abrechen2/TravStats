import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { importSheets } from "../importSheets";
import type { IncomingSheet } from "../types";

/**
 * SRV-EXPORT-001 (P2, beta audit 2026-09-20), ported onto the split importer.
 *
 * A German Excel export re-imported byte for byte moved a place visit from
 * 12:00 UTC to midnight: the visit column ran through `cell.isoDate`, which
 * keeps ten characters, and the "unchanged row" check then saw a different
 * instant and rewrote it. A cruise start that carries a boarding time went
 * the same way. The time of day must survive both an untouched cell (the full
 * ISO timestamp the reader hands back) and a hand-typed date-only cell on the
 * same day — a cell that names no clock says nothing about the hour.
 */

const USER = "xlsx-keeps-clock";
const VISIT_AT = "2024-04-05T12:00:00.000Z";
const CRUISE_START = "2024-04-03T08:00:00.000Z";
const CRUISE_END = "2024-04-10T10:00:00.000Z";
const ROUTE = "Westliches Mittelmeer";

let userId: string;
let placeId: string;
let visitId: string;
let cruiseId: string;

function sheets(
  visitedAt: string,
  startDate = CRUISE_START,
  endDate = CRUISE_END
): IncomingSheet[] {
  return [
    {
      key: "placeVisits",
      rows: [
        {
          id: visitId,
          placeId: `Trevi-Brunnen (Rom) [${placeId}]`,
          visitedAt,
          rating: "4",
          notes: "",
        },
      ],
    },
    {
      key: "cruises",
      rows: [
        {
          id: cruiseId,
          cruiseLine: "AIDA",
          ship: "AIDAcosma",
          routeName: ROUTE,
          startDate,
          endDate,
          status: "",
          departurePort: "",
          arrivalPort: "",
          cabinNumber: "",
          cabinType: "",
          deck: "",
          price: "",
          currency: "",
          bookingReference: "",
          tripId: "",
          companions: "",
          tags: "",
          notes: "",
        },
      ],
    },
  ];
}

const run = (s: IncomingSheet[]) => importSheets(s, { userId, dryRun: false, mode: "merge" });

const actions = (result: Awaited<ReturnType<typeof run>>) =>
  result.flatMap((s) => s.rows.map((r) => `${s.key}:${r.action}`));

async function visitAt(): Promise<string | undefined> {
  const v = await prisma.placeVisit.findUniqueOrThrow({ where: { id: visitId } });
  return v.visitedAt?.toISOString();
}

async function cruiseDates(): Promise<[string | undefined, string | undefined]> {
  const c = await prisma.cruise.findUniqueOrThrow({ where: { id: cruiseId } });
  return [c.startDate?.toISOString(), c.endDate?.toISOString()];
}

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { username: USER } });
  const u = await prisma.user.create({
    data: { username: USER, passwordHash: await hashPassword("password123") },
  });
  userId = u.id;
  const place = await prisma.place.create({
    data: {
      userId,
      name: "Trevi-Brunnen",
      category: "landmark",
      lat: 41.9009,
      lon: 12.4833,
      city: "Rom",
      country: "Italy",
      isoCountryCode: "IT",
      visited: true,
    },
  });
  placeId = place.id;
  const visit = await prisma.placeVisit.create({
    data: { userId, placeId, visitedAt: new Date(VISIT_AT), rating: 4 },
  });
  visitId = visit.id;
  const cruise = await prisma.cruise.create({
    data: {
      userId,
      cruiseLine: "AIDA",
      routeName: ROUTE,
      shipNameOverride: "AIDAcosma",
      startDate: new Date(CRUISE_START),
      endDate: new Date(CRUISE_END),
      status: "flown",
    },
  });
  cruiseId = cruise.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: USER } });
  await prisma.$disconnect();
});

describe("a re-imported date cell keeps the time of day", () => {
  it("leaves an untouched export alone — the full timestamp compares as unchanged", async () => {
    const result = await run(sheets(VISIT_AT));

    expect(actions(result)).toEqual(["placeVisits:skip", "cruises:skip"]);
    expect(await visitAt()).toBe(VISIT_AT);
    expect(await cruiseDates()).toEqual([CRUISE_START, CRUISE_END]);
  });

  it.each([
    ["an ISO day", "2024-04-05", "2024-04-03", "2024-04-10"],
    ["a German day", "05.04.2024", "03.04.2024", "10.04.2024"],
  ])("keeps the stored clock for %s on the same day", async (_label, visit, start, end) => {
    const result = await run(sheets(visit, start, end));

    expect(actions(result)).toEqual(["placeVisits:skip", "cruises:skip"]);
    expect(await visitAt()).toBe(VISIT_AT);
    expect(await cruiseDates()).toEqual([CRUISE_START, CRUISE_END]);
  });

  it("moves a visit typed onto a different day, at midnight, since it names no hour", async () => {
    const result = await run(sheets("06.04.2024"));

    expect(actions(result)).toEqual(["placeVisits:update", "cruises:skip"]);
    expect(await visitAt()).toBe("2024-04-06T00:00:00.000Z");
  });

  it("writes a clock the cell does name", async () => {
    const result = await run(sheets("05.04.2024 15:30", "2024-04-03T09:15:00.000Z"));

    expect(actions(result)).toEqual(["placeVisits:update", "cruises:update"]);
    expect(await visitAt()).toBe("2024-04-05T15:30:00.000Z");
    expect((await cruiseDates())[0]).toBe("2024-04-03T09:15:00.000Z");
  });

  it("still lets a stop name a NEW cruise by route and day when its start carries a clock", async () => {
    // A cruise created by this same file is found through the labels the
    // importer registers, not the database — so the label must stay a day.
    const [, cruiseSheet] = sheets(VISIT_AT);
    const fresh = {
      ...cruiseSheet.rows[0],
      id: "",
      routeName: "Oestliches Mittelmeer",
      startDate: "2024-06-01T08:00:00.000Z",
      endDate: "2024-06-08T10:00:00.000Z",
    };
    const result = await importSheets(
      [
        { key: "cruises", rows: [fresh] },
        {
          key: "cruiseStops",
          rows: [
            {
              id: "",
              cruiseId: "Oestliches Mittelmeer (2024-06-01)",
              dayNumber: "2",
              port: "",
              isAtSea: "true",
              arrivalTime: "",
              departureTime: "",
              excursionNote: "",
            },
          ],
        },
      ],
      { userId, dryRun: true, mode: "merge" }
    );

    expect(actions(result)).toEqual(["cruises:create", "cruiseStops:create"]);
  });
});
