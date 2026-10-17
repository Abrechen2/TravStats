/**
 * forgejo#311 — the preview fields the tracker exports need.
 *
 * Jetlog, AirTrail and Flighty name airports by ICAO; FR24 never did, so the
 * preview handed the code through untouched and a flight would have been
 * stored with "EDDF" in its IATA column. App in the Air, Flighty, Jetlog and
 * AirTrail know the arrival DAY, which a long eastbound flight needs: without
 * it the preview rolls the arrival forward at most until it follows the
 * departure, which lands a 20-hour flight a day early.
 */
import { buildPreviewRows, type PreviewRowInput } from "../services/importPreview";
import { prisma } from "../db";

describe("importPreview — tracker-export fields (forgejo#311)", () => {
  let userId: string;
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "test-import-tracker-" + Date.now(), passwordHash: "x" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("names an airport given by ICAO by its IATA code", async () => {
    const rows: PreviewRowInput[] = [
      {
        date: "2024-01-15",
        depTimeLocal: "10:00:00",
        arrTimeLocal: "13:00:00",
        fromIata: "EDDF",
        toIata: "KJFK",
        source: "jetlog",
        sourceRowIndex: 0,
      },
    ];
    const [row] = (await buildPreviewRows(userId, rows)).rows;
    expect(row.flags).toEqual([]);
    expect(row.fromIata).toBe("FRA");
    expect(row.toIata).toBe("JFK");
  });

  it("anchors the arrival on its own day when the export knows it", async () => {
    // FRA 22:00 CET (21:00 UTC) → HKG 2024-01-17 05:00 HKT (2024-01-16 21:00 UTC):
    // a 24-hour journey. Rolling forward from the departure day would stop
    // at 2024-01-16 05:00 HKT, a day early.
    const rows: PreviewRowInput[] = [
      {
        date: "2024-01-15",
        depTimeLocal: "22:00:00",
        arrDate: "2024-01-17",
        arrTimeLocal: "05:00:00",
        fromIata: "FRA",
        toIata: "HKG",
        source: "flighty",
        sourceRowIndex: 0,
      },
    ];
    const [row] = (await buildPreviewRows(userId, rows)).rows;
    expect(row.flags).toEqual([]);
    expect(row.arrUtc.toISOString()).toBe("2024-01-16T21:00:00.000Z");
    expect(row.arrivalLocalCorrected).toBe("2024-01-17T05:00:00");
  });

  it("flags a malformed arrival day instead of guessing one", async () => {
    const rows: PreviewRowInput[] = [
      {
        date: "2024-01-15",
        depTimeLocal: "10:00:00",
        arrDate: "17.01.2024",
        arrTimeLocal: "05:00:00",
        fromIata: "FRA",
        toIata: "HKG",
        source: "flighty",
        sourceRowIndex: 0,
      },
    ];
    const [row] = (await buildPreviewRows(userId, rows)).rows;
    expect(row.flags).toContain("malformed_datetime");
  });

  it("stores a day-only flight the way the form does: historical, noon, DATE_ONLY", async () => {
    // OpenFlights and Jetlog rows often carry a day and a route only. The
    // preview used to format its "no instant" sentinel as the arrival —
    // 1970-01-01 — which the batch then refused as arriving before departure,
    // costing the user every such flight.
    const rows: PreviewRowInput[] = [
      { date: "2023-08-21", fromIata: "LHR", toIata: "FRA", source: "jetlog", sourceRowIndex: 0 },
    ];
    const [row] = (await buildPreviewRows(userId, rows)).rows;
    expect(row.flags).toEqual([]);
    expect(row.timeSemantics).toBe("DATE_ONLY");
    expect(row.departureLocal).toBe("2023-08-21T12:00:00");
    expect(row.arrivalLocalCorrected).toBe("2023-08-21T12:00:00");
    expect(row.statusDefault).toBe("historical");
  });

  it("keeps a known departure and states no arrival it does not know", async () => {
    const rows: PreviewRowInput[] = [
      {
        date: "2023-08-21",
        depTimeLocal: "07:15:00",
        fromIata: "LHR",
        toIata: "FRA",
        source: "openflights",
        sourceRowIndex: 0,
      },
    ];
    const [row] = (await buildPreviewRows(userId, rows)).rows;
    expect(row.flags).toEqual([]);
    expect(row.timeSemantics).toBeUndefined();
    expect(row.departureLocal).toBe("2023-08-21T07:15:00");
    expect(row.arrivalLocalCorrected).toBe("");
    expect(row.statusDefault).toBe("historical");
  });

  it("stores a year-only flight with its precision instead of a made-up day", async () => {
    const rows: PreviewRowInput[] = [
      {
        date: "2019-01-01",
        datePrecision: "year",
        fromIata: "JFK",
        toIata: "LAX",
        source: "openflights",
        sourceRowIndex: 0,
      },
    ];
    const [row] = (await buildPreviewRows(userId, rows)).rows;
    expect(row.flags).toEqual([]);
    expect(row.timeSemantics).toBe("UNKNOWN");
    expect(row.datePrecision).toBe("year");
    expect(row.departureLocal).toBe("2019-01-01T00:00:00");
    expect(row.statusDefault).toBe("historical");
  });

  it("flags a future flight without both ends instead of letting the batch refuse it", async () => {
    const rows: PreviewRowInput[] = [
      { date: "2099-08-21", fromIata: "LHR", toIata: "FRA", source: "jetlog", sourceRowIndex: 0 },
    ];
    const [row] = (await buildPreviewRows(userId, rows)).rows;
    expect(row.flags).toContain("missing_required");
  });

  it("carries the booking reference through to the preview row", async () => {
    const rows: PreviewRowInput[] = [
      {
        date: "2024-01-15",
        fromIata: "FRA",
        toIata: "MUC",
        bookingReference: "ABC123",
        source: "app_in_the_air",
        sourceRowIndex: 0,
      },
    ];
    const [row] = (await buildPreviewRows(userId, rows)).rows;
    expect(row.bookingReference).toBe("ABC123");
  });
});
