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

  // forgejo#84 — five pairs on the owner's account became ten houses because
  // a booking mail and a saved-places export write one building differently,
  // and neither carries a pin at preview time for the coordinate rule.
  it("proposes the stored 'Hotel Restaurant Meteora' for an incoming 'Hotel Meteora' in the same town", async () => {
    const stored = await prisma.lodging.create({
      data: { userId, name: "Hotel Restaurant Meteora", city: "Tübingen" },
    });
    try {
      const { rows } = await buildLodgingPreviewRows(userId, [
        {
          sourceRowIndex: 0,
          lodging: { name: "Hotel Meteora", city: "Tübingen", lat: null, lon: null },
          stay: null,
        },
      ]);
      expect(rows[0].matchedLodgingId).toBe(stored.id);
      expect(rows[0].dedupeHint).toBe("lodging_name_similar");
      expect(rows[0].action).toBe("needs_input");
    } finally {
      await prisma.lodging.delete({ where: { id: stored.id } });
    }
  });

  it("proposes 'Emirates Palace Mandarin Oriental' for a saved-places row that carries no city at all", async () => {
    const stored = await prisma.lodging.create({
      data: { userId, name: "Emirates Palace Mandarin Oriental", city: "Abu Dhabi" },
    });
    try {
      const { rows } = await buildLodgingPreviewRows(userId, [
        {
          sourceRowIndex: 0,
          lodging: { name: "Emirates Palace, Abu Dhabi", externalRef: "gmaps:123", lat: null, lon: null },
          stay: null,
        },
      ]);
      expect(rows[0].matchedLodgingId).toBe(stored.id);
      expect(rows[0].dedupeHint).toBe("lodging_name_similar");
    } finally {
      await prisma.lodging.delete({ where: { id: stored.id } });
    }
  });

  it("keeps two 'Hotel Rose' in different towns apart — one shared word is not identity", async () => {
    const stored = await prisma.lodging.create({
      data: { userId, name: "Hotel Rose", city: "Portland" },
    });
    try {
      const { rows } = await buildLodgingPreviewRows(userId, [
        {
          sourceRowIndex: 0,
          lodging: { name: "Hotel Rose", city: "Bietigheim-Bissingen", lat: null, lon: null },
          stay: null,
        },
      ]);
      expect(rows[0].matchedLodgingId).toBeNull();
      expect(rows[0].action).toBe("create");
    } finally {
      await prisma.lodging.delete({ where: { id: stored.id } });
    }
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

  it("lets a proven stay externalRef hit win over an earlier name+city guess for a DIFFERENT lodging", async () => {
    // Lodging B is unrelated to the name/city-matched "NH Ludwigsburg" (lodging A,
    // seeded in beforeAll) but owns the stay whose externalRef the candidate carries.
    // A proven exact-ref match must overrule the heuristic guess: matchedLodgingId
    // must end up pointing at B, not the earlier name+city guess against A.
    const lodgingB = await prisma.lodging.create({
      data: { userId, name: "Other Hotel", city: "Berlin" },
    });
    const stayB = await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodgingB.id,
        checkIn: new Date("2027-02-10T00:00:00.000Z"),
        checkOut: new Date("2027-02-12T00:00:00.000Z"),
        externalRef: "booking:cross-lodging-ref",
      },
    });

    const candidates: LodgingImportCandidate[] = [
      {
        sourceRowIndex: 0,
        // Matches lodging A (existingId) by name+city — a guess.
        lodging: { name: "nh ludwigsburg", city: "LUDWIGSBURG" },
        stay: {
          checkIn: "2027-02-10",
          checkOut: "2027-02-12",
          // But this stay externalRef is proven to belong to lodging B.
          externalRef: "booking:cross-lodging-ref",
        },
      },
    ];
    const { rows } = await buildLodgingPreviewRows(userId, candidates);
    expect(rows[0].matchedLodgingId).toBe(lodgingB.id);
    expect(rows[0].matchedLodgingId).not.toBe(existingId);
    expect(rows[0].matchedStayId).toBe(stayB.id);
    expect(rows[0].dedupeHint).toBe("stay_exact_ref");
    expect(rows[0].action).toBe("skip");
  });

  it("scopes dedup matching to the requesting user — never matches another user's data", async () => {
    const otherUser = await prisma.user.create({
      data: {
        username: `lodging-import-preview-test-other-${Date.now()}`,
        passwordHash: "x",
      },
    });
    const otherLodging = await prisma.lodging.create({
      data: {
        userId: otherUser.id,
        name: "Shared Name Hotel",
        city: "Shared City",
        externalRef: "google:shared-ref",
      },
    });
    await prisma.lodgingStay.create({
      data: {
        userId: otherUser.id,
        lodgingId: otherLodging.id,
        checkIn: new Date("2027-03-01T00:00:00.000Z"),
        checkOut: new Date("2027-03-02T00:00:00.000Z"),
        externalRef: "booking:shared-stay-ref",
      },
    });

    try {
      const candidates: LodgingImportCandidate[] = [
        {
          sourceRowIndex: 0,
          lodging: {
            name: "Shared Name Hotel",
            city: "Shared City",
            externalRef: "google:shared-ref",
          },
          stay: {
            checkIn: "2027-03-01",
            checkOut: "2027-03-02",
            externalRef: "booking:shared-stay-ref",
          },
        },
      ];
      // Run the preview for user 1 (`userId`), whose data has none of this —
      // it all belongs to `otherUser`. Nothing should dedupe.
      const { rows, summary } = await buildLodgingPreviewRows(
        userId,
        candidates,
      );
      expect(rows[0].matchedLodgingId).toBeNull();
      expect(rows[0].matchedStayId).toBeNull();
      expect(rows[0].dedupeHint).toBe("none");
      expect(rows[0].action).toBe("create");
      expect(summary).toEqual({ newRows: 1, alreadyPresent: 0, needsInput: 0 });
    } finally {
      await prisma.user.delete({ where: { id: otherUser.id } });
    }
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
