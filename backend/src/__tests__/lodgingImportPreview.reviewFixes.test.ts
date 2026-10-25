import { prisma } from "../db";
import { buildLodgingPreviewRows } from "../services/lodging/lodgingImportPreview";
import { commitLodgingImport } from "../services/lodging/lodgingImportCommit";
import { commitRowSchema, lodgingImportCommitRequestSchema } from "../schemas/lodgingImport";
import { MAX_STAY_SPAN_NIGHTS } from "../schemas/lodging";
import { LODGING_IMPORT_LIMITS } from "../shared/lodgingImportLimits";

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
 * The five findings of the Codex review of the preview-clarity branch
 * (2026-10-25). Each block pins what the server now hands the dialog, or
 * accepts from it, so the dialog cannot promise a commit the server refuses.
 */

/** A commit row that is valid except for what a test overrides. */
function commitRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourceRowIndex: 0,
    action: "create",
    matchedLodgingId: null,
    matchedStayId: null,
    lodging: { name: "Inn" },
    lodgingName: null,
    stay: { checkIn: "2026-11-02", checkOut: "2026-11-04" },
    ...overrides,
  };
}

describe("the commit schema is built from the shared limits the dialog reads", () => {
  const L = LODGING_IMPORT_LIMITS;

  it("caps the name at the shared length, after trimming", () => {
    const at = "x".repeat(L.nameMaxLength);
    expect(commitRowSchema.safeParse(commitRow({ lodging: { name: at } })).success).toBe(true);
    expect(commitRowSchema.safeParse(commitRow({ lodging: { name: `  ${at}  ` } })).success).toBe(
      true
    );
    expect(commitRowSchema.safeParse(commitRow({ lodging: { name: `${at}x` } })).success).toBe(
      false
    );
    expect(commitRowSchema.safeParse(commitRow({ lodgingName: `${at}x` })).success).toBe(false);
  });

  it("caps the city at the shared length", () => {
    const at = "x".repeat(L.cityMaxLength);
    expect(
      commitRowSchema.safeParse(commitRow({ lodging: { name: "Inn", city: at } })).success
    ).toBe(true);
    expect(
      commitRowSchema.safeParse(commitRow({ lodging: { name: "Inn", city: `${at}x` } })).success
    ).toBe(false);
  });

  it("refuses a negative price and accepts the floor", () => {
    const stay = (totalPrice: number) => ({
      checkIn: "2026-11-02",
      checkOut: "2026-11-04",
      totalPrice,
      currency: "EUR",
    });
    expect(commitRowSchema.safeParse(commitRow({ stay: stay(L.minPrice) })).success).toBe(true);
    expect(commitRowSchema.safeParse(commitRow({ stay: stay(L.minPrice - 0.01) })).success).toBe(
      false
    );
  });

  it("caps the span at the shared night count — the same one a hand-entered stay has", () => {
    expect(MAX_STAY_SPAN_NIGHTS).toBe(L.maxStayNights);
    // 2026-01-01 + 3650 nights = 2035-12-30.
    const span = (checkOut: string) => commitRow({ stay: { checkIn: "2026-01-01", checkOut } });
    expect(commitRowSchema.safeParse(span("2035-12-30")).success).toBe(true);
    expect(commitRowSchema.safeParse(span("2035-12-31")).success).toBe(false);
  });
});

describe("lodging import preview — what the dialog needs after the reader's edits", () => {
  let userId: string;
  let parkId: string;
  let parkStayId: string;
  let postBernId: string;
  let postBernStayId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `lodging-preview-review-${Date.now()}`, passwordHash: "x" },
    });
    userId = user.id;
    const park = await prisma.lodging.create({
      data: { userId, name: "Park Hotel", city: "Luzern", lat: 47.05, lon: 8.3 },
    });
    parkId = park.id;
    const parkStay = await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: park.id,
        externalRef: "booking:park-1",
        checkIn: new Date("2026-06-01T00:00:00.000Z"),
        checkOut: new Date("2026-06-03T00:00:00.000Z"),
        totalPrice: 300,
        currency: "CHF",
        roomCategory: "Doppelzimmer",
      },
    });
    parkStayId = parkStay.id;
    const postBern = await prisma.lodging.create({
      data: { userId, name: "Hotel Post", city: "Bern" },
    });
    postBernId = postBern.id;
    await prisma.lodging.create({ data: { userId, name: "Hotel Post", city: "Chur" } });
    const postStay = await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: postBern.id,
        checkIn: new Date("2026-07-10T00:00:00.000Z"),
        checkOut: new Date("2026-07-12T00:00:00.000Z"),
      },
    });
    postBernStayId = postStay.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("returns the stored value of every field an update row can edit, not only the changed ones", async () => {
    const { rows } = await buildLodgingPreviewRows(userId, [
      {
        sourceRowIndex: 0,
        lodging: { name: "Park Hotel", city: "Luzern" },
        // Only the check-out moved; price and currency are not in the mail.
        stay: { checkIn: "2026-06-01", checkOut: "2026-06-04", externalRef: "booking:park-1" },
      },
    ]);
    expect(rows[0].action).toBe("update");
    expect(rows[0].changes.map((c) => c.field)).toEqual(["checkOut"]);
    expect(rows[0].matchedStayValues).toEqual({
      checkIn: "2026-06-01",
      checkOut: "2026-06-03",
      roomCategory: "Doppelzimmer",
      board: null,
      guests: null,
      totalPrice: 300,
      pricePerNight: null,
      currency: "CHF",
      bookingReference: null,
    });
  });

  it("returns no stored values on a row that matched no stay", async () => {
    const { rows } = await buildLodgingPreviewRows(userId, [
      {
        sourceRowIndex: 0,
        lodging: { name: "Brand New Inn", city: "Basel" },
        stay: { checkIn: "2026-06-01", checkOut: "2026-06-04" },
      },
    ]);
    expect(rows[0].matchedStayValues).toBeNull();
  });

  it("gives each candidate house of an ambiguous name its stays, so a choice can be checked", async () => {
    const { rows } = await buildLodgingPreviewRows(userId, [
      {
        sourceRowIndex: 0,
        lodging: { name: "Hotel Post" },
        stay: { checkIn: "2026-07-10", checkOut: "2026-07-13" },
      },
    ]);
    expect(rows[0].flags).toContain("ambiguous_lodging_name");
    const bern = rows[0].lodgingOptions.find((o) => o.id === postBernId);
    const chur = rows[0].lodgingOptions.find((o) => o.id !== postBernId);
    expect(bern?.stays).toEqual([
      {
        id: postBernStayId,
        checkIn: "2026-07-10",
        checkOut: "2026-07-12",
        datePrecision: "DAY",
        nights: 2,
        href: `/lodging/${postBernId}`,
      },
    ]);
    expect(chur?.stays).toEqual([]);
  });

  it("commits a skipped row that carries no fields at all", async () => {
    const request = lodgingImportCommitRequestSchema.parse({
      source: "csv",
      fileName: null,
      rows: [
        {
          sourceRowIndex: 0,
          action: "skip",
          matchedLodgingId: null,
          matchedStayId: null,
          lodging: null,
          lodgingName: null,
          stay: null,
        },
      ],
    });
    const result = await commitLodgingImport(
      userId,
      request.source,
      request.fileName,
      request.rows
    );
    expect(result.skipped).toBe(1);
    expect(result.failed).toEqual([]);
    expect(await prisma.lodgingStay.count({ where: { lodgingId: parkId } })).toBe(1);
    expect(parkStayId).toBeTruthy();
  });
});
