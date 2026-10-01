import { prisma } from "../../../db";
import { importSheets } from "../importSheets";

/**
 * Roadtrip costs round-trip through the spreadsheet (forgejo#140). The file is
 * for editing AND for moving a roadtrip into another account, so a roadtrip
 * that arrives without its ferry tickets and tolls is not a moved roadtrip —
 * and since the leg toll became an expense, without this sheet a moved
 * roadtrip would lose the tolls it used to carry on its legs.
 */
describe("spreadsheet import — roadtrip costs", () => {
  const USERS = ["xlsxcost", "xlsxcostvictim"];
  let userId: string;
  let victimId: string;

  const ctx = (mode: "add" | "merge" | "replace" = "merge", dryRun = false) => ({
    userId,
    mode,
    dryRun,
  });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    userId = (await prisma.user.create({ data: { username: USERS[0], passwordHash: "x" } })).id;
    victimId = (await prisma.user.create({ data: { username: USERS[1], passwordHash: "x" } })).id;
  });

  beforeEach(async () => {
    await prisma.tripRoute.deleteMany({ where: { userId: { in: [userId, victimId] } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });

  async function roadtripWith(titles: string[]) {
    const route = await prisma.tripRoute.create({
      data: { userId, name: "Norwegen", mode: "road", kind: "roadtrip" },
    });
    const ids: string[] = [];
    for (const [i, title] of titles.entries()) {
      ids.push(
        (
          await prisma.tripStop.create({
            data: { title, lat: 58 + i, lon: 6, routeId: route.id, routeOrderIdx: i },
          })
        ).id
      );
    }
    return { id: route.id, stationIds: ids };
  }

  it("moves a roadtrip with its stations, a pitch fee and a leg toll into another account", async () => {
    const sourceId = "11111111-2222-4333-8444-555555555555";
    const hamburg = "aaaaaaaa-0000-4000-8000-000000000001";
    const hirtshals = "aaaaaaaa-0000-4000-8000-000000000002";
    const ref = `Fjorde 2026 [${sourceId}]`;
    const sheets = [
      { key: "roadtrips", rows: [{ id: sourceId, name: "Fjorde 2026" }] },
      {
        key: "roadtripStations",
        rows: [
          { id: hamburg, roadtripId: ref, order: "1", title: "Hamburg", lat: "53.55", lon: "10" },
          {
            id: hirtshals,
            roadtripId: ref,
            order: "2",
            title: "Hirtshals",
            lat: "57.59",
            lon: "9.96",
            night: "free",
          },
        ],
      },
      {
        key: "roadtripExpenses",
        rows: [
          {
            id: "bbbbbbbb-0000-4000-8000-000000000001",
            roadtripId: ref,
            kind: "pitch",
            amount: "35.5",
            currency: "DKK",
            date: "2026-07-15",
            stopId: `Hirtshals [${hirtshals}]`,
          },
          {
            id: "bbbbbbbb-0000-4000-8000-000000000002",
            roadtripId: ref,
            kind: "toll",
            amount: "12.5",
            currency: "EUR",
            legFromStopId: `Hamburg [${hamburg}]`,
            legToStopId: `Hirtshals [${hirtshals}]`,
            note: "Brücke",
          },
        ],
      },
    ];

    const preview = await importSheets(sheets, ctx("merge", true));
    expect(preview.find((s) => s.key === "roadtripExpenses")).toMatchObject({
      created: 2,
      errors: 0,
    });
    expect(await prisma.tripExpense.count({ where: { userId } })).toBe(0);

    await importSheets(sheets, ctx());
    const moved = await prisma.tripRoute.findFirstOrThrow({ where: { userId } });
    const stops = await prisma.tripStop.findMany({ where: { routeId: moved.id } });
    const idOf = (title: string) => stops.find((s) => s.title === title)?.id;
    const rows = await prisma.tripExpense.findMany({
      where: { userId },
      orderBy: { kind: "asc" },
    });
    expect(rows.map((r) => ({ ...r, amount: r.amount.toNumber() }))).toEqual([
      expect.objectContaining({
        routeId: moved.id,
        kind: "pitch",
        amount: 35.5,
        currency: "DKK",
        date: new Date("2026-07-15T00:00:00Z"),
        stopId: idOf("Hirtshals"),
      }),
      expect.objectContaining({
        kind: "toll",
        amount: 12.5,
        legFromStopId: idOf("Hamburg"),
        legToStopId: idOf("Hirtshals"),
        note: "Brücke",
      }),
    ]);

    // The same file again converges instead of doubling.
    const [, , again] = await importSheets(sheets, ctx());
    expect(again).toMatchObject({ created: 0, errors: 0 });
    expect(await prisma.tripExpense.count({ where: { userId } })).toBe(2);
  });

  it("updates an own row by its id and leaves an untouched one unchanged", async () => {
    const { id, stationIds } = await roadtripWith(["Oslo"]);
    const fuel = await prisma.tripExpense.create({
      data: {
        userId,
        routeId: id,
        kind: "fuel",
        amount: 80,
        currency: "NOK",
        stopId: stationIds[0],
      },
    });
    const ferry = await prisma.tripExpense.create({
      data: { userId, routeId: id, kind: "ferry", amount: 1290, currency: "NOK" },
    });
    const [outcome] = await importSheets(
      [
        {
          key: "roadtripExpenses",
          rows: [
            {
              id: fuel.id,
              roadtripId: `Norwegen [${id}]`,
              kind: "fuel",
              amount: "82,40",
              currency: "NOK",
            },
            {
              id: ferry.id,
              roadtripId: `Norwegen [${id}]`,
              kind: "ferry",
              amount: "1290",
              currency: "NOK",
            },
          ],
        },
      ],
      ctx()
    );
    expect(outcome).toMatchObject({ updated: 1, skipped: 1, errors: 0 });
    const after = await prisma.tripExpense.findUniqueOrThrow({ where: { id: fuel.id } });
    expect(after.amount.toNumber()).toBe(82.4);
    // An empty station cell leaves the pin where it was.
    expect(after.stopId).toBe(stationIds[0]);
  });

  it("refuses a row without an amount, with an unknown currency, or with a station AND a leg", async () => {
    const { id, stationIds } = await roadtripWith(["Oslo", "Bergen"]);
    const ref = `Norwegen [${id}]`;
    const [outcome] = await importSheets(
      [
        {
          key: "roadtripExpenses",
          rows: [
            { roadtripId: ref, kind: "fuel", currency: "NOK" },
            { roadtripId: ref, kind: "fuel", amount: "10", currency: "XYZ" },
            {
              roadtripId: ref,
              kind: "toll",
              amount: "10",
              currency: "NOK",
              stopId: `Oslo [${stationIds[0]}]`,
              legFromStopId: `Oslo [${stationIds[0]}]`,
              legToStopId: `Bergen [${stationIds[1]}]`,
            },
            { kind: "fuel", amount: "10", currency: "NOK" },
          ],
        },
      ],
      ctx()
    );
    expect(outcome.rows.map((r) => r.message)).toEqual([
      "expense_needs_amount",
      "invalid_currency",
      "expense_station_or_leg",
      "expense_needs_roadtrip",
    ]);
    expect(await prisma.tripExpense.count({ where: { userId } })).toBe(0);
  });

  it("keeps the money but drops a station it cannot find, and says so", async () => {
    const { id } = await roadtripWith(["Oslo"]);
    const [outcome] = await importSheets(
      [
        {
          key: "roadtripExpenses",
          rows: [
            {
              roadtripId: `Norwegen [${id}]`,
              kind: "pitch",
              amount: "300",
              currency: "NOK",
              stopId: "Nirgendwo [cccccccc-0000-4000-8000-000000000009]",
            },
          ],
        },
      ],
      ctx()
    );
    expect(outcome).toMatchObject({ created: 1, errors: 0 });
    expect(outcome.rows[0].dropped).toEqual([
      { field: "station", value: "Nirgendwo [cccccccc-0000-4000-8000-000000000009]" },
    ]);
    const row = await prisma.tripExpense.findFirstOrThrow({ where: { userId } });
    expect(row.stopId).toBeNull();
  });

  it("never touches another account's expense named by id, and never pins to its station", async () => {
    const theirs = await prisma.tripRoute.create({
      data: { userId: victimId, name: "Fremd", mode: "road", kind: "roadtrip" },
    });
    const theirStop = await prisma.tripStop.create({
      data: { title: "Fremd", lat: 1, lon: 1, routeId: theirs.id, routeOrderIdx: 0 },
    });
    const theirExpense = await prisma.tripExpense.create({
      data: { userId: victimId, routeId: theirs.id, kind: "fuel", amount: 50, currency: "EUR" },
    });
    const { id } = await roadtripWith(["Oslo"]);
    await importSheets(
      [
        {
          key: "roadtripExpenses",
          rows: [
            {
              id: theirExpense.id,
              roadtripId: `Norwegen [${id}]`,
              kind: "fuel",
              amount: "1",
              currency: "EUR",
              stopId: `Fremd [${theirStop.id}]`,
            },
          ],
        },
      ],
      ctx()
    );
    const untouched = await prisma.tripExpense.findUniqueOrThrow({
      where: { id: theirExpense.id },
    });
    expect(untouched.amount.toNumber()).toBe(50);
    const mine = await prisma.tripExpense.findFirstOrThrow({ where: { userId } });
    expect(mine).toMatchObject({ routeId: id, stopId: null });
  });
});
