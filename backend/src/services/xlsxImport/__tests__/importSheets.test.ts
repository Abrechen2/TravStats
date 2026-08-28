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

  const run = (rows: Record<string, string>[], dryRun = false, key = "places") =>
    importSheets([{ key, rows }], { userId, dryRun });

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
