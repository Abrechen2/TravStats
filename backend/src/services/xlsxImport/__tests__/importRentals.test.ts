import { prisma } from "../../../db";
import { createRentalSchema } from "../../../schemas/rental";
import { createRentalRow, RENTAL_INCLUDE } from "../../rental/rentalRowWrite";
import { withRentalReadFields } from "../../rental/rentalDto";
import { importSheets } from "../importSheets";

/**
 * Rentals back from the spreadsheet (forgejo#267). `exportRow` writes a
 * rental the way `frontend/src/lib/xlsx/rentalSheet.ts` does once exceljs has
 * read the file back (a date cell → an ISO string whose UTC fields are the
 * station's wall clock) — the frontend test pins the writer to the same
 * shape. Every value is invented.
 */
type Dto = ReturnType<typeof withRentalReadFields>;

const clock = (v: { local: string } | null): string => (v ? `${v.local.slice(0, 16)}:00.000Z` : "");

/**
 * `later` names the ends the writer marks as the second occurrence of a
 * repeated hour (it reads that from the stored instant; the test says it).
 */
function exportRow(r: Dto, later: string[] = ["actualReturn"]): Record<string, string> {
  const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
  const time = (end: "pickup" | "return" | "actualPickup" | "actualReturn") => {
    const v = r.times[end];
    return {
      [`${end}Local`]: clock(v),
      [`${end}Precision`]: s(v?.precision),
      // The writer names only the second occurrence.
      [`${end}Fold`]: later.includes(end) && v?.precision === "minute" ? "later" : "",
    };
  };
  return {
    id: r.id,
    provider: r.provider,
    operatedBy: s(r.operatedBy),
    broker: s(r.broker),
    confirmationNumber: s(r.confirmationNumber),
    brokerReference: s(r.brokerReference),
    agreementNumber: s(r.agreementNumber),
    invoiceNumber: s(r.invoiceNumber),
    pickupStationName: r.pickupStationName,
    pickupIata: s(r.pickupIata),
    pickupAddress: s(r.pickupAddress),
    pickupLat: s(r.pickupLat),
    pickupLon: s(r.pickupLon),
    pickupCountry: s(r.pickupCountry),
    returnStationName: r.returnStationName,
    returnIata: s(r.returnIata),
    returnAddress: s(r.returnAddress),
    returnLat: s(r.returnLat),
    returnLon: s(r.returnLon),
    returnCountry: s(r.returnCountry),
    ...time("pickup"),
    ...time("return"),
    ...time("actualPickup"),
    ...time("actualReturn"),
    status: r.status,
    vehicleClass: s(r.vehicleClass),
    acrissCode: s(r.acrissCode),
    vehicleExample: s(r.vehicleExample),
    vehicleDriven: s(r.vehicleDriven),
    licensePlate: s(r.licensePlate),
    odometerOutKm: s(r.odometerOutKm),
    odometerInKm: s(r.odometerInKm),
    distanceKm: s(r.distanceKm),
    distanceSource: s(r.distanceSource),
    mileagePolicy: s(r.mileagePolicy),
    mileageCapKm: s(r.mileageCapKm),
    fuelPolicy: s(r.fuelPolicy),
    paymentTiming: s(r.paymentTiming),
    price: s(r.price),
    currency: s(r.currency),
    finalAmount: s(r.finalAmount),
    finalCurrency: s(r.finalCurrency),
    finalAmountSource: s(r.finalAmountSource),
    depositAmount: s(r.depositAmount),
    depositCurrency: s(r.depositCurrency),
    depositPaidOn: r.depositPaidOn ? `${r.depositPaidOn}T00:00:00.000Z` : "",
    depositReturnedOn: r.depositReturnedOn ? `${r.depositReturnedOn}T00:00:00.000Z` : "",
    depositReturnedAmount: s(r.depositReturnedAmount),
    inclusions: r.inclusions.join(", "),
    arrivalFlightNumber: s(r.arrivalFlightNumber),
    tripId: r.trip ? `${r.trip.name} [${r.tripId}]` : "",
    routeId: "",
    companions: r.companions.join(", "),
    tags: r.tags.join(", "),
    notes: s(r.notes),
  };
}

/** The fields a move must carry — everything a person or a document wrote. */
const FIELDS = [
  "provider",
  "broker",
  "confirmationNumber",
  "invoiceNumber",
  "pickupStationName",
  "pickupIata",
  "pickupCountry",
  "returnStationName",
  "returnIata",
  "pickupTime",
  "returnTime",
  "pickupPrecision",
  "returnPrecision",
  "actualPickupTime",
  "actualReturnTime",
  "actualPickupPrecision",
  "actualReturnPrecision",
  "vehicleClass",
  "acrissCode",
  "vehicleDriven",
  "licensePlate",
  "odometerOutKm",
  "odometerInKm",
  "distanceKm",
  "distanceSource",
  "fuelPolicy",
  "paymentTiming",
  "price",
  "currency",
  "finalAmount",
  "finalCurrency",
  "finalAmountSource",
  "depositAmount",
  "depositCurrency",
  "depositPaidOn",
  "depositReturnedOn",
  "depositReturnedAmount",
  "inclusions",
  "status",
  "notes",
  "tags",
] as const;

describe("spreadsheet import — rentals", () => {
  const USERS = ["xlsxrental", "xlsxrentalother"];
  let userId: string;
  let otherId: string;

  const ctx = (who: string, mode: "add" | "merge" | "replace" = "merge", dryRun = false) => ({
    userId: who,
    mode,
    dryRun,
  });
  const sheetOf = (rows: Record<string, string>[]) => [{ key: "rental", rows }];

  /** One richly filled rental: one-way, actual return day-only, the later 02:30, a deposit, an invoice. */
  async function storedRental(who: string, over: Record<string, unknown> = {}): Promise<Dto> {
    const row = await createRentalRow(
      who,
      createRentalSchema.parse({
        provider: "Testcar",
        broker: "Holiday Cars",
        confirmationNumber: "R-100",
        invoiceNumber: "INV-7",
        pickupStation: { iata: "FRA", name: "Frankfurt Flughafen" },
        returnStation: { iata: "MUC", name: "München Flughafen" },
        pickupLocal: "2025-10-24T10:00",
        returnLocal: "2025-10-27T09:30",
        actualPickupLocal: "2025-10-24T10:12",
        actualReturnLocal: "2025-10-26T02:30",
        actualReturnFold: "later",
        vehicleClass: "Kompakt",
        acrissCode: "CDMR",
        vehicleDriven: "Opel Corsa",
        licensePlate: "F-TS 1",
        odometerOutKm: 12000,
        odometerInKm: 12634,
        fuelPolicy: "full_to_full",
        paymentTiming: "prepaid",
        price: 120,
        currency: "EUR",
        finalAmount: 150.5,
        finalCurrency: "EUR",
        depositAmount: 300,
        depositCurrency: "USD",
        depositPaidOn: "2025-10-24",
        depositReturnedOn: "2025-11-02",
        depositReturnedAmount: 250,
        inclusions: ["cdw", "gps"],
        notes: "Schlüssel in den Kasten",
        tags: ["Herbst"],
        ...over,
      }),
      { manual: true }
    );
    const stored = await prisma.rentalBooking.findUniqueOrThrow({
      where: { id: row.id },
      include: RENTAL_INCLUDE,
    });
    return withRentalReadFields(stored);
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    userId = (await prisma.user.create({ data: { username: USERS[0], passwordHash: "x" } })).id;
    otherId = (await prisma.user.create({ data: { username: USERS[1], passwordHash: "x" } })).id;
  });

  beforeEach(async () => {
    await prisma.rentalBooking.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await prisma.$disconnect();
  });

  it("reads an untouched export back as unchanged, writing nothing", async () => {
    const dto = await storedRental(userId);
    const before = await prisma.rentalBooking.findUniqueOrThrow({ where: { id: dto.id } });
    const [outcome] = await importSheets(sheetOf([exportRow(dto)]), ctx(userId));
    expect(outcome).toMatchObject({ key: "rental", skipped: 1, updated: 0, created: 0, errors: 0 });
    const after = await prisma.rentalBooking.findUniqueOrThrow({ where: { id: dto.id } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("moves a rental into another account without losing a field", async () => {
    const dto = await storedRental(userId);
    const [outcome] = await importSheets(sheetOf([exportRow(dto)]), ctx(otherId));
    expect(outcome).toMatchObject({ created: 1, errors: 0 });
    const moved = await prisma.rentalBooking.findFirstOrThrow({ where: { userId: otherId } });
    const original = await prisma.rentalBooking.findUniqueOrThrow({ where: { id: dto.id } });
    for (const field of FIELDS) {
      expect({ field, value: moved[field] }).toEqual({ field, value: original[field] });
    }
    // A move reads the original's own: the invoice's km and amount stay the invoice's.
    expect(moved.actualReturnPrecision).toBe("minute");
    expect(moved.actualReturnTime?.toISOString()).toBe(original.actualReturnTime?.toISOString());
    // ... and the same file read again converges instead of doubling.
    const [again] = await importSheets(sheetOf([exportRow(dto)]), ctx(otherId));
    expect(again).toMatchObject({ created: 0, skipped: 1 });
  });

  it("keeps an invoice's km and amount labelled the invoice's on a move", async () => {
    const dto = await storedRental(userId);
    await prisma.rentalBooking.update({
      where: { id: dto.id },
      data: { distanceKm: 634, distanceSource: "invoice", finalAmountSource: "invoice" },
    });
    const fresh = withRentalReadFields(
      await prisma.rentalBooking.findUniqueOrThrow({
        where: { id: dto.id },
        include: RENTAL_INCLUDE,
      })
    );
    await importSheets(sheetOf([exportRow(fresh)]), ctx(otherId));
    const moved = await prisma.rentalBooking.findFirstOrThrow({ where: { userId: otherId } });
    expect(moved).toMatchObject({
      distanceKm: 634,
      distanceSource: "invoice",
      finalAmountSource: "invoice",
    });
  });

  it("keeps a day-only time a day, and the later 02:30 the later one", async () => {
    const dto = await storedRental(userId, {
      actualReturnLocal: "2025-10-26",
      actualReturnFold: undefined,
      pickupLocal: "2025-10-26T02:30",
      pickupFold: "later",
      returnLocal: "2025-10-27T09:30",
      actualPickupLocal: undefined,
    });
    const row = exportRow(dto, ["pickup"]);
    await importSheets(sheetOf([row]), ctx(otherId));
    const moved = await prisma.rentalBooking.findFirstOrThrow({ where: { userId: otherId } });
    expect(moved.actualReturnPrecision).toBe("day");
    // 02:30 CET on 26 Oct 2025 (the later occurrence) is 01:30Z.
    expect(moved.pickupTime.toISOString()).toBe("2025-10-26T01:30:00.000Z");
  });

  it("reads a time cell with no clock and no precision as a day", async () => {
    const dto = await storedRental(userId);
    const row = {
      ...exportRow(dto),
      id: "",
      confirmationNumber: "R-NEW",
      returnLocal: "27.10.2025",
      returnPrecision: "",
    };
    await importSheets(sheetOf([row]), ctx(userId));
    const created = await prisma.rentalBooking.findFirstOrThrow({
      where: { userId, confirmationNumber: "R-NEW" },
    });
    expect(created.returnPrecision).toBe("day");
  });

  it("leaves unknown price, odometer, km and times unknown — never 0", async () => {
    const [outcome] = await importSheets(
      sheetOf([
        {
          provider: "Testcar",
          pickupStationName: "Frankfurt Flughafen",
          pickupIata: "FRA",
          pickupLocal: "2025-07-01T10:00:00.000Z",
          returnLocal: "2025-07-05T09:30:00.000Z",
          price: "",
          odometerOutKm: "",
          distanceKm: "",
          actualReturnLocal: "",
        },
      ]),
      ctx(userId)
    );
    expect(outcome).toMatchObject({ created: 1, errors: 0 });
    const row = await prisma.rentalBooking.findFirstOrThrow({ where: { userId } });
    expect(row).toMatchObject({
      price: null,
      odometerOutKm: null,
      distanceKm: null,
      actualReturnTime: null,
      depositAmount: null,
    });
  });

  it("writes nothing in a dry run, and refuses what the write would refuse", async () => {
    const dto = await storedRental(userId);
    const good = { ...exportRow(dto), id: "", confirmationNumber: "R-2" };
    const backwards = {
      ...good,
      confirmationNumber: "R-3",
      returnLocal: "2025-10-20T09:30:00.000Z",
    };
    const unreadable = { ...good, confirmationNumber: "R-4", pickupLocal: "irgendwann" };
    const [outcome] = await importSheets(
      sheetOf([good, backwards, unreadable]),
      ctx(userId, "merge", true)
    );
    expect(outcome).toMatchObject({ created: 1, errors: 2 });
    // Each refusal says its own reason (review minor 2): the order, not "unreadable".
    expect(outcome.rows.filter((r) => r.action === "error").map((r) => r.message)).toEqual([
      "rental_order",
      "invalid_date",
    ]);
    expect(await prisma.rentalBooking.count({ where: { userId } })).toBe(1);
  });

  // Review I1: a clock-less return on the pickup's day is a valid same-day rental.
  it("creates a row whose booked return is the pickup's own day, given only as a date", async () => {
    const [outcome] = await importSheets(
      sheetOf([
        {
          provider: "Testcar",
          confirmationNumber: "R-DAY",
          pickupStationName: "Frankfurt Flughafen",
          pickupIata: "FRA",
          pickupLocal: "2025-10-27T10:00:00.000Z",
          returnLocal: "27.10.2025",
        },
      ]),
      ctx(userId)
    );
    expect(outcome).toMatchObject({ created: 1, errors: 0 });
    const row = await prisma.rentalBooking.findFirstOrThrow({
      where: { userId, confirmationNumber: "R-DAY" },
    });
    expect(row.returnPrecision).toBe("day");
  });

  it("names an unplaceable rental station as a rental station, and a reversed odometer as such", async () => {
    const dto = await storedRental(userId);
    const nowhere = {
      ...exportRow(dto),
      id: "",
      confirmationNumber: "R-5",
      pickupIata: "",
      pickupLat: "",
      pickupLon: "",
      pickupAddress: "",
      pickupStationName: "Irgendwo",
    };
    const reversed = { ...exportRow(dto), id: "", confirmationNumber: "R-6", odometerInKm: "100" };
    const [outcome] = await importSheets(sheetOf([nowhere, reversed]), ctx(userId, "merge", true));
    expect(outcome.rows.map((r) => r.message)).toEqual([
      "unknown_rental_station",
      "odometer_order",
    ]);
  });

  it("reports an unknown value and still applies the row", async () => {
    const dto = await storedRental(userId);
    const [outcome] = await importSheets(
      sheetOf([{ ...exportRow(dto), fuelPolicy: "halb voll" }]),
      ctx(userId)
    );
    expect(outcome.rows[0].dropped).toEqual([
      { field: "fuelPolicy", value: "halb voll", kept: true },
    ]);
  });

  it("deletes rentals the file does not mention only in replace mode", async () => {
    const kept = await storedRental(userId);
    await storedRental(userId, { confirmationNumber: "R-GONE" });
    const [merge] = await importSheets(sheetOf([exportRow(kept)]), ctx(userId, "merge"));
    expect(merge.deleted).toBe(0);
    const [replace] = await importSheets(sheetOf([exportRow(kept)]), ctx(userId, "replace"));
    expect(replace.deleted).toBe(1);
    expect(await prisma.rentalBooking.count({ where: { userId } })).toBe(1);
  });

  it("reads a rental sheet beside another domain's in one file", async () => {
    const dto = await storedRental(userId);
    const outcomes = await importSheets(
      [
        {
          key: "rail",
          rows: [
            {
              trainNumber: "1",
              depStationName: "Wien Hbf",
              depLat: "48.1852",
              depLon: "16.3776",
              arrStationName: "Zürich HB",
              arrLat: "47.378",
              arrLon: "8.54",
              departureTime: "2025-12-31T22:58:00.000Z",
            },
          ],
        },
        ...sheetOf([exportRow(dto)]),
      ],
      ctx(otherId)
    );
    expect(outcomes.map((o) => [o.key, o.created, o.errors])).toEqual([
      ["rail", 1, 0],
      ["rental", 1, 0],
    ]);
    await prisma.railJourney.deleteMany({ where: { userId: otherId } });
  });
});
