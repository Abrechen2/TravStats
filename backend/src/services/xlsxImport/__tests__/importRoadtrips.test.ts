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

  it("refuses someone else's roadtrip as if it did not exist", async () => {
    const [outcome] = await importSheets(
      [{ key: "roadtrips", rows: [{ id: victimRoadtripId, name: "Übernommen" }] }],
      ctx()
    );
    expect(outcome.rows[0]).toMatchObject({ action: "error", message: "unknown_id" });
    expect(
      (await prisma.tripRoute.findUniqueOrThrow({ where: { id: victimRoadtripId } })).name
    ).toBe("Fremd");
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

  it("refuses a stay night whose stay is not the caller's, already in the preview", async () => {
    const { id } = await roadtripWith(["Hamburg"]);
    const victim = await prisma.user.findUniqueOrThrow({ where: { username: USERS[1] } });
    const lodging = await prisma.lodging.create({
      data: { userId: victim.id, name: "Fremdes Hotel" },
    });
    const stay = await prisma.lodgingStay.create({
      data: { lodgingId: lodging.id, userId: victim.id },
    });
    const [outcome] = await importSheets(
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
      ctx("merge", true)
    );
    expect(outcome.rows[0]).toMatchObject({ action: "error", message: "unknown_stay" });
  });
});
