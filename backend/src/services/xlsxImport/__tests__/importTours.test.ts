import { prisma } from "../../../db";
import { importSheets } from "../importSheets";

/**
 * Day tours round-trip through the spreadsheet like roadtrips (owner,
 * 2026-09-25: the file is for batch editing AND moving entries). A tour's
 * points are an ordered list written through the editor's own writer; a tour
 * that belongs to a trip takes its points from the trip's timeline, so its
 * point rows are shown, never written.
 */
describe("spreadsheet import — tours", () => {
  const USERS = ["xlsxtour", "xlsxtourvictim"];
  let userId: string;
  let victimTourId: string;

  const ctx = (mode: "add" | "merge" | "replace" = "merge", dryRun = false) => ({
    userId,
    mode,
    dryRun,
  });

  async function tourWith(
    titles: string[],
    over: { name?: string; tripId?: string } = {}
  ): Promise<{ id: string; pointIds: string[] }> {
    const route = await prisma.tripRoute.create({
      data: {
        userId,
        name: over.name ?? "Besseggen",
        mode: "foot",
        kind: "tour",
        activity: "hike",
        tripId: over.tripId ?? null,
      },
    });
    const pointIds: string[] = [];
    for (const [i, title] of titles.entries()) {
      const s = await prisma.tripStop.create({
        data: {
          title,
          lat: 61 + i / 10,
          lon: 8.8,
          routeId: route.id,
          routeOrderIdx: i,
          tripId: over.tripId ?? null,
        },
      });
      pointIds.push(s.id);
    }
    return { id: route.id, pointIds };
  }

  async function titlesOf(routeId: string): Promise<string[]> {
    const stops = await prisma.tripStop.findMany({
      where: { routeId },
      orderBy: { routeOrderIdx: "asc" },
    });
    return stops.map((s) => s.title);
  }

  const point = (tourRef: string, order: string, title: string, lat: string, id?: string) => ({
    ...(id ? { id } : {}),
    tourId: tourRef,
    order,
    title,
    lat,
    lon: "8.8",
  });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    userId = (await prisma.user.create({ data: { username: USERS[0], passwordHash: "x" } })).id;
    const victim = await prisma.user.create({ data: { username: USERS[1], passwordHash: "x" } });
    victimTourId = (
      await prisma.tripRoute.create({
        data: { userId: victim.id, name: "Fremd", mode: "foot", kind: "tour" },
      })
    ).id;
  });

  beforeEach(async () => {
    await prisma.tripRoute.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });

  it("creates a standalone tour from a row without an id and updates one with an id", async () => {
    const { id } = await tourWith([]);
    const [outcome] = await importSheets(
      [
        {
          key: "tours",
          rows: [
            { id, name: "Besseggen-Grat", activity: "walk", notes: "Nebel" },
            { name: "Radrunde", activity: "mtb" },
          ],
        },
      ],
      ctx()
    );
    expect(outcome).toMatchObject({ key: "tours", updated: 1, created: 1, errors: 0 });
    expect(await prisma.tripRoute.findUniqueOrThrow({ where: { id } })).toMatchObject({
      name: "Besseggen-Grat",
      activity: "walk",
      notes: "Nebel",
    });
    // A ride gets wheels, not feet, when the sheet names no mode.
    expect(
      await prisma.tripRoute.findFirstOrThrow({ where: { userId, name: "Radrunde" } })
    ).toMatchObject({ kind: "tour", tripId: null, mode: "bike", activity: "mtb" });
  });

  it("refuses an activity TravStats does not know", async () => {
    const [outcome] = await importSheets(
      [{ key: "tours", rows: [{ name: "X", activity: "skydive" }] }],
      ctx()
    );
    expect(outcome.rows[0]).toMatchObject({ action: "error", message: "invalid_activity" });
  });

  it("creates a new tour from someone else's id and never touches theirs", async () => {
    const [outcome] = await importSheets(
      [{ key: "tours", rows: [{ id: victimTourId, name: "Übernommen" }] }],
      ctx()
    );
    expect(outcome).toMatchObject({ created: 1, errors: 0 });
    expect((await prisma.tripRoute.findUniqueOrThrow({ where: { id: victimTourId } })).name).toBe(
      "Fremd"
    );
    expect(await prisma.tripRoute.count({ where: { userId, name: "Übernommen" } })).toBe(1);
  });

  it("recognises a moved tour and its points on the second read instead of doubling them", async () => {
    const sourceId = "22222222-2222-4333-8444-555555555555";
    const ref = `Besseggen [${sourceId}]`;
    const sheets = [
      {
        key: "tours",
        rows: [{ id: sourceId, name: "Besseggen", activity: "hike", startDate: "2026-07-01" }],
      },
      {
        key: "tourPoints",
        rows: [
          point(ref, "1", "Gjendesheim", "61.49", "aaaaaaaa-0000-4000-8000-0000000000a1"),
          point(ref, "2", "Memurubu", "61.51", "aaaaaaaa-0000-4000-8000-0000000000a2"),
        ],
      },
    ];
    const [preview, pointPreview] = await importSheets(sheets, ctx("merge", true));
    expect(preview).toMatchObject({ created: 1, errors: 0 });
    expect(pointPreview).toMatchObject({ created: 2, errors: 0 });
    expect(await prisma.tripRoute.count({ where: { userId } })).toBe(0);

    await importSheets(sheets, ctx());
    await importSheets(sheets, ctx());
    const tours = await prisma.tripRoute.findMany({ where: { userId, name: "Besseggen" } });
    expect(tours).toHaveLength(1);
    expect(await titlesOf(tours[0].id)).toEqual(["Gjendesheim", "Memurubu"]);
    // Legs follow the list — it went through the tour's one point writer.
    expect(await prisma.tripRouteLeg.count({ where: { routeId: tours[0].id } })).toBe(1);
  });

  it("orders points by the order column, inserts by decimal, keeps what the file leaves out", async () => {
    const { id, pointIds } = await tourWith(["A", "B", "C"]);
    const ref = `Besseggen [${id}]`;
    const [outcome] = await importSheets(
      [
        {
          key: "tourPoints",
          rows: [
            // B is left out of the file on purpose.
            point(ref, "1", "C", "61.2", pointIds[2]),
            point(ref, "3", "A", "61", pointIds[0]),
            { ...point(ref, "2.5", "Neu", "61.9"), notes: "Rast" },
          ],
        },
      ],
      ctx()
    );
    expect(outcome).toMatchObject({ created: 1, updated: 2, errors: 0, deleted: 0 });
    // B kept its place, 2, so Neu (2.5) lands between it and A (3).
    expect(await titlesOf(id)).toEqual(["C", "B", "Neu", "A"]);
    expect((await prisma.tripStop.findFirstOrThrow({ where: { title: "Neu" } })).notes).toBe(
      "Rast"
    );
  });

  it("removes the points a replace file leaves out, and says so in the preview first", async () => {
    const { id, pointIds } = await tourWith(["A", "B"]);
    const sheet = {
      key: "tourPoints",
      rows: [point(`Besseggen [${id}]`, "1", "A", "61", pointIds[0])],
    };
    const [preview] = await importSheets([sheet], ctx("replace", true));
    expect(preview.deleted).toBe(1);
    expect(await titlesOf(id)).toEqual(["A", "B"]);

    await importSheets([sheet], ctx("replace"));
    expect(await titlesOf(id)).toEqual(["A"]);
  });

  it("prunes a tour a replace file leaves out, releasing a trip's stops back to the trip", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Norwegen" } });
    const onTrip = await tourWith(["Bleibt"], { name: "Auf der Reise", tripId: trip.id });
    const kept = await tourWith([], { name: "Bleibt auch" });
    const sheet = { key: "tours", rows: [{ id: kept.id, name: "Bleibt auch" }] };

    const [preview] = await importSheets([sheet], ctx("replace", true));
    expect(preview.deleted).toBe(1);
    await importSheets([sheet], ctx("replace"));

    expect(await prisma.tripRoute.findUnique({ where: { id: onTrip.id } })).toBeNull();
    expect(
      await prisma.tripStop.findUniqueOrThrow({ where: { id: onTrip.pointIds[0] } })
    ).toMatchObject({ tripId: trip.id, routeId: null });
  });

  it("in add mode touches no existing tour or point, and only appends", async () => {
    const { id, pointIds } = await tourWith(["A", "B"]);
    const [tours, points] = await importSheets(
      [
        { key: "tours", rows: [{ id, name: "Umbenannt" }] },
        {
          key: "tourPoints",
          rows: [
            point(`Besseggen [${id}]`, "1", "Umbenannt", "1", pointIds[0]),
            point(`Besseggen [${id}]`, "9", "Neu", "62"),
          ],
        },
      ],
      ctx("add")
    );
    expect(tours).toMatchObject({ skipped: 1, updated: 0 });
    expect(points).toMatchObject({ created: 1, skipped: 1, errors: 0 });
    expect((await prisma.tripRoute.findUniqueOrThrow({ where: { id } })).name).toBe("Besseggen");
    expect(await titlesOf(id)).toEqual(["A", "B", "Neu"]);
  });

  it("skips the points of a tour that belongs to a trip — the timeline is edited at the trip", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Norwegen" } });
    const { id, pointIds } = await tourWith(["Stopp"], { tripId: trip.id });
    const [outcome] = await importSheets(
      [
        {
          key: "tourPoints",
          rows: [
            point(`Besseggen [${id}]`, "1", "Umbenannt", "61", pointIds[0]),
            point(`Besseggen [${id}]`, "2", "Neu", "62"),
          ],
        },
      ],
      ctx()
    );
    expect(outcome).toMatchObject({ skipped: 2, created: 0, updated: 0, errors: 0 });
    expect(await titlesOf(id)).toEqual(["Stopp"]);
  });

  it("holds a whole tour back when one of its rows is unreadable", async () => {
    const { id, pointIds } = await tourWith(["A", "B"]);
    const [outcome] = await importSheets(
      [
        {
          key: "tourPoints",
          rows: [
            point(`Besseggen [${id}]`, "1", "A neu", "61", pointIds[0]),
            point(`Besseggen [${id}]`, "2", "B", "nicht", pointIds[1]),
          ],
        },
      ],
      ctx("replace")
    );
    expect(outcome.errors).toBe(1);
    expect(await titlesOf(id)).toEqual(["A", "B"]);
  });

  it("anchors a tour moved with its roadtrip in one file on the station that moved", async () => {
    const roadtripId = "33333333-2222-4333-8444-555555555555";
    const stationId = "bbbbbbbb-0000-4000-8000-000000000001";
    await importSheets(
      [
        { key: "roadtrips", rows: [{ id: roadtripId, name: "Fjorde" }] },
        {
          key: "roadtripStations",
          rows: [
            {
              id: stationId,
              roadtripId: `Fjorde [${roadtripId}]`,
              order: "1",
              title: "Gjendesheim",
              lat: "61.49",
              lon: "8.81",
              night: "free",
            },
          ],
        },
        {
          key: "tours",
          rows: [
            {
              id: "44444444-2222-4333-8444-555555555555",
              name: "Besseggen",
              // A name the station does not carry: only the id can find it.
              anchorStopId: `Gjendesheim Turisthytte [${stationId}]`,
            },
          ],
        },
      ],
      ctx()
    );
    const roadtrip = await prisma.tripRoute.findFirstOrThrow({ where: { userId, name: "Fjorde" } });
    const station = await prisma.tripStop.findFirstOrThrow({ where: { routeId: roadtrip.id } });
    const tour = await prisma.tripRoute.findFirstOrThrow({ where: { userId, name: "Besseggen" } });
    expect(station.id).not.toBe(stationId);
    expect(tour.anchorStopId).toBe(station.id);
  });

  it("never anchors a tour on another account's station, and does not refuse the tour for it", async () => {
    const victim = await prisma.user.findUniqueOrThrow({ where: { username: USERS[1] } });
    const foreign = await prisma.tripRoute.create({
      data: { userId: victim.id, name: "Fremde Reise", mode: "road", kind: "roadtrip" },
    });
    const foreignStation = await prisma.tripStop.create({
      data: { title: "Fremd", lat: 1, lon: 1, routeId: foreign.id, routeOrderIdx: 0 },
    });
    const [outcome] = await importSheets(
      [{ key: "tours", rows: [{ name: "Ohne Anker", anchorStopId: `X [${foreignStation.id}]` }] }],
      ctx()
    );
    expect(outcome).toMatchObject({ created: 1, errors: 0 });
    const tour = await prisma.tripRoute.findFirstOrThrow({ where: { userId, name: "Ohne Anker" } });
    expect(tour.anchorStopId).toBeNull();
    await prisma.tripRoute.delete({ where: { id: foreign.id } });
  });

  it("never writes points into another account's tour", async () => {
    const [outcome] = await importSheets(
      [{ key: "tourPoints", rows: [point(`[${victimTourId}]`, "1", "Einbruch", "1")] }],
      ctx()
    );
    expect(outcome.rows[0]).toMatchObject({ action: "error", message: "unknown_tour" });
    expect(await prisma.tripStop.count({ where: { routeId: victimTourId } })).toBe(0);
  });
});
