import { prisma } from "../db";
import { commitLodgingImport } from "../services/lodging/lodgingImportCommit";
import type { CommitRowInput } from "../schemas/lodgingImport";

// FX reaches out to Frankfurter — stub it so the suite is offline and
// deterministic. A missing price must still be a normal, non-error outcome.
jest.mock("../services/fx/frankfurter", () => ({
  convertToBase: jest.fn(async (amount: number) => ({
    baseAmount: amount,
    rate: 1,
    rateDate: "2026-01-01",
  })),
  getRate: jest.fn(async () => 1),
}));

// Geocoding must NOT run during a commit.
const geocodeSpy = jest.fn(async () => null);
jest.mock("../services/geo/nominatim", () => ({
  geocodeAddress: () => geocodeSpy(),
  resolveCoordinates: () => geocodeSpy(),
}));

describe("commitLodgingImport", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "lodging-import-commit-test", passwordHash: "x" },
    });
    userId = user.id;
  });

  beforeEach(() => {
    geocodeSpy.mockClear();
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.lodgingChain.deleteMany({ where: { name: "NH Hotels", isUserAdded: true } });
    await prisma.$disconnect();
  });

  it("writes lodgings and stays under one batch and never geocodes", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: {
          name: "Hotel Commit A",
          type: "hotel",
          chainName: "NH Hotels",
          city: "Berlin",
          country: "Deutschland",
          address: "Anhalter Str. 2",
          externalRef: "google:ChIJcommitA",
        },
        stay: {
          checkIn: "2026-04-22",
          checkOut: "2026-04-24",
          totalPrice: 385.07,
          currency: "EUR",
          externalRef: "booking:5967563369",
        },
      },
      { sourceRowIndex: 1, action: "skip", lodging: { name: "Skipped" }, stay: null },
    ];

    const result = await commitLodgingImport(userId, "email", "confirmation.msg", rows);

    expect(result.createdLodgings).toBe(1);
    expect(result.createdStays).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toEqual([]);
    expect(geocodeSpy).not.toHaveBeenCalled();

    const batch = await prisma.lodgingImportBatch.findUnique({ where: { id: result.batchId } });
    expect(batch?.source).toBe("email");
    expect(batch?.fileName).toBe("confirmation.msg");

    const lodging = await prisma.lodging.findFirst({ where: { batchId: result.batchId } });
    expect(lodging?.dataSource).toBe("import");
    expect(lodging?.lat).toBeNull();
    expect(lodging?.chainId).not.toBeNull();

    const stay = await prisma.lodgingStay.findFirst({ where: { batchId: result.batchId } });
    expect(stay?.totalPriceBase).toBeCloseTo(385.07, 2);
    expect(stay?.checkIn.toISOString()).toBe("2026-04-22T00:00:00.000Z");
  });

  it("commits a priceless stay without an FX snapshot — that is not an error", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Hotel No Price" },
        stay: { checkIn: "2026-05-01", checkOut: "2026-05-02", ratingRoom: 4, ratingBreakfast: 3 },
      },
    ];
    const result = await commitLodgingImport(userId, "csv", "stays.csv", rows);
    expect(result.failed).toEqual([]);
    expect(result.createdStays).toBe(1);

    const stay = await prisma.lodgingStay.findFirst({ where: { batchId: result.batchId } });
    expect(stay?.totalPrice).toBeNull();
    expect(stay?.totalPriceBase).toBeNull();
    expect(stay?.fxRate).toBeNull();
    expect(stay?.ratingRoom).toBe(4);
  });

  it("attaches a stay to an existing lodging via matchedLodgingId", async () => {
    const host = await prisma.lodging.create({ data: { userId, name: "Existing Host" } });
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        matchedLodgingId: host.id,
        lodging: null,
        stay: { checkIn: "2026-06-01", checkOut: "2026-06-02" },
      },
    ];
    const result = await commitLodgingImport(userId, "csv", "stays.csv", rows);
    expect(result.createdLodgings).toBe(0);
    expect(result.createdStays).toBe(1);

    const stay = await prisma.lodgingStay.findFirst({ where: { batchId: result.batchId } });
    expect(stay?.lodgingId).toBe(host.id);
  });

  it("treats a duplicate externalRef as skipped, not failed (re-import is a no-op)", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Rerun Hotel", externalRef: "google:ChIJrerun" },
        stay: null,
      },
    ];
    const first = await commitLodgingImport(userId, "csv", "places.csv", rows);
    expect(first.createdLodgings).toBe(1);

    const second = await commitLodgingImport(userId, "csv", "places.csv", rows);
    expect(second.createdLodgings).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.failed).toEqual([]);

    const all = await prisma.lodging.findMany({ where: { userId, name: "Rerun Hotel" } });
    expect(all).toHaveLength(1);
  });

  it("isolates a failing row — the rest of the batch still commits", async () => {
    const rows: CommitRowInput[] = [
      { sourceRowIndex: 0, action: "create", lodging: { name: "Good Row" }, stay: null },
      {
        sourceRowIndex: 1,
        action: "create",
        matchedLodgingId: "00000000-0000-0000-0000-000000000000",
        lodging: null,
        stay: { checkIn: "2026-07-01", checkOut: "2026-07-02" },
      },
      { sourceRowIndex: 2, action: "create", lodging: { name: "Also Good" }, stay: null },
    ];
    const result = await commitLodgingImport(userId, "csv", "mixed.csv", rows);
    expect(result.createdLodgings).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].sourceRowIndex).toBe(1);
  });

  it("rejects a matchedLodgingId that belongs to another user (IDOR) without sinking the batch", async () => {
    const otherUser = await prisma.user.create({
      data: { username: "lodging-import-commit-test-victim", passwordHash: "x" },
    });
    const victimLodging = await prisma.lodging.create({
      data: { userId: otherUser.id, name: "Victim's Hotel" },
    });

    try {
      const rows: CommitRowInput[] = [
        { sourceRowIndex: 0, action: "create", lodging: { name: "Attacker Good Row" }, stay: null },
        {
          sourceRowIndex: 1,
          action: "create",
          matchedLodgingId: victimLodging.id,
          lodging: null,
          stay: { checkIn: "2026-09-01", checkOut: "2026-09-02" },
        },
        { sourceRowIndex: 2, action: "create", lodging: { name: "Attacker Also Good" }, stay: null },
      ];

      const result = await commitLodgingImport(userId, "csv", "idor.csv", rows);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].sourceRowIndex).toBe(1);
      expect(result.createdLodgings).toBe(2);

      const attachedStay = await prisma.lodgingStay.findFirst({
        where: { lodgingId: victimLodging.id },
      });
      expect(attachedStay).toBeNull();
    } finally {
      await prisma.lodgingStay.deleteMany({ where: { lodgingId: victimLodging.id } });
      await prisma.lodging.delete({ where: { id: victimLodging.id } });
      await prisma.user.delete({ where: { id: otherUser.id } });
    }
  });

  it("reuses a lodging created earlier in the same batch for a later row with the same name", async () => {
    const rows: CommitRowInput[] = [
      { sourceRowIndex: 0, action: "create", lodging: { name: "Same Batch Hotel" }, stay: null },
      {
        sourceRowIndex: 1,
        action: "create",
        lodging: { name: "Same Batch Hotel" },
        stay: { checkIn: "2026-08-01", checkOut: "2026-08-02" },
      },
    ];
    const result = await commitLodgingImport(userId, "csv", "both.csv", rows);
    expect(result.createdLodgings).toBe(1);
    expect(result.createdStays).toBe(1);
  });
});
