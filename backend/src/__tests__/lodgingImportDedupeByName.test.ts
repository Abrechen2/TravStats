import { prisma } from "../db";
import { buildLodgingPreviewRows } from "../services/lodging/lodgingImportPreview";
import { hashPassword } from "../utils/password";

/**
 * A saved-places export carries a name and a map link — no city. The dedupe
 * key was name+city, so such a row could never match a hotel the account
 * already had (whose city IS filled in from the booking mail), and every
 * overlapping house was created a second time. Reported after 38 duplicates
 * appeared on a real account (2026-08-14).
 */
describe("import preview: a row without a city still finds the hotel", () => {
  let userId: string;
  let existingId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "dedupetest" } });
    const user = await prisma.user.create({
      data: { username: "dedupetest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    const existing = await prisma.lodging.create({
      data: { userId, name: "Bastion Hotel Zoetermeer", type: "hotel", city: "Zoetermeer" },
    });
    existingId = existing.id;
  });

  afterAll(async () => {
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const nameOnly = (name: string) => ({
    sourceRowIndex: 0,
    lodging: { name, type: "hotel" as const },
    lodgingName: name,
    stay: null,
  });

  it("matches on the name alone and does not propose a second copy", async () => {
    const { rows } = await buildLodgingPreviewRows(userId, [nameOnly("Bastion Hotel Zoetermeer")]);
    expect(rows[0].matchedLodgingId).toBe(existingId);
    expect(rows[0].dedupeHint).toBe("lodging_name_city");
    // Not "create": the house exists, and the row brings nothing new to add.
    expect(rows[0].action).not.toBe("create");
  });

  it("still creates a house the account really does not have", async () => {
    const { rows } = await buildLodgingPreviewRows(userId, [nameOnly("Hotel Noch Nie Gesehen")]);
    expect(rows[0].matchedLodgingId).toBeNull();
    expect(rows[0].action).toBe("create");
  });

  it("keeps two same-named hotels in different towns apart when the row HAS a city", async () => {
    await prisma.lodging.create({
      data: { userId, name: "Hotel Post", type: "hotel", city: "Bregenz" },
    });
    await prisma.lodging.create({
      data: { userId, name: "Hotel Post", type: "hotel", city: "Bozen" },
    });

    const withCity = await buildLodgingPreviewRows(userId, [
      { sourceRowIndex: 0, lodging: { name: "Hotel Post", type: "hotel", city: "Bozen" }, lodgingName: "Hotel Post", stay: null },
    ]);
    expect(withCity.rows[0].matchedLodgingId).not.toBeNull();

    // Without a city the name is ambiguous — that must be said, not guessed.
    const withoutCity = await buildLodgingPreviewRows(userId, [nameOnly("Hotel Post")]);
    expect(withoutCity.rows[0].flags).toContain("ambiguous_lodging_name");
    expect(withoutCity.rows[0].action).toBe("needs_input");
  });
});
