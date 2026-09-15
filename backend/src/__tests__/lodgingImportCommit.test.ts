import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { commitLodgingImport } from "../services/lodging/lodgingImportCommit";
import {
  lodgingImportCommitRequestSchema,
  lodgingImportPreviewRequestSchema,
  type CommitRowInput,
} from "../schemas/lodgingImport";

// FX reaches out over the network — stub the provider CHAIN so the suite is
// offline and deterministic. A missing price must still be a normal outcome.
jest.mock("../services/fx/resolver", () => ({
  convertToBase: jest.fn(async (amount: number) => ({
    baseAmount: amount,
    rate: 1,
    rateDate: "2026-01-01",
    source: "ecb" as const,
  })),
  resolveRate: jest.fn(async () => ({ rate: 1, source: "ecb" as const })),
}));

const fxMock = jest.requireMock("../services/fx/resolver") as {
  convertToBase: jest.Mock;
};

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
    fxMock.convertToBase.mockClear();
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.lodgingChain.deleteMany({
      where: { name: "NH Hotels", isUserAdded: true },
    });
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
      {
        sourceRowIndex: 1,
        action: "skip",
        lodging: { name: "Skipped" },
        stay: null,
      },
    ];

    const result = await commitLodgingImport(
      userId,
      "email",
      "confirmation.msg",
      rows,
    );

    expect(result.createdLodgings).toBe(1);
    expect(result.createdStays).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toEqual([]);
    expect(geocodeSpy).not.toHaveBeenCalled();

    const batch = await prisma.importBatch.findUnique({
      where: { id: result.batchId },
    });
    expect(batch?.source).toBe("email");
    expect(batch?.fileName).toBe("confirmation.msg");

    const lodging = await prisma.lodging.findFirst({
      where: { batchId: result.batchId },
    });
    expect(lodging?.dataSource).toBe("import");
    expect(lodging?.lat).toBeNull();
    expect(lodging?.chainId).not.toBeNull();

    const stay = await prisma.lodgingStay.findFirst({
      where: { batchId: result.batchId },
    });
    expect(stay?.totalPriceBase).toBeCloseTo(385.07, 2);
    expect(stay?.checkIn.toISOString()).toBe("2026-04-22T00:00:00.000Z");
  });

  it("commits a priceless stay without an FX snapshot — that is not an error", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Hotel No Price" },
        stay: {
          checkIn: "2026-05-01",
          checkOut: "2026-05-02",
          ratingRoom: 4,
          ratingBreakfast: 3,
        },
      },
    ];
    const result = await commitLodgingImport(userId, "csv", "stays.csv", rows);
    expect(result.failed).toEqual([]);
    expect(result.createdStays).toBe(1);

    const stay = await prisma.lodgingStay.findFirst({
      where: { batchId: result.batchId },
    });
    expect(stay?.totalPrice).toBeNull();
    expect(stay?.totalPriceBase).toBeNull();
    expect(stay?.fxRate).toBeNull();
    expect(stay?.ratingRoom).toBe(4);
  });

  it("imports a priced row whose currency the sheet never carried WITHOUT the price", async () => {
    // A number with no unit is not a price. The column default would make the
    // row claim EUR, which is how an 11,662 AED booking becomes €11,662 and
    // inflates every total it touches. The stay is worth keeping; the bare
    // number is not, and no FX lookup is spent on a guess.
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Hotel Unit Unknown" },
        stay: {
          checkIn: "2026-06-01",
          checkOut: "2026-06-03",
          totalPrice: 11662,
        },
      },
    ];
    const result = await commitLodgingImport(userId, "csv", "stays.csv", rows);
    expect(result.failed).toEqual([]);
    expect(result.createdStays).toBe(1);
    expect(fxMock.convertToBase).not.toHaveBeenCalled();

    const stay = await prisma.lodgingStay.findFirst({
      where: { batchId: result.batchId },
    });
    expect(stay?.totalPrice).toBeNull();
    expect(stay?.totalPriceBase).toBeNull();
    expect(stay?.fxRate).toBeNull();
  });

  it("attaches a stay to an existing lodging via matchedLodgingId", async () => {
    const host = await prisma.lodging.create({
      data: { userId, name: "Existing Host" },
    });
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

    const stay = await prisma.lodgingStay.findFirst({
      where: { batchId: result.batchId },
    });
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

    const all = await prisma.lodging.findMany({
      where: { userId, name: "Rerun Hotel" },
    });
    expect(all).toHaveLength(1);
  });

  it("isolates a failing row — the rest of the batch still commits", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Good Row" },
        stay: null,
      },
      {
        sourceRowIndex: 1,
        action: "create",
        matchedLodgingId: "00000000-0000-0000-0000-000000000000",
        lodging: null,
        stay: { checkIn: "2026-07-01", checkOut: "2026-07-02" },
      },
      {
        sourceRowIndex: 2,
        action: "create",
        lodging: { name: "Also Good" },
        stay: null,
      },
    ];
    const result = await commitLodgingImport(userId, "csv", "mixed.csv", rows);
    expect(result.createdLodgings).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].sourceRowIndex).toBe(1);
  });

  it("rejects a matchedLodgingId that belongs to another user (IDOR) without sinking the batch", async () => {
    const otherUser = await prisma.user.create({
      data: {
        username: "lodging-import-commit-test-victim",
        passwordHash: "x",
      },
    });
    const victimLodging = await prisma.lodging.create({
      data: { userId: otherUser.id, name: "Victim's Hotel" },
    });

    try {
      const rows: CommitRowInput[] = [
        {
          sourceRowIndex: 0,
          action: "create",
          lodging: { name: "Attacker Good Row" },
          stay: null,
        },
        {
          sourceRowIndex: 1,
          action: "create",
          matchedLodgingId: victimLodging.id,
          lodging: null,
          stay: { checkIn: "2026-09-01", checkOut: "2026-09-02" },
        },
        {
          sourceRowIndex: 2,
          action: "create",
          lodging: { name: "Attacker Also Good" },
          stay: null,
        },
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
      await prisma.lodgingStay.deleteMany({
        where: { lodgingId: victimLodging.id },
      });
      await prisma.lodging.delete({ where: { id: victimLodging.id } });
      await prisma.user.delete({ where: { id: otherUser.id } });
    }
  });

  // ---- Finding 5: preview→commit contract gap on same-payload joins ----
  // `lodgingImportPreview.ts`'s `payloadNames` branch lets a stays-only
  // candidate resolve cleanly against a lodging ANOTHER candidate in the
  // same payload will create, without ever setting `matchedLodgingId` (the
  // lodging doesn't exist yet at preview time) or `lodging` (there's no
  // lodging data on the stays-only row itself). The row's only remaining
  // handle is `lodgingName` — the commit service must resolve it against
  // `createdByName` the same way an edited/matched row would.

  it("resolves a stays-only row's lodgingName against a lodging another row in the SAME commit creates", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Payload Join Hotel" },
        stay: null,
      },
      {
        sourceRowIndex: 1,
        action: "create",
        lodging: null,
        lodgingName: "Payload Join Hotel",
        stay: { checkIn: "2026-10-01", checkOut: "2026-10-02" },
      },
    ];

    const result = await commitLodgingImport(
      userId,
      "csv",
      "payload-join.csv",
      rows,
    );

    expect(result.failed).toEqual([]);
    expect(result.createdLodgings).toBe(1);
    expect(result.createdStays).toBe(1);

    const lodging = await prisma.lodging.findFirst({
      where: { batchId: result.batchId },
    });
    const stay = await prisma.lodgingStay.findFirst({
      where: { batchId: result.batchId },
    });
    expect(stay?.lodgingId).toBe(lodging?.id);
  });

  it("fails a stays-only row with missing_lodging_reference when its lodgingName resolves against nothing", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: null,
        lodgingName: "Nobody Ever Creates This Hotel",
        stay: { checkIn: "2026-10-10", checkOut: "2026-10-11" },
      },
    ];

    const result = await commitLodgingImport(
      userId,
      "csv",
      "payload-join-miss.csv",
      rows,
    );

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].code).toBe("missing_lodging_reference");
    expect(result.createdStays).toBe(0);
  });

  it("reuses a lodging created earlier in the same batch for a later row with the same name", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Same Batch Hotel" },
        stay: null,
      },
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

  // AUD-055: the preview resolves a stays-only row's name against EVERY
  // candidate; the commit resolved it only against rows already written, so
  // the stay row coming first lost its stay with `missing_lodging_reference`.
  it("resolves a stays-only row that comes BEFORE the row creating its hotel (AUD-055)", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: null,
        lodgingName: "Order Independent Hotel",
        stay: { checkIn: "2026-11-01", checkOut: "2026-11-02" },
      },
      {
        sourceRowIndex: 1,
        action: "create",
        lodging: { name: "Order Independent Hotel" },
        stay: null,
      },
    ];
    const result = await commitLodgingImport(userId, "csv", "reversed.csv", rows);
    expect(result.failed).toEqual([]);
    expect(result.createdLodgings).toBe(1);
    expect(result.createdStays).toBe(1);
  });

  // AUD-044: the name alone was the whole identity inside one run.
  it("keeps two same-named hotels in different cities with different refs apart (AUD-044)", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Hotel Central AUD044", city: "Berlin", externalRef: "google:aud044-berlin" },
        stay: { checkIn: "2026-12-01", checkOut: "2026-12-02" },
      },
      {
        sourceRowIndex: 1,
        action: "create",
        lodging: { name: "Hotel Central AUD044", city: "Paris", externalRef: "google:aud044-paris" },
        stay: { checkIn: "2026-12-05", checkOut: "2026-12-06" },
      },
    ];
    const result = await commitLodgingImport(userId, "csv", "two-cities.csv", rows);
    expect(result.failed).toEqual([]);
    expect(result.createdLodgings).toBe(2);
    expect(result.createdStays).toBe(2);

    const houses = await prisma.lodging.findMany({
      where: { batchId: result.batchId },
      orderBy: { city: "asc" },
      select: { city: true, externalRef: true, _count: { select: { stays: true } } },
    });
    expect(houses).toEqual([
      { city: "Berlin", externalRef: "google:aud044-berlin", _count: { stays: 1 } },
      { city: "Paris", externalRef: "google:aud044-paris", _count: { stays: 1 } },
    ]);
  });

  it("still folds a same-named row WITHOUT a city into the house created before it", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Hotel Fold AUD044", city: "Wien" },
        stay: null,
      },
      {
        sourceRowIndex: 1,
        action: "create",
        lodging: { name: "Hotel Fold AUD044" },
        stay: { checkIn: "2026-12-10", checkOut: "2026-12-11" },
      },
    ];
    const result = await commitLodgingImport(userId, "csv", "fold.csv", rows);
    expect(result.createdLodgings).toBe(1);
    expect(result.createdStays).toBe(1);
  });

  // AUD-048: the guard read the total only, so a per-night rate with no
  // currency was stored against the column's EUR default.
  it("drops a per-night rate whose currency the sheet never carried (AUD-048)", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Hotel Nightly No Currency" },
        stay: { checkIn: "2026-05-01", checkOut: "2026-05-04", pricePerNight: 50 },
      },
    ];
    const result = await commitLodgingImport(userId, "csv", "nightly.csv", rows);
    expect(result.failed).toEqual([]);
    const stay = await prisma.lodgingStay.findFirstOrThrow({ where: { batchId: result.batchId } });
    expect(stay.pricePerNight).toBeNull();
    expect(stay.totalPrice).toBeNull();
  });

  it("keeps a per-night rate that DOES carry its currency", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Hotel Nightly With Currency" },
        stay: { checkIn: "2026-05-01", checkOut: "2026-05-04", pricePerNight: 50, currency: "EUR" },
      },
    ];
    const result = await commitLodgingImport(userId, "csv", "nightly-eur.csv", rows);
    const stay = await prisma.lodgingStay.findFirstOrThrow({ where: { batchId: result.batchId } });
    expect(stay.pricePerNight).toBe(50);
    expect(stay.currency).toBe("EUR");
  });

  // AUD-043: the (currency, day) cache held the first row's CONVERTED AMOUNT,
  // and every later row of the same pair stored it as its own base amount.
  it("converts each row's OWN price through the shared rate (AUD-043)", async () => {
    fxMock.convertToBase.mockImplementationOnce(async (amount: number) => ({
      baseAmount: amount * 0.5,
      rate: 0.5,
      rateDate: "2026-07-01",
      source: "ecb" as const,
    }));
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Hotel FX Row One" },
        stay: { checkIn: "2026-07-01", checkOut: "2026-07-02", totalPrice: 100, currency: "USD" },
      },
      {
        sourceRowIndex: 1,
        action: "create",
        lodging: { name: "Hotel FX Row Two" },
        stay: { checkIn: "2026-07-01", checkOut: "2026-07-03", totalPrice: 500, currency: "USD" },
      },
    ];
    const result = await commitLodgingImport(userId, "csv", "fx-rows.csv", rows);
    expect(result.failed).toEqual([]);
    // One lookup for the pair, as before — the sharing is the point.
    expect(fxMock.convertToBase).toHaveBeenCalledTimes(1);

    const stays = await prisma.lodgingStay.findMany({
      where: { batchId: result.batchId },
      orderBy: { totalPrice: "asc" },
      select: { totalPrice: true, totalPriceBase: true, fxRate: true },
    });
    expect(stays).toEqual([
      { totalPrice: 100, totalPriceBase: 50, fxRate: 0.5 },
      { totalPrice: 500, totalPriceBase: 250, fxRate: 0.5 },
    ]);
  });

  // ---- Finding 2: FX fan-out (POST /commit was fanning out up to
  // MAX_LODGING_IMPORT_ROWS sequential outbound FX calls inside the request) ----

  it("resolves FX exactly once for N rows sharing the same (currency, check-in day) pair", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "FX Dedupe Hotel A" },
        stay: {
          checkIn: "2026-11-01",
          checkOut: "2026-11-02",
          totalPrice: 100,
          currency: "EUR",
        },
      },
      {
        sourceRowIndex: 1,
        action: "create",
        lodging: { name: "FX Dedupe Hotel B" },
        stay: {
          checkIn: "2026-11-01",
          checkOut: "2026-11-02",
          totalPrice: 250,
          currency: "EUR",
        },
      },
      {
        sourceRowIndex: 2,
        action: "create",
        lodging: { name: "FX Dedupe Hotel C" },
        stay: {
          checkIn: "2026-11-01",
          checkOut: "2026-11-02",
          totalPrice: 75,
          currency: "EUR",
        },
      },
    ];

    const result = await commitLodgingImport(
      userId,
      "csv",
      "fx-dedupe.csv",
      rows,
    );

    expect(result.failed).toEqual([]);
    expect(result.createdStays).toBe(3);
    // Three rows, same (currency, day) pair — exactly ONE outbound FX call,
    // not three.
    expect(fxMock.convertToBase).toHaveBeenCalledTimes(1);

    const stays = await prisma.lodgingStay.findMany({
      where: { batchId: result.batchId },
    });
    expect(stays).toHaveLength(3);
    for (const stay of stays) {
      expect(stay.totalPriceBase).not.toBeNull();
      expect(stay.fxRate).not.toBeNull();
    }
  });

  it("resolves FX once per DISTINCT (currency, day) pair — different days each get their own lookup", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "FX Multi-day Hotel A" },
        stay: {
          checkIn: "2026-11-05",
          checkOut: "2026-11-06",
          totalPrice: 100,
          currency: "EUR",
        },
      },
      {
        sourceRowIndex: 1,
        action: "create",
        lodging: { name: "FX Multi-day Hotel B" },
        stay: {
          checkIn: "2026-11-06",
          checkOut: "2026-11-07",
          totalPrice: 100,
          currency: "EUR",
        },
      },
    ];

    const result = await commitLodgingImport(
      userId,
      "csv",
      "fx-multiday.csv",
      rows,
    );

    expect(result.failed).toEqual([]);
    expect(result.createdStays).toBe(2);
    expect(fxMock.convertToBase).toHaveBeenCalledTimes(2);
  });

  it("saves a priced stay without an FX snapshot when the FX lookup fails — never blocks the write", async () => {
    fxMock.convertToBase.mockImplementationOnce(async () => null);

    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "FX Failure Hotel" },
        stay: {
          checkIn: "2026-12-01",
          checkOut: "2026-12-02",
          totalPrice: 150,
          currency: "EUR",
        },
      },
    ];

    const result = await commitLodgingImport(
      userId,
      "csv",
      "fx-fail.csv",
      rows,
    );

    expect(result.failed).toEqual([]);
    expect(result.createdStays).toBe(1);

    const stay = await prisma.lodgingStay.findFirst({
      where: { batchId: result.batchId },
    });
    expect(stay?.totalPrice).toBeCloseTo(150, 2);
    // No partial snapshot: price is saved, but the FX fields are all null.
    expect(stay?.totalPriceBase).toBeNull();
    expect(stay?.fxRate).toBeNull();
    expect(stay?.fxBaseCurrency).toBeNull();
    expect(stay?.fxRateDate).toBeNull();
  });

  it("degrades a single pair to lookupFailed when the FX service THROWS (not just returns null) — never sinks the batch", async () => {
    fxMock.convertToBase.mockImplementationOnce(async () => {
      throw new Error("ECB feed unreachable");
    });

    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "FX Throw Hotel" },
        stay: {
          checkIn: "2026-12-10",
          checkOut: "2026-12-11",
          totalPrice: 200,
          currency: "EUR",
        },
      },
      {
        sourceRowIndex: 1,
        action: "create",
        lodging: { name: "FX Throw Companion" },
        stay: null,
      },
    ];

    const result = await commitLodgingImport(
      userId,
      "csv",
      "fx-throw.csv",
      rows,
    );

    // The batch as a whole still succeeds — no row failure, no orphaned batch.
    expect(result.failed).toEqual([]);
    expect(result.createdLodgings).toBe(2);
    expect(result.createdStays).toBe(1);

    const batch = await prisma.importBatch.findUnique({
      where: { id: result.batchId },
    });
    expect(batch).not.toBeNull();

    const stay = await prisma.lodgingStay.findFirst({
      where: { batchId: result.batchId },
    });
    expect(stay?.totalPrice).toBeCloseTo(200, 2);
    // All four snapshot fields are null together — never a partial snapshot.
    expect(stay?.totalPriceBase).toBeNull();
    expect(stay?.fxRate).toBeNull();
    expect(stay?.fxBaseCurrency).toBeNull();
    expect(stay?.fxRateDate).toBeNull();
  });

  // ---- Finding 1: raw exception messages must never reach a 201 response ----

  it("maps an unexpected Prisma error to the stable unexpected_error code — never leaks Prisma internals", async () => {
    // A realistic PrismaClientKnownRequestError: its message embeds the
    // model name, the failing column, and a rendered snippet of the query
    // invocation — exactly what must never reach the client.
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      "Invalid `prisma.lodging.create()` invocation in\n" +
        "/app/backend/src/services/lodging/lodgingImportCommit.ts:119:25\n\n" +
        "Foreign key constraint failed on the field: `Lodging_chain_id_fkey (index)`",
      {
        code: "P2003",
        clientVersion: "5.99.0",
        meta: { field_name: "chain_id" },
      },
    );
    const createSpy = jest
      .spyOn(prisma.lodging, "create")
      .mockRejectedValueOnce(prismaError);

    try {
      const rows: CommitRowInput[] = [
        {
          sourceRowIndex: 0,
          action: "create",
          lodging: { name: "Unexpected Error Hotel" },
          stay: null,
        },
      ];
      const result = await commitLodgingImport(
        userId,
        "csv",
        "unexpected.csv",
        rows,
      );

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].sourceRowIndex).toBe(0);
      expect(result.failed[0].code).toBe("unexpected_error");

      const clientMessage = result.failed[0].error;
      const lower = clientMessage.toLowerCase();
      expect(lower).not.toContain("prisma");
      expect(lower).not.toContain("lodging.create");
      expect(lower).not.toContain("chain_id");
      expect(lower).not.toContain("foreign key");
      expect(clientMessage).not.toContain("lodgingImportCommit.ts");
    } finally {
      createSpy.mockRestore();
    }
  });

  it("keeps ownership failures on their own stable code, distinct from unexpected errors", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        matchedLodgingId: "00000000-0000-0000-0000-000000000000",
        lodging: null,
        stay: null,
      },
    ];
    const result = await commitLodgingImport(
      userId,
      "csv",
      "ownership.csv",
      rows,
    );

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].code).toBe("ownership_mismatch");
    expect(result.failed[0].error.toLowerCase()).not.toContain("prisma");
  });

  describe("overall rating", () => {
    const commitStay = async (
      name: string,
      stay: CommitRowInput["stay"],
    ): Promise<{ ratingOverall: number | null; ratingService: number | null }> => {
      const result = await commitLodgingImport(userId, "csv", "ratings.csv", [
        { sourceRowIndex: 0, action: "create", lodging: { name }, stay },
      ]);
      expect(result.failed).toEqual([]);
      const row = await prisma.lodgingStay.findFirst({
        where: { batchId: result.batchId },
      });
      return {
        ratingOverall: row?.ratingOverall ?? null,
        ratingService: row?.ratingService ?? null,
      };
    };

    it("derives the overall from an import that carries only components", async () => {
      // The exact shape of Alex's real sheet: room + breakfast, no overall
      // column. Before the deriver moved out of the editor these ~380 stays
      // imported unrated and every hotel and chain average read "—".
      const row = await commitStay("Hotel Derived Rating", {
        checkIn: "2026-06-01",
        checkOut: "2026-06-03",
        ratingRoom: 4,
        ratingBreakfast: 5,
      });
      expect(row.ratingOverall).toBe(4.5);
    });

    it("imports a service rating and counts it in the overall", async () => {
      const row = await commitStay("Hotel Service Rating", {
        checkIn: "2026-06-04",
        checkOut: "2026-06-05",
        ratingRoom: 5,
        ratingBreakfast: 4,
        ratingService: 3,
      });
      expect(row.ratingService).toBe(3);
      expect(row.ratingOverall).toBe(4);
    });

    it("keeps a source overall when the import carries no component rating", async () => {
      const row = await commitStay("Hotel Source Overall", {
        checkIn: "2026-06-06",
        checkOut: "2026-06-07",
        ratingOverall: 4,
      });
      expect(row.ratingOverall).toBe(4);
    });

    it("leaves an unrated import unrated", async () => {
      const row = await commitStay("Hotel No Rating", {
        checkIn: "2026-06-08",
        checkOut: "2026-06-09",
      });
      expect(row.ratingOverall).toBeNull();
    });
  });

  // AUD-045: the preview flagged an inverted range, but the commit payload is
  // the client's to edit and the commit schema let it through.
  describe("commit boundary rejects what the stay editor rejects", () => {
    const inverted = {
      sourceRowIndex: 0,
      lodging: { name: "Hotel Backwards" },
      stay: { checkIn: "2020-05-10", checkOut: "2020-05-01" },
    };

    it("refuses a check-out before the check-in at commit (AUD-045)", () => {
      const parsed = lodgingImportCommitRequestSchema.safeParse({
        source: "csv",
        fileName: null,
        rows: [{ ...inverted, action: "create" }],
      });
      expect(parsed.success).toBe(false);
    });

    it("still lets the preview see the row, so it can be flagged", () => {
      const parsed = lodgingImportPreviewRequestSchema.safeParse({ candidates: [inverted] });
      expect(parsed.success).toBe(true);
    });

    it("accepts a same-day stay", () => {
      const parsed = lodgingImportCommitRequestSchema.safeParse({
        source: "csv",
        fileName: null,
        rows: [
          {
            ...inverted,
            action: "create",
            stay: { checkIn: "2020-05-10", checkOut: "2020-05-10" },
          },
        ],
      });
      expect(parsed.success).toBe(true);
    });
  });
});
