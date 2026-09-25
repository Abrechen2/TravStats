import { prisma } from "../../../db";
import { importSheets } from "../importSheets";

/**
 * Roadtrips round-trip through the spreadsheet (owner, 2026-09-25: the export
 * is "for batch editing and as a backup", and roadtrips were missing from it).
 * Stations are the hard part: an ordered list written through the same
 * `replaceStations` the editor uses, so an edited order must come out as the
 * new order, and a station the file does not mention must stay unless the
 * mode is `replace`.
 */
describe("spreadsheet import — roadtrips", () => {
  const USERS = ["xlsxroad", "xlsxroadvictim"];
  let userId: string;
  let victimRoadtripId: string;

  const ctx = (mode: "add" | "merge" | "replace" = "merge", dryRun = false) => ({
    userId,
    mode,
    dryRun,
  });

  async function roadtripWith(titles: string[]): Promise<{ id: string; stationIds: string[] }> {
    const route = await prisma.tripRoute.create({
      data: { userId, name: "Norwegen", mode: "road", kind: "roadtrip" },
    });
    const stationIds: string[] = [];
    for (const [i, title] of titles.entries()) {
      const s = await prisma.tripStop.create({
        data: {
          title,
          lat: 58 + i,
          lon: 6,
          routeId: route.id,
          routeOrderIdx: i,
          domain: "roadtrip",
        },
      });
      stationIds.push(s.id);
    }
    return { id: route.id, stationIds };
  }

  async function titlesOf(routeId: string): Promise<string[]> {
    const stops = await prisma.tripStop.findMany({
      where: { routeId },
      orderBy: { routeOrderIdx: "asc" },
    });
    return stops.map((s) => s.title);
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    userId = (await prisma.user.create({ data: { username: USERS[0], passwordHash: "x" } })).id;
    const victim = await prisma.user.create({ data: { username: USERS[1], passwordHash: "x" } });
    victimRoadtripId = (
      await prisma.tripRoute.create({
        data: { userId: victim.id, name: "Fremd", mode: "road", kind: "roadtrip" },
      })
    ).id;
  });

  beforeEach(async () => {
    await prisma.tripRoute.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });

  it("creates a roadtrip from a row without an id and updates one with an id", async () => {
    const { id } = await roadtripWith([]);
    const [outcome] = await importSheets(
      [
        {
          key: "roadtrips",
          rows: [
            { id, name: "Norwegen 2026", vehicle: "campervan", startOdometerKm: "84210" },
            { name: "Neu aus der Tabelle", vehicle: "motorhome" },
          ],
        },
      ],
      ctx()
    );
    expect(outcome).toMatchObject({ updated: 1, created: 1, errors: 0 });
    expect(await prisma.tripRoute.findUniqueOrThrow({ where: { id } })).toMatchObject({
      name: "Norwegen 2026",
      vehicle: "campervan",
      startOdometerKm: 84210,
    });
    expect(
      await prisma.tripRoute.count({
        where: { userId, name: "Neu aus der Tabelle", kind: "roadtrip" },
      })
    ).toBe(1);
  });

  // `rail` left the vehicles on 2026-09-25. An exported roadtrip by rail comes
  // back with that cell: the stored value is kept and the drop reported, and a
  // new row cannot become a roadtrip by rail.
  it("keeps a stored rail vehicle on re-import and gives a new row none", async () => {
    const route = await prisma.tripRoute.create({
      data: { userId, name: "Interrail", mode: "rail", kind: "roadtrip", vehicle: "rail" },
    });
    const [outcome] = await importSheets(
      [
        {
          key: "roadtrips",
          rows: [
            { id: route.id, name: "Interrail 2025", vehicle: "rail" },
            { name: "Noch ein Zug", vehicle: "rail" },
          ],
        },
      ],
      ctx()
    );
    expect(outcome).toMatchObject({ updated: 1, created: 1, errors: 0 });
    expect(await prisma.tripRoute.findUniqueOrThrow({ where: { id: route.id } })).toMatchObject({
      name: "Interrail 2025",
      vehicle: "rail",
    });
    const created = await prisma.tripRoute.findFirstOrThrow({
      where: { userId, name: "Noch ein Zug" },
    });
    expect(created.vehicle).toBeNull();
    expect(outcome.rows.every((r) => r.dropped?.[0]?.field === "vehicle")).toBe(true);
  });

  it("creates a new roadtrip from someone else's id and never touches theirs", async () => {
    const [outcome] = await importSheets(
      [{ key: "roadtrips", rows: [{ id: victimRoadtripId, name: "Übernommen" }] }],
      ctx()
    );
    expect(outcome).toMatchObject({ created: 1, errors: 0 });
    expect(
      (await prisma.tripRoute.findUniqueOrThrow({ where: { id: victimRoadtripId } })).name
    ).toBe("Fremd");
    expect(await prisma.tripRoute.count({ where: { userId, name: "Übernommen" } })).toBe(1);
  });

  it("moves a roadtrip with its stations into another account in one file", async () => {
    // As exported from another account: ids that mean nothing here.
    const sourceId = "11111111-2222-4333-8444-555555555555";
    const sheets = [
      { key: "roadtrips", rows: [{ id: sourceId, name: "Fjorde 2026", vehicle: "campervan" }] },
      {
        key: "roadtripStations",
        rows: [
          {
            id: "aaaaaaaa-0000-4000-8000-000000000001",
            roadtripId: `Fjorde 2026 [${sourceId}]`,
            order: "1",
            title: "Hamburg",
            lat: "53.55",
            lon: "10",
            night: "pass",
          },
          {
            id: "aaaaaaaa-0000-4000-8000-000000000002",
            roadtripId: `Fjorde 2026 [${sourceId}]`,
            order: "2",
            title: "Hirtshals",
            lat: "57.59",
            lon: "9.96",
            night: "free",
          },
          // A stay from the other account: the night stays, the link cannot.
          {
            roadtripId: `Fjorde 2026 [${sourceId}]`,
            order: "3",
            title: "Stavanger",
            lat: "58.97",
            lon: "5.73",
            night: "stay",
            lodgingStayId: "Mosvangen [aaaaaaaa-0000-4000-8000-00000000ffff]",
          },
        ],
      },
    ];

    const [preview, stationPreview] = await importSheets(sheets, ctx("merge", true));
    expect(preview).toMatchObject({ created: 1, errors: 0 });
    expect(stationPreview).toMatchObject({ created: 3, errors: 0 });
    expect(await prisma.tripRoute.count({ where: { userId } })).toBe(0);

    await importSheets(sheets, ctx());
    const moved = await prisma.tripRoute.findFirstOrThrow({
      where: { userId, name: "Fjorde 2026" },
    });
    expect(await titlesOf(moved.id)).toEqual(["Hamburg", "Hirtshals", "Stavanger"]);
    const stavanger = await prisma.tripStop.findFirstOrThrow({
      where: { routeId: moved.id, title: "Stavanger" },
    });
    expect(stavanger).toMatchObject({ lodgingStayId: null, overnight: true });

    // The same file again: the roadtrip AND its stations are recognised, not doubled.
    await importSheets(sheets, ctx());
    expect(await prisma.tripRoute.count({ where: { userId, name: "Fjorde 2026" } })).toBe(1);
    expect(await titlesOf(moved.id)).toEqual(["Hamburg", "Hirtshals", "Stavanger"]);
  });

  it("links a moved station to the stay that moved with it — same house, same arrival", async () => {
    // The lodging sheet of the same file created this stay in this account.
    const lodging = await prisma.lodging.create({ data: { userId, name: "Mosvangen Camping" } });
    const stay = await prisma.lodgingStay.create({
      data: {
        lodgingId: lodging.id,
        userId,
        checkIn: new Date("2026-09-19"),
        checkOut: new Date("2026-09-22"),
      },
    });
    const sourceId = "11111111-2222-4333-8444-666666666666";
    await importSheets(
      [
        { key: "roadtrips", rows: [{ id: sourceId, name: "Mit Unterkunft" }] },
        {
          key: "roadtripStations",
          rows: [
            {
              roadtripId: `Mit Unterkunft [${sourceId}]`,
              title: "Stavanger",
              lat: "58.97",
              lon: "5.73",
              startDate: "2026-09-19",
              endDate: "2026-09-22",
              night: "stay",
              lodgingStayId: "Mosvangen Camping [aaaaaaaa-0000-4000-8000-00000000eeee]",
            },
          ],
        },
      ],
      ctx()
    );
    const route = await prisma.tripRoute.findFirstOrThrow({
      where: { userId, name: "Mit Unterkunft" },
    });
    const station = await prisma.tripStop.findFirstOrThrow({ where: { routeId: route.id } });
    expect(station).toMatchObject({ lodgingStayId: stay.id, overnight: true });
  });

  it("finds a station's roadtrip by its name when the cell carries no id", async () => {
    const { id } = await roadtripWith(["Hamburg"]);
    const [outcome] = await importSheets(
      [
        {
          key: "roadtripStations",
          rows: [
            {
              roadtripId: "Norwegen",
              order: "2",
              title: "Neu",
              lat: "60",
              lon: "7",
              night: "free",
            },
          ],
        },
      ],
      ctx()
    );
    expect(outcome).toMatchObject({ created: 1, errors: 0 });
    expect(await titlesOf(id)).toEqual(["Hamburg", "Neu"]);
  });

  it("reorders by the order column, inserts a new station by decimal, keeps what the file leaves out", async () => {
    const { id, stationIds } = await roadtripWith(["Hamburg", "Hirtshals", "Stavanger"]);
    const ref = `Norwegen [${id}]`;
    const [outcome] = await importSheets(
      [
        {
          key: "roadtripStations",
          rows: [
            // Hirtshals is left out of the file on purpose.
            {
              id: stationIds[2],
              roadtripId: ref,
              order: "1",
              title: "Stavanger",
              lat: "58.97",
              lon: "5.73",
              night: "free",
            },
            {
              id: stationIds[0],
              roadtripId: ref,
              order: "3",
              title: "Hamburg",
              lat: "53.55",
              lon: "10",
              night: "pass",
            },
            {
              roadtripId: ref,
              order: "2.5",
              title: "Odda",
              lat: "60.07",
              lon: "6.55",
              night: "free",
              startDate: "2026-09-22",
            },
          ],
        },
      ],
      ctx()
    );
    expect(outcome).toMatchObject({ created: 1, updated: 2, errors: 0, deleted: 0 });
    // Hirtshals kept its place, 2, so Odda (2.5) lands between it and Hamburg (3).
    expect(await titlesOf(id)).toEqual(["Stavanger", "Hirtshals", "Odda", "Hamburg"]);
    // Legs follow the new order — the list went through the one station writer.
    expect(await prisma.tripRouteLeg.count({ where: { routeId: id } })).toBe(3);
  });

  it("removes the stations a replace file leaves out, and says so in the preview first", async () => {
    const { id, stationIds } = await roadtripWith(["Hamburg", "Hirtshals"]);
    const sheet = {
      key: "roadtripStations",
      rows: [
        {
          id: stationIds[0],
          roadtripId: `Norwegen [${id}]`,
          order: "1",
          title: "Hamburg",
          lat: "53.55",
          lon: "10",
          night: "pass",
        },
      ],
    };
    const [preview] = await importSheets([sheet], ctx("replace", true));
    expect(preview.deleted).toBe(1);
    expect(await titlesOf(id)).toEqual(["Hamburg", "Hirtshals"]);

    await importSheets([sheet], ctx("replace"));
    expect(await titlesOf(id)).toEqual(["Hamburg"]);
  });

  it("in add mode leaves every existing station alone, and only appends", async () => {
    const { id, stationIds } = await roadtripWith(["Hamburg", "Hirtshals"]);
    const [outcome] = await importSheets(
      [
        {
          key: "roadtripStations",
          rows: [
            {
              id: stationIds[0],
              roadtripId: `Norwegen [${id}]`,
              title: "Umbenannt",
              lat: "1",
              lon: "1",
              night: "pass",
            },
            { roadtripId: `Norwegen [${id}]`, title: "Neu", lat: "60", lon: "7", night: "free" },
          ],
        },
      ],
      ctx("add")
    );
    expect(outcome).toMatchObject({ created: 1, skipped: 1, errors: 0 });
    expect(await titlesOf(id)).toEqual(["Hamburg", "Hirtshals", "Neu"]);
  });

  it("holds a whole roadtrip back when one of its rows is unreadable", async () => {
    const { id, stationIds } = await roadtripWith(["Hamburg", "Hirtshals"]);
    const [outcome] = await importSheets(
      [
        {
          key: "roadtripStations",
          rows: [
            {
              id: stationIds[0],
              roadtripId: `Norwegen [${id}]`,
              title: "Hamburg neu",
              lat: "53.55",
              lon: "10",
              night: "pass",
            },
            {
              id: stationIds[1],
              roadtripId: `Norwegen [${id}]`,
              title: "Hirtshals",
              lat: "nicht",
              lon: "10",
              night: "free",
            },
          ],
        },
      ],
      ctx("replace")
    );
    expect(outcome.errors).toBe(1);
    expect(await titlesOf(id)).toEqual(["Hamburg", "Hirtshals"]);
  });

  it("never links a station to someone else's stay — the night stays, the link does not", async () => {
    const { id } = await roadtripWith(["Hamburg"]);
    const victim = await prisma.user.findUniqueOrThrow({ where: { username: USERS[1] } });
    const lodging = await prisma.lodging.create({
      data: { userId: victim.id, name: "Fremdes Hotel" },
    });
    const stay = await prisma.lodgingStay.create({
      data: { lodgingId: lodging.id, userId: victim.id },
    });
    await importSheets(
      [
        {
          key: "roadtripStations",
          rows: [
            {
              roadtripId: `Norwegen [${id}]`,
              title: "Gast",
              lat: "60",
              lon: "7",
              night: "stay",
              lodgingStayId: `Fremdes Hotel [${stay.id}]`,
            },
          ],
        },
      ],
      ctx()
    );
    const gast = await prisma.tripStop.findFirstOrThrow({ where: { routeId: id, title: "Gast" } });
    expect(gast).toMatchObject({ lodgingStayId: null, overnight: true });
  });
});
