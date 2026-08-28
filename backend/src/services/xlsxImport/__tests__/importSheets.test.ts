import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { importSheets } from "../importSheets";

/**
 * The property that matters most here is not that the importer works — it is
 * that it cannot be pointed at someone else's data.
 *
 * An id in a spreadsheet is a claim typed by the user. The victim rows below
 * are REAL rows owned by a real second account, not fabricated ids: a foreign
 * key proves a row exists, never that the caller owns it, and a test that
 * invents an id would pass against an importer that looks up by id alone.
 */
describe("spreadsheet import", () => {
  let userId: string;
  let victimId: string;
  let victimPlaceId: string;
  let victimCruiseId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["xlsximp", "xlsxvictim"] } } });
    const user = await prisma.user.create({
      data: { username: "xlsximp", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    const victim = await prisma.user.create({
      data: { username: "xlsxvictim", passwordHash: await hashPassword("password123") },
    });
    victimId = victim.id;

    const victimPlace = await prisma.place.create({
      data: {
        userId: victimId,
        name: "Fremder Ort",
        category: "landmark",
        lat: 1,
        lon: 1,
        visited: true,
      },
    });
    victimPlaceId = victimPlace.id;

    const victimCruise = await prisma.cruise.create({
      data: { userId: victimId, cruiseLine: "Fremde Reederei", status: "flown" },
    });
    victimCruiseId = victimCruise.id;
  });

  beforeEach(async () => {
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.cruise.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.place.deleteMany({ where: { userId: { in: [userId, victimId] } } });
    await prisma.cruise.deleteMany({ where: { userId: { in: [userId, victimId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, victimId] } } });
    await prisma.$disconnect();
  });

  const run = (
    rows: Record<string, string>[],
    dryRun = false,
    key = "places",
    mode: "add" | "merge" | "replace" = "merge",
  ) => importSheets([{ key, rows }], { userId, dryRun, mode });

  // ------------------------------------------------------------- ownership

  it("refuses a row carrying another account's place id", async () => {
    const [result] = await run([
      { id: victimPlaceId, name: "Übernommen", lat: "10", lon: "10" },
    ]);

    expect(result.errors).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.rows[0].message).toBe("unknown_id");

    const victimPlace = await prisma.place.findUnique({ where: { id: victimPlaceId } });
    expect(victimPlace?.name).toBe("Fremder Ort");
    expect(victimPlace?.userId).toBe(victimId);
  });

  it("refuses a row carrying another account's cruise id", async () => {
    const [result] = await run([{ id: victimCruiseId, cruiseLine: "Übernommen" }], false, "cruises");

    expect(result.errors).toBe(1);
    const victimCruise = await prisma.cruise.findUnique({ where: { id: victimCruiseId } });
    expect(victimCruise?.cruiseLine).toBe("Fremde Reederei");
  });

  it("reports a foreign id exactly like an unknown one", async () => {
    // Telling them apart would confirm that the other record exists.
    const [foreign] = await run([{ id: victimPlaceId, name: "A", lat: "1", lon: "1" }]);
    const [absent] = await run([
      { id: "00000000-0000-0000-0000-000000000000", name: "A", lat: "1", lon: "1" },
    ]);
    expect(foreign.rows[0].message).toBe(absent.rows[0].message);
  });

  // ------------------------------------------------------------ create/update

  it("creates a place for a row with no id", async () => {
    const [result] = await run([
      { id: "", name: "Neuer Ort", category: "landmark", lat: "48.1", lon: "11.5", visited: "ja" },
    ]);

    expect(result.created).toBe(1);
    const created = await prisma.place.findFirst({ where: { userId, name: "Neuer Ort" } });
    expect(created?.visited).toBe(true);
    expect(created?.lat).toBeCloseTo(48.1);
  });

  it("updates the caller's own place", async () => {
    const own = await prisma.place.create({
      data: { userId, name: "Alt", category: "landmark", lat: 1, lon: 1, visited: false },
    });

    const [result] = await run([{ id: own.id, name: "Neu" }]);

    expect(result.updated).toBe(1);
    const after = await prisma.place.findUnique({ where: { id: own.id } });
    expect(after?.name).toBe("Neu");
  });

  it("leaves a column the sheet did not carry alone", async () => {
    // An omitted key means "not mentioned", never "erase it".
    const own = await prisma.place.create({
      data: {
        userId,
        name: "Alt",
        category: "landmark",
        lat: 1,
        lon: 1,
        visited: true,
        notes: "Wichtige Notiz",
      },
    });

    await run([{ id: own.id, name: "Neu" }]);

    const after = await prisma.place.findUnique({ where: { id: own.id } });
    expect(after?.notes).toBe("Wichtige Notiz");
  });

  it("derives the ISO code when a country is written", async () => {
    const own = await prisma.place.create({
      data: { userId, name: "Alt", category: "landmark", lat: 1, lon: 1, visited: true },
    });

    await run([{ id: own.id, country: "Japan" }]);

    const after = await prisma.place.findUnique({ where: { id: own.id } });
    expect(after?.isoCountryCode).toBe("JP");
  });

  // ------------------------------------------------------------- dry run

  it("writes nothing on a dry run but reports what it would do", async () => {
    const own = await prisma.place.create({
      data: { userId, name: "Alt", category: "landmark", lat: 1, lon: 1, visited: true },
    });

    const [result] = await run(
      [
        { id: own.id, name: "Geändert" },
        { id: "", name: "Ganz neu", lat: "5", lon: "5" },
      ],
      true,
    );

    expect(result.updated).toBe(1);
    expect(result.created).toBe(1);

    const after = await prisma.place.findUnique({ where: { id: own.id } });
    expect(after?.name).toBe("Alt");
    expect(await prisma.place.count({ where: { userId, name: "Ganz neu" } })).toBe(0);
  });

  // ------------------------------------------------------------- bad input

  it("refuses a row whose coordinates are not numbers", async () => {
    const [result] = await run([{ id: "", name: "Kaputt", lat: "abc", lon: "5" }]);
    expect(result.errors).toBe(1);
    expect(result.rows[0].message).toBe("invalid_coordinates");
  });

  it("refuses a new place with no name rather than creating a blank one", async () => {
    const [result] = await run([{ id: "", name: "", lat: "5", lon: "5" }]);
    expect(result.errors).toBe(1);
  });

  it("refuses a cruise row with no id instead of inventing an empty cruise", async () => {
    const [result] = await run([{ id: "", cruiseLine: "AIDA" }], false, "cruises");
    expect(result.errors).toBe(1);
    expect(result.rows[0].message).toBe("cruise_needs_id");
  });

  it("ignores a sheet key it does not know", async () => {
    const results = await importSheets([{ key: "meine-notizen", rows: [{ a: "b" }] }], {
      userId,
      dryRun: true,
    });
    expect(results).toHaveLength(0);
  });

  it("reads a German decimal comma the way a German Excel writes it", async () => {
    const own = await prisma.cruise.create({
      data: { userId, cruiseLine: "AIDA", status: "flown" },
    });

    await run([{ id: own.id, price: "1.899,50" }], false, "cruises");

    const after = await prisma.cruise.findUnique({ where: { id: own.id } });
    expect(Number(after?.price)).toBeCloseTo(1899.5);
  });
});

/**
 * The three modes, and above all what `replace` is allowed to destroy.
 *
 * The rows it deletes are the ones NOT in the file — which are, by definition,
 * invisible in the sheet the user is looking at while they confirm. That makes
 * the count in the preview the only warning they get, so it has to be right
 * even in a dry run, and the deletion has to stay inside one account.
 */
describe("import modes", () => {
  let modeUserId: string;
  let modeVictimId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["modeuser", "modevictim"] } } });
    const u = await prisma.user.create({
      data: { username: "modeuser", passwordHash: await hashPassword("password123") },
    });
    modeUserId = u.id;
    const v = await prisma.user.create({
      data: { username: "modevictim", passwordHash: await hashPassword("password123") },
    });
    modeVictimId = v.id;
  });

  beforeEach(async () => {
    await prisma.place.deleteMany({ where: { userId: { in: [modeUserId, modeVictimId] } } });
  });

  afterAll(async () => {
    await prisma.place.deleteMany({ where: { userId: { in: [modeUserId, modeVictimId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [modeUserId, modeVictimId] } } });
  });

  const mk = (name: string, owner?: string) =>
    prisma.place.create({
      data: {
        userId: owner ?? modeUserId,
        name,
        category: "landmark",
        lat: 1,
        lon: 1,
        visited: true,
      },
    });

  const runMode = (
    rows: Record<string, string>[],
    mode: "add" | "merge" | "replace",
    dryRun = false,
  ) => importSheets([{ key: "places", rows }], { userId: modeUserId, dryRun, mode });

  it("add: leaves an existing row untouched instead of updating it", async () => {
    const own = await mk("Alt");
    const [r] = await runMode([{ id: own.id, name: "Geaendert" }], "add");

    expect(r.updated).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.rows[0].message).toBe("exists");
    expect((await prisma.place.findUnique({ where: { id: own.id } }))?.name).toBe("Alt");
  });

  it("add: still creates rows that carry no id", async () => {
    const [r] = await runMode([{ id: "", name: "Neu", lat: "5", lon: "5" }], "add");
    expect(r.created).toBe(1);
  });

  it("merge: deletes nothing that the file omits", async () => {
    await mk("Bleibt");
    const [r] = await runMode([{ id: "", name: "Neu", lat: "5", lon: "5" }], "merge");

    expect(r.deleted).toBe(0);
    expect(await prisma.place.count({ where: { userId: modeUserId } })).toBe(2);
  });

  it("replace: deletes exactly the rows the file did not mention", async () => {
    const kept = await mk("Genannt");
    await mk("Nicht genannt");
    await mk("Auch nicht");

    const [r] = await runMode([{ id: kept.id, name: "Genannt" }], "replace");

    expect(r.deleted).toBe(2);
    const left = await prisma.place.findMany({
      where: { userId: modeUserId },
      select: { id: true },
    });
    expect(left.map((p) => p.id)).toEqual([kept.id]);
  });

  it("replace: a dry run reports the deletions and performs none", async () => {
    const kept = await mk("Genannt");
    await mk("A");
    await mk("B");

    const [r] = await runMode([{ id: kept.id, name: "Genannt" }], "replace", true);

    expect(r.deleted).toBe(2);
    expect(await prisma.place.count({ where: { userId: modeUserId } })).toBe(3);
  });

  it("replace: an EMPTY sheet deletes nothing at all", async () => {
    // A file someone cleared by accident, or a tab they never filled, must not
    // read as "delete this whole domain". Emptying has to be asked for row by
    // row, never by handing over a blank.
    await mk("A");
    await mk("B");

    const results = await runMode([], "replace");

    expect(results).toHaveLength(0);
    expect(await prisma.place.count({ where: { userId: modeUserId } })).toBe(2);
  });

  it("replace: never reaches another account's rows", async () => {
    const kept = await mk("Meins");
    await mk("Auch meins");
    await mk("Fremd", modeVictimId);

    await runMode([{ id: kept.id, name: "Meins" }], "replace");

    // One of mine deleted, the stranger's untouched.
    expect(await prisma.place.count({ where: { userId: modeUserId } })).toBe(1);
    expect(await prisma.place.count({ where: { userId: modeVictimId } })).toBe(1);
  });

  it("replace: keeps a row whose line failed, rather than deleting it", async () => {
    // A refused row is not permission to delete the record it named.
    const own = await mk("Alt");
    const [r] = await runMode([{ id: own.id, lat: "keine-zahl", lon: "5" }], "replace");

    expect(r.errors).toBe(1);
    expect(await prisma.place.count({ where: { id: own.id } })).toBe(1);
  });

  it("replace: a row created by the import survives its own run", async () => {
    await mk("Alt");
    const [r] = await runMode([{ id: "", name: "Frisch", lat: "5", lon: "5" }], "replace");

    expect(r.created).toBe(1);
    expect(r.deleted).toBe(1);
    const left = await prisma.place.findMany({
      where: { userId: modeUserId },
      select: { name: true },
    });
    expect(left.map((p) => p.name)).toEqual(["Frisch"]);
  });
});

/**
 * Visits are a child table, so they carry an ownership question their parents
 * do not: a NEW visit names its place through a reference cell, and that place
 * has to belong to the caller. Otherwise a spreadsheet could attach a visit to
 * a stranger's place and read a date back out of it.
 */
describe("place visits", () => {
  let ownerId: string;
  let strangerId: string;
  let ownPlaceId: string;
  let strangerPlaceId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["visitowner", "visitstranger"] } } });
    const o = await prisma.user.create({
      data: { username: "visitowner", passwordHash: await hashPassword("password123") },
    });
    ownerId = o.id;
    const st = await prisma.user.create({
      data: { username: "visitstranger", passwordHash: await hashPassword("password123") },
    });
    strangerId = st.id;

    const own = await prisma.place.create({
      data: { userId: ownerId, name: "McDonald's Eching", category: "restaurant", lat: 48.5, lon: 12.0, visited: true },
    });
    ownPlaceId = own.id;
    const foreign = await prisma.place.create({
      data: { userId: strangerId, name: "Fremder Ort", category: "landmark", lat: 1, lon: 1, visited: true },
    });
    strangerPlaceId = foreign.id;
  });

  beforeEach(async () => {
    await prisma.placeVisit.deleteMany({ where: { userId: { in: [ownerId, strangerId] } } });
  });

  afterAll(async () => {
    await prisma.placeVisit.deleteMany({ where: { userId: { in: [ownerId, strangerId] } } });
    await prisma.place.deleteMany({ where: { userId: { in: [ownerId, strangerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
  });

  const runVisits = (
    rows: Record<string, string>[],
    mode: "add" | "merge" | "replace" = "merge",
    dryRun = false,
  ) => importSheets([{ key: "placeVisits", rows }], { userId: ownerId, dryRun, mode });

  it("creates a visit against the caller's own place", async () => {
    const [r] = await runVisits([
      { id: "", placeId: `McDonald's Eching [${ownPlaceId}]`, visitedAt: "2026-03-11", notes: "Bestellung" },
    ]);

    expect(r.created).toBe(1);
    const visit = await prisma.placeVisit.findFirst({ where: { userId: ownerId } });
    expect(visit?.placeId).toBe(ownPlaceId);
    expect(visit?.notes).toBe("Bestellung");
  });

  it("refuses to hang a visit on someone else's place", async () => {
    const [r] = await runVisits([
      { id: "", placeId: `Fremder Ort [${strangerPlaceId}]`, visitedAt: "2026-03-11" },
    ]);

    expect(r.errors).toBe(1);
    expect(r.rows[0].message).toBe("unknown_place");
    expect(await prisma.placeVisit.count({ where: { placeId: strangerPlaceId } })).toBe(0);
  });

  it("refuses a new visit that names no place at all", async () => {
    const [r] = await runVisits([{ id: "", visitedAt: "2026-03-11" }]);
    expect(r.errors).toBe(1);
    expect(r.rows[0].message).toBe("visit_needs_place");
  });

  it("reads several orders on the same day as several visits", async () => {
    // The McDonald's case: seventeen orders across fifteen restaurants, more
    // than one on some days.
    const ref = `McDonald's Eching [${ownPlaceId}]`;
    const [r] = await runVisits([
      { id: "", placeId: ref, visitedAt: "2026-03-11", notes: "Mittag" },
      { id: "", placeId: ref, visitedAt: "2026-03-11", notes: "Abend" },
    ]);

    expect(r.created).toBe(2);
    expect(await prisma.placeVisit.count({ where: { placeId: ownPlaceId } })).toBe(2);
  });

  it("refuses a rating outside 1–5 instead of storing it", async () => {
    const [r] = await runVisits([
      { id: "", placeId: `x [${ownPlaceId}]`, visitedAt: "2026-03-11", rating: "9" },
    ]);
    expect(r.errors).toBe(1);
    expect(r.rows[0].message).toBe("invalid_rating");
  });

  it("updates an existing visit by id", async () => {
    const visit = await prisma.placeVisit.create({
      data: { userId: ownerId, placeId: ownPlaceId, notes: "Alt" },
    });

    const [r] = await runVisits([{ id: visit.id, notes: "Neu" }]);

    expect(r.updated).toBe(1);
    expect((await prisma.placeVisit.findUnique({ where: { id: visit.id } }))?.notes).toBe("Neu");
  });

  it("refuses a visit id belonging to another account", async () => {
    const foreign = await prisma.placeVisit.create({
      data: { userId: strangerId, placeId: strangerPlaceId, notes: "Fremd" },
    });

    const [r] = await runVisits([{ id: foreign.id, notes: "Uebernommen" }]);

    expect(r.errors).toBe(1);
    expect((await prisma.placeVisit.findUnique({ where: { id: foreign.id } }))?.notes).toBe("Fremd");
  });

  it("writes nothing on a dry run", async () => {
    const [r] = await runVisits(
      [{ id: "", placeId: `x [${ownPlaceId}]`, visitedAt: "2026-03-11" }],
      "merge",
      true,
    );
    expect(r.created).toBe(1);
    expect(await prisma.placeVisit.count({ where: { userId: ownerId } })).toBe(0);
  });
});
