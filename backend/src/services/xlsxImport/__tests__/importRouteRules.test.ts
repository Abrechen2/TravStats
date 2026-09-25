import { prisma } from "../../../db";
import { importSheets } from "../importSheets";
import type { IncomingSheet } from "../types";

/**
 * The rules every sheet follows since 2026-09-25 hold on the four
 * route-shaped sheets too (roadtrips, stations, tours, tour points), which
 * joined the workbook on a parallel line and had their own id handling until
 * the two were merged into one:
 *
 *  - an untouched export reads back as "unchanged" and writes nothing — for
 *    stations and points that means the ordered list is not rewritten;
 *  - an unknown enum cell is left empty and reported, never a refused row,
 *    and on an existing entry the stored value is kept (and the preview says
 *    so);
 *  - errors name the Excel row the client recorded, not `index + 2`;
 *  - a row recognised by its natural key says so.
 */
describe("spreadsheet import — route sheets follow the rules of every sheet", () => {
  const USER = "xlsxrouterules";
  let userId: string;

  const ctx = (mode: "add" | "merge" | "replace" = "merge", dryRun = false) => ({
    userId,
    mode,
    dryRun,
  });

  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  interface Seeded {
    roadtripId: string;
    stationIds: string[];
    tourId: string;
    pointIds: string[];
  }

  async function seed(): Promise<Seeded> {
    const roadtrip = await prisma.tripRoute.create({
      data: {
        userId,
        name: "Norwegen",
        mode: "road",
        kind: "roadtrip",
        vehicle: "campervan",
        vehicleName: "Bulli",
        startOdometerKm: 1000,
        notes: "Sommer",
      },
    });
    const stationIds: string[] = [];
    for (const [i, s] of [
      { title: "Hamburg", lat: 53.55, lon: 10, start: "2026-07-01", overnight: false },
      { title: "Bergen", lat: 60.39, lon: 5.32, start: "2026-07-03", overnight: true },
    ].entries()) {
      const stop = await prisma.tripStop.create({
        data: {
          title: s.title,
          lat: s.lat,
          lon: s.lon,
          startDate: day(s.start),
          endDate: day(s.start),
          overnight: s.overnight,
          notes: i === 1 ? "Fischmarkt" : null,
          routeId: roadtrip.id,
          routeOrderIdx: i,
          domain: "roadtrip",
        },
      });
      stationIds.push(stop.id);
    }
    const tour = await prisma.tripRoute.create({
      data: { userId, name: "Trolltunga", mode: "foot", kind: "tour", activity: "hike" },
    });
    const pointIds: string[] = [];
    for (const [i, title] of ["Parkplatz", "Zunge"].entries()) {
      const p = await prisma.tripStop.create({
        data: {
          title,
          lat: 60.1 + i / 10,
          lon: 6.7,
          notes: i === 0 ? "P2" : null,
          routeId: tour.id,
          routeOrderIdx: i,
        },
      });
      pointIds.push(p.id);
    }
    return { roadtripId: roadtrip.id, stationIds, tourId: tour.id, pointIds };
  }

  /** The four sheets as `frontend/src/lib/xlsx/roadtripSheets.ts` writes them. */
  function exported(s: Seeded): IncomingSheet[] {
    const rt = `Norwegen [${s.roadtripId}]`;
    const tr = `Trolltunga [${s.tourId}]`;
    return [
      {
        key: "roadtrips",
        rows: [
          {
            id: s.roadtripId,
            name: "Norwegen",
            vehicle: "campervan",
            vehicleName: "Bulli",
            startDate: "2026-07-01",
            endDate: "2026-07-03",
            startOdometerKm: "1000",
            notes: "Sommer",
          },
        ],
      },
      {
        key: "roadtripStations",
        rows: [
          {
            id: s.stationIds[0],
            roadtripId: rt,
            order: "1",
            title: "Hamburg",
            lat: "53.55",
            lon: "10",
            startDate: "2026-07-01",
            endDate: "2026-07-01",
            night: "pass",
          },
          {
            id: s.stationIds[1],
            roadtripId: rt,
            order: "2",
            title: "Bergen",
            lat: "60.39",
            lon: "5.32",
            startDate: "2026-07-03",
            endDate: "2026-07-03",
            night: "free",
            notes: "Fischmarkt",
          },
        ],
      },
      {
        key: "tours",
        rows: [{ id: s.tourId, name: "Trolltunga", activity: "hike", mode: "foot" }],
      },
      {
        key: "tourPoints",
        rows: [
          {
            id: s.pointIds[0],
            tourId: tr,
            order: "1",
            title: "Parkplatz",
            lat: "60.1",
            lon: "6.7",
            notes: "P2",
          },
          { id: s.pointIds[1], tourId: tr, order: "2", title: "Zunge", lat: "60.2", lon: "6.7" },
        ],
      },
    ];
  }

  async function stamps(): Promise<string[]> {
    const routes = await prisma.tripRoute.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      select: { id: true, updatedAt: true, stops: { select: { id: true, updatedAt: true } } },
    });
    return routes.flatMap((r) => [
      `${r.id}:${r.updatedAt.getTime()}`,
      ...r.stops.map((s) => `${s.id}:${s.updatedAt.getTime()}`).sort((a, b) => a.localeCompare(b)),
    ]);
  }

  const actions = (result: Awaited<ReturnType<typeof importSheets>>) =>
    result.flatMap((s) => s.rows.map((r) => `${s.key}:${r.action}`));

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  });

  it("previews an untouched export as unchanged and writes nothing when applied", async () => {
    const sheets = exported(await seed());

    const preview = await importSheets(sheets, ctx("merge", true));
    expect(actions(preview)).toEqual([
      "roadtrips:skip",
      "roadtripStations:skip",
      "roadtripStations:skip",
      "tours:skip",
      "tourPoints:skip",
      "tourPoints:skip",
    ]);

    const before = await stamps();
    // Past the timestamp resolution, so a rewrite could not land on the same ms.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await importSheets(sheets, ctx());
    expect(await stamps()).toEqual(before);
  });

  it("marks only the edited station and point as changed", async () => {
    const s = await seed();
    const sheets = exported(s);
    sheets[1].rows[1] = { ...sheets[1].rows[1], title: "Bergen Havn" };
    sheets[3].rows[0] = { ...sheets[3].rows[0], notes: "P3" };

    const result = await importSheets(sheets, ctx());
    expect(actions(result)).toEqual([
      "roadtrips:skip",
      "roadtripStations:skip",
      "roadtripStations:update",
      "tours:skip",
      "tourPoints:update",
      "tourPoints:skip",
    ]);
    expect(
      (await prisma.tripStop.findUniqueOrThrow({ where: { id: s.stationIds[1] } })).title
    ).toBe("Bergen Havn");
    expect((await prisma.tripStop.findUniqueOrThrow({ where: { id: s.pointIds[0] } })).notes).toBe(
      "P3"
    );
  });

  it("a swapped order column is a change to the rows that moved", async () => {
    const s = await seed();
    const sheets = exported(s);
    sheets[1].rows[0] = { ...sheets[1].rows[0], order: "3" };

    const [, stations] = await importSheets(sheets, ctx());
    expect(stations.rows.map((r) => r.action)).toEqual(["update", "update"]);
    const order = await prisma.tripStop.findMany({
      where: { routeId: s.roadtripId },
      orderBy: { routeOrderIdx: "asc" },
    });
    expect(order.map((o) => o.title)).toEqual(["Bergen", "Hamburg"]);
  });

  it("leaves an unknown vehicle, activity and mode empty on a new entry, and says so", async () => {
    const [roadtrips, tours] = await importSheets(
      [
        { key: "roadtrips", rows: [{ name: "Neu", vehicle: "Zeppelin" }] },
        { key: "tours", rows: [{ name: "Neue Tour", activity: "skydive", mode: "teleport" }] },
      ],
      ctx()
    );
    expect(roadtrips.rows[0]).toMatchObject({
      action: "create",
      dropped: [{ field: "vehicle", value: "Zeppelin" }],
    });
    expect(roadtrips.rows[0].dropped?.[0]).not.toHaveProperty("kept");
    expect(tours.rows[0]).toMatchObject({
      action: "create",
      dropped: [
        { field: "activity", value: "skydive" },
        { field: "mode", value: "teleport" },
      ],
    });
    expect(
      await prisma.tripRoute.findFirstOrThrow({ where: { userId, name: "Neu" } })
    ).toMatchObject({ vehicle: null, kind: "roadtrip" });
    expect(
      await prisma.tripRoute.findFirstOrThrow({ where: { userId, name: "Neue Tour" } })
    ).toMatchObject({ activity: null, mode: "foot" });
  });

  it("keeps the stored vehicle and night behind an unknown cell, and the preview says kept", async () => {
    const s = await seed();
    const sheets = exported(s);
    sheets[0].rows[0] = { ...sheets[0].rows[0], vehicle: "Zeppelin" };
    sheets[1].rows[1] = { ...sheets[1].rows[1], night: "Zelt" };

    const [roadtrips, stations] = await importSheets(sheets, ctx());
    expect(roadtrips.rows[0]).toMatchObject({
      action: "skip",
      dropped: [{ field: "vehicle", value: "Zeppelin", kept: true }],
    });
    expect(stations.rows[1]).toMatchObject({
      action: "skip",
      dropped: [{ field: "night", value: "Zelt", kept: true }],
    });
    expect(
      (await prisma.tripRoute.findUniqueOrThrow({ where: { id: s.roadtripId } })).vehicle
    ).toBe("campervan");
    expect(
      (await prisma.tripStop.findUniqueOrThrow({ where: { id: s.stationIds[1] } })).overnight
    ).toBe(true);
  });

  it("reports the Excel row the client recorded", async () => {
    const [roadtrips, points] = await importSheets(
      [
        {
          key: "roadtrips",
          rows: [{ name: "A" }, { startOdometerKm: "viel" }],
          rowNumbers: [4, 11],
        },
        {
          key: "tourPoints",
          rows: [{ tourId: "Gibt es nicht", title: "X", lat: "1", lon: "1" }],
          rowNumbers: [7],
        },
      ],
      ctx("merge", true)
    );
    expect(roadtrips.rows.map((r) => [r.row, r.action])).toEqual([
      [4, "create"],
      [11, "error"],
    ]);
    expect(points.rows[0]).toMatchObject({ row: 7, action: "error", message: "unknown_tour" });
  });

  it("says a roadtrip and tour were recognised, not named, on the second read of a moved file", async () => {
    const sheets: IncomingSheet[] = [
      {
        key: "roadtrips",
        rows: [{ id: "11111111-2222-4333-8444-000000000001", name: "Fremd-Roadtrip" }],
      },
      { key: "tours", rows: [{ id: "11111111-2222-4333-8444-000000000002", name: "Fremd-Tour" }] },
    ];
    await importSheets(sheets, ctx());
    const [roadtrips, tours] = await importSheets(sheets, ctx());
    expect(roadtrips.rows[0]).toMatchObject({ action: "skip", message: "matched_existing" });
    expect(tours.rows[0]).toMatchObject({ action: "skip", message: "matched_existing" });
    expect(await prisma.tripRoute.count({ where: { userId } })).toBe(2);
  });
});
