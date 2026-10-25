import { prisma } from "../db";
import { buildLodgingPreviewRows } from "../services/lodging/lodgingImportPreview";
import { commitLodgingImport } from "../services/lodging/lodgingImportCommit";
import { lodgingImportCommitRequestSchema } from "../schemas/lodgingImport";

// FX reaches out over the network — the commit below carries no price, but
// the resolver is stubbed anyway so nothing in this file can go online.
jest.mock("../services/fx/resolver", () => ({
  convertToBase: jest.fn(async (amount: number) => ({
    baseAmount: amount,
    rate: 1,
    rateDate: "2026-01-01",
    source: "ecb" as const,
  })),
  resolveRate: jest.fn(async () => ({ rate: 1, source: "ecb" as const })),
}));
jest.mock("../services/geo/nominatim", () => ({
  geocodeAddress: async () => null,
  resolveCoordinates: async () => null,
}));

/**
 * The preview the owner found misleading (2026-10-25): a Mercure booking
 * matched to a stored house, shown with the IMPORT's city, a green "Name +
 * Ort" chip whatever the evidence, and no way to tell which of several
 * same-named houses an ambiguous row meant. These pin what the server now
 * says, so the client can say it truthfully.
 */
describe("lodging import preview — what a match rests on", () => {
  let userId: string;
  let mercureId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `lodging-preview-clarity-${Date.now()}`, passwordHash: "x" },
    });
    userId = user.id;
    const mercure = await prisma.lodging.create({
      data: { userId, name: "Mercure Zürich City", city: "Zürich", lat: 47.37, lon: 8.54 },
    });
    mercureId = mercure.id;
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: mercure.id,
        checkIn: new Date("2026-05-01T00:00:00.000Z"),
        checkOut: new Date("2026-05-03T00:00:00.000Z"),
      },
    });
    // Two houses of one name in two towns — a city-less row cannot tell them apart.
    await prisma.lodging.create({ data: { userId, name: "Hotel Post", city: "Bern" } });
    await prisma.lodging.create({ data: { userId, name: "Hotel Post", city: "Chur" } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("names the STORED city of the matched house, not the import's spelling", async () => {
    const { rows } = await buildLodgingPreviewRows(userId, [
      {
        sourceRowIndex: 0,
        lodging: { name: "Mercure Zürich City", city: "zürich" },
        stay: { checkIn: "2026-11-02", checkOut: "2026-11-04" },
      },
    ]);
    expect(rows[0].matchedLodgingId).toBe(mercureId);
    expect(rows[0].matchedLodgingName).toBe("Mercure Zürich City");
    expect(rows[0].matchedLodgingCity).toBe("Zürich");
    expect(rows[0].lodging?.city).toBe("zürich");
  });

  it("says name AND city when both agree", async () => {
    const { rows } = await buildLodgingPreviewRows(userId, [
      {
        sourceRowIndex: 0,
        lodging: { name: "Mercure Zürich City", city: "Zürich" },
        stay: { checkIn: "2026-11-02", checkOut: "2026-11-04" },
      },
    ]);
    expect(rows[0].dedupeHint).toBe("lodging_name_city");
    expect(rows[0].lodgingDedupeHint).toBe("lodging_name_city");
    expect(rows[0].action).toBe("needs_input");
  });

  it("says name ONLY when the import carries no city, and still asks", async () => {
    const { rows } = await buildLodgingPreviewRows(userId, [
      {
        sourceRowIndex: 0,
        lodging: { name: "Mercure Zürich City" },
        stay: { checkIn: "2026-11-02", checkOut: "2026-11-04" },
      },
    ]);
    expect(rows[0].matchedLodgingId).toBe(mercureId);
    expect(rows[0].dedupeHint).toBe("lodging_name_only");
    expect(rows[0].lodgingDedupeHint).toBe("lodging_name_only");
    expect(rows[0].matchIsGuess).toBe(true);
    expect(rows[0].action).toBe("needs_input");
  });

  it("marks a stays-only name join as name-only evidence without changing its action", async () => {
    const { rows } = await buildLodgingPreviewRows(userId, [
      {
        sourceRowIndex: 0,
        lodging: null,
        lodgingName: "Mercure Zürich City",
        stay: { checkIn: "2026-11-02", checkOut: "2026-11-04" },
      },
    ]);
    expect(rows[0].dedupeHint).toBe("none");
    expect(rows[0].lodgingDedupeHint).toBe("lodging_name_only");
    expect(rows[0].action).toBe("create");
  });

  it("offers the candidate houses of an ambiguous name, each with its stored city", async () => {
    const { rows } = await buildLodgingPreviewRows(userId, [
      {
        sourceRowIndex: 0,
        lodging: { name: "Hotel Post" },
        stay: { checkIn: "2026-11-02", checkOut: "2026-11-04" },
      },
    ]);
    expect(rows[0].matchedLodgingId).toBeNull();
    expect(rows[0].flags).toContain("ambiguous_lodging_name");
    expect(rows[0].lodgingOptions.map((o) => o.city).sort()).toEqual(["Bern", "Chur"]);
    expect(rows[0].lodgingOptions.every((o) => o.name === "Hotel Post")).toBe(true);
  });

  it("offers candidates for an ambiguous stays-only join too", async () => {
    const { rows } = await buildLodgingPreviewRows(userId, [
      {
        sourceRowIndex: 0,
        lodging: null,
        lodgingName: "Hotel Post",
        stay: { checkIn: "2026-11-02", checkOut: "2026-11-04" },
      },
    ]);
    expect(rows[0].flags).toEqual(["ambiguous_lodging_name"]);
    expect(rows[0].lodgingOptions).toHaveLength(2);
  });

  it("offers no candidates on a row that is matched or new", async () => {
    const { rows } = await buildLodgingPreviewRows(userId, [
      {
        sourceRowIndex: 0,
        lodging: { name: "Mercure Zürich City", city: "Zürich" },
        stay: null,
      },
      { sourceRowIndex: 1, lodging: { name: "Brand New Inn", city: "Basel" }, stay: null },
    ]);
    for (const row of rows) expect(row.lodgingOptions).toEqual([]);
  });

  it("keeps the house evidence beside a same-check-in stay match", async () => {
    const { rows } = await buildLodgingPreviewRows(userId, [
      {
        sourceRowIndex: 0,
        lodging: { name: "Mercure Zürich City", city: "Zürich" },
        // Same check-in, different check-out: a POSSIBLE duplicate, not a proven one.
        stay: { checkIn: "2026-05-01", checkOut: "2026-05-05" },
      },
    ]);
    expect(rows[0].dedupeHint).toBe("stay_same_dates");
    expect(rows[0].lodgingDedupeHint).toBe("lodging_name_city");
    expect(rows[0].matchedStay?.checkOut).toBe("2026-05-03");
    expect(rows[0].stay?.checkOut).toBe("2026-05-05");
  });

  /**
   * The screenshot: a guessed house, the user picks "Aufenthalt hinzufügen"
   * (action create, the preview's hotel id kept). Exactly one stay is
   * written, against the stored house, and no hotel is created or renamed.
   */
  it("adds a stay to the guessed house and creates no hotel", async () => {
    const { rows } = await buildLodgingPreviewRows(userId, [
      {
        sourceRowIndex: 0,
        lodging: { name: "Mercure Zürich City", city: "Zürich" },
        stay: { checkIn: "2026-12-10", checkOut: "2026-12-12" },
      },
    ]);
    expect(rows[0].matchedLodgingId).toBe(mercureId);
    expect(rows[0].action).toBe("needs_input");

    const before = await prisma.lodging.count({ where: { userId } });
    const request = lodgingImportCommitRequestSchema.parse({
      source: "email",
      fileName: null,
      rows: [
        {
          sourceRowIndex: 0,
          action: "create",
          matchedLodgingId: rows[0].matchedLodgingId,
          matchedStayId: null,
          lodging: rows[0].lodging,
          lodgingName: null,
          stay: rows[0].stay,
        },
      ],
    });
    const result = await commitLodgingImport(
      userId,
      request.source,
      request.fileName,
      request.rows
    );
    expect(result.createdLodgings).toBe(0);
    expect(result.createdStays).toBe(1);
    expect(await prisma.lodging.count({ where: { userId } })).toBe(before);
    const house = await prisma.lodging.findUniqueOrThrow({ where: { id: mercureId } });
    expect(house.city).toBe("Zürich");
    expect(
      await prisma.lodgingStay.count({
        where: { lodgingId: mercureId, checkIn: new Date("2026-12-10T00:00:00.000Z") },
      })
    ).toBe(1);
  });
});
