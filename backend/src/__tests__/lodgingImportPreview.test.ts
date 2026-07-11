import { prisma } from "../db";
import {
  buildLodgingPreviewRows,
  normalizeLodgingName,
} from "../services/lodging/lodgingImportPreview";
import type { LodgingImportCandidate } from "../schemas/lodgingImport";

describe("buildLodgingPreviewRows", () => {
  let userId: string;
  let existingId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `lodging-import-preview-test-${Date.now()}`,
        passwordHash: "x",
      },
    });
    userId = user.id;
    const existing = await prisma.lodging.create({
      data: {
        userId,
        name: "NH Ludwigsburg",
        city: "Ludwigsburg",
        externalRef: "google:ChIJexisting",
      },
    });
    existingId = existing.id;
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: existing.id,
        checkIn: new Date("2026-03-30T00:00:00.000Z"),
        checkOut: new Date("2026-03-31T00:00:00.000Z"),
        externalRef: "booking:5087376273",
      },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("normalizes names for matching", () => {
    expect(normalizeLodgingName("NH  Ludwigsburg!")).toBe("nh ludwigsburg");
  });

  it("skips a row whose lodging externalRef already exists (re-import is a no-op)", async () => {
    const candidates: LodgingImportCandidate[] = [
      {
        sourceRowIndex: 0,
        lodging: {
          name: "NH Ludwigsburg",
          externalRef: "google:ChIJexisting",
          city: "Ludwigsburg",
        },
        stay: null,
      },
    ];
    const { rows, summary } = await buildLodgingPreviewRows(userId, candidates);
    expect(rows[0].dedupeHint).toBe("lodging_exact_ref");
    expect(rows[0].action).toBe("skip");
    expect(rows[0].matchedLodgingId).toBe(existingId);
    expect(summary).toEqual({ newRows: 0, alreadyPresent: 1, needsInput: 0 });
  });

  it("skips a row whose stay externalRef already exists", async () => {
    const candidates: LodgingImportCandidate[] = [
      {
        sourceRowIndex: 0,
        lodging: { name: "NH Ludwigsburg", city: "Ludwigsburg" },
        lodgingName: "NH Ludwigsburg",
        stay: {
          checkIn: "2026-03-30",
          checkOut: "2026-03-31",
          externalRef: "booking:5087376273",
        },
      },
    ];
    const { rows, summary } = await buildLodgingPreviewRows(userId, candidates);
    expect(rows[0].dedupeHint).toBe("stay_exact_ref");
    expect(rows[0].action).toBe("skip");
    expect(summary.alreadyPresent).toBe(1);
  });

  it("flags a name+city match for confirmation instead of silently skipping", async () => {
    const candidates: LodgingImportCandidate[] = [
      {
        sourceRowIndex: 0,
        lodging: { name: "nh ludwigsburg", city: "LUDWIGSBURG" },
        stay: null,
      },
    ];
    const { rows, summary } = await buildLodgingPreviewRows(userId, candidates);
    expect(rows[0].dedupeHint).toBe("lodging_name_city");
    expect(rows[0].action).toBe("needs_input");
    expect(rows[0].matchedLodgingId).toBe(existingId);
    expect(summary.needsInput).toBe(1);
  });

  it("resolves a stays-only row against an existing lodging by name", async () => {
    const candidates: LodgingImportCandidate[] = [
      {
        sourceRowIndex: 0,
        lodging: null,
        lodgingName: "NH Ludwigsburg",
        stay: { checkIn: "2027-01-01", checkOut: "2027-01-03", ratingRoom: 4 },
      },
    ];
    const { rows, summary } = await buildLodgingPreviewRows(userId, candidates);
    expect(rows[0].matchedLodgingId).toBe(existingId);
    expect(rows[0].flags).toEqual([]);
    expect(rows[0].action).toBe("create");
    expect(summary.newRows).toBe(1);
  });

  it("flags an unresolvable hotel name rather than creating an orphan", async () => {
    const candidates: LodgingImportCandidate[] = [
      {
        sourceRowIndex: 0,
        lodging: null,
        lodgingName: "Hotel Does Not Exist",
        stay: { checkIn: "2027-01-01", checkOut: "2027-01-03" },
      },
    ];
    const { rows } = await buildLodgingPreviewRows(userId, candidates);
    expect(rows[0].flags).toContain("unresolvable_lodging_name");
    expect(rows[0].action).toBe("needs_input");
    expect(rows[0].matchedLodgingId).toBeNull();
  });

  it("resolves a stays-only row against a lodging created earlier in the SAME payload", async () => {
    const candidates: LodgingImportCandidate[] = [
      { sourceRowIndex: 0, lodging: { name: "Brand New Hotel" }, stay: null },
      {
        sourceRowIndex: 1,
        lodging: null,
        lodgingName: "brand new hotel",
        stay: { checkIn: "2027-05-01", checkOut: "2027-05-02" },
      },
    ];
    const { rows } = await buildLodgingPreviewRows(userId, candidates);
    const stayRow = rows.find((r) => r.sourceRowIndex === 1);
    expect(stayRow?.flags).not.toContain("unresolvable_lodging_name");
    expect(stayRow?.action).toBe("create");
  });

  it("accepts a row without coordinates and only marks it informationally", async () => {
    const candidates: LodgingImportCandidate[] = [
      {
        sourceRowIndex: 0,
        lodging: { name: "No Coords Hotel", city: "Nowhere" },
        stay: null,
      },
    ];
    const { rows, summary } = await buildLodgingPreviewRows(userId, candidates);
    expect(rows[0].flags).toEqual(["missing_coordinates"]);
    expect(rows[0].action).toBe("create");
    expect(summary.newRows).toBe(1);
    expect(summary.needsInput).toBe(0);
  });

  it("flags an inverted date range", async () => {
    const candidates: LodgingImportCandidate[] = [
      {
        sourceRowIndex: 0,
        lodging: { name: "Inverted Hotel", lat: 1, lon: 2 },
        stay: { checkIn: "2027-01-05", checkOut: "2027-01-01" },
      },
    ];
    const { rows } = await buildLodgingPreviewRows(userId, candidates);
    expect(rows[0].flags).toContain("invalid_date_range");
    expect(rows[0].action).toBe("needs_input");
  });

  it("sorts questionable rows to the top, keeping source order within each group", async () => {
    const candidates: LodgingImportCandidate[] = [
      {
        sourceRowIndex: 0,
        lodging: { name: "Fresh A", lat: 1, lon: 2 },
        stay: null,
      },
      {
        sourceRowIndex: 1,
        lodging: null,
        lodgingName: "Nope Hotel",
        stay: { checkIn: "2027-01-01", checkOut: "2027-01-02" },
      },
      {
        sourceRowIndex: 2,
        lodging: { name: "Fresh B", lat: 3, lon: 4 },
        stay: null,
      },
      {
        sourceRowIndex: 3,
        lodging: { name: "NH Ludwigsburg", externalRef: "google:ChIJexisting" },
        stay: null,
      },
    ];
    const { rows, summary } = await buildLodgingPreviewRows(userId, candidates);
    expect(rows.map((r) => r.sourceRowIndex)).toEqual([1, 0, 2, 3]);
    expect(summary).toEqual({ newRows: 2, alreadyPresent: 1, needsInput: 1 });
  });
});
