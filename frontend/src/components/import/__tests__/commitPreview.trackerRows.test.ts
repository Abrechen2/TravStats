import { describe, it, expect, vi, beforeEach } from "vitest";

const post = vi.hoisted(() => vi.fn());
const createImportBatch = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/client", () => ({ api: { post } }));
vi.mock("../../../lib/api/importBatches", () => ({ createImportBatch }));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

import { commitPreviewRows } from "../commitPreview";
import type { PreviewRowEnriched } from "../../../lib/api/import";

const base: PreviewRowEnriched = {
  date: "2023-08-21",
  fromIata: "LHR",
  toIata: "FRA",
  source: "jetlog",
  sourceRowIndex: 0,
  depUtc: "2023-08-21T11:00:00.000Z",
  arrUtc: "2023-08-21T11:00:00.000Z",
  departureLocal: "2023-08-21T12:00:00",
  arrivalLocalCorrected: "2023-08-21T12:00:00",
  timeSemantics: "DATE_ONLY",
  depTimezone: "Europe/London",
  arrTimezone: "Europe/Berlin",
  depLat: 51.47,
  depLon: -0.46,
  arrLat: 50.03,
  arrLon: 8.56,
  statusDefault: "historical",
  flags: [],
  dedupeHint: "none",
};

/**
 * forgejo#311 — the commit sends what the preview decided. It used to rebuild
 * the departure as "date T 00:00" and send the arrival as given, so a
 * day-only row reached the batch as a "flown" flight with a 1970 arrival.
 */
describe("commitPreviewRows — rows from a tracker export", () => {
  beforeEach(() => {
    post.mockReset().mockResolvedValue({ data: { count: 1, skipped: 0 } });
    createImportBatch.mockReset().mockResolvedValue("batch-1");
  });

  it("sends a day-only row as the historical entry the preview made of it", async () => {
    await commitPreviewRows([{ ...base, bookingReference: "SYN123" }], "imported_jetlog");
    const [, payload] = post.mock.calls[0];
    expect(payload[0]).toMatchObject({
      departureLocal: "2023-08-21T12:00:00",
      arrivalLocal: "2023-08-21T12:00:00",
      depTimeSemantics: "DATE_ONLY",
      arrTimeSemantics: "DATE_ONLY",
      status: "historical",
      bookingReference: "SYN123",
      dataSource: "imported_jetlog",
    });
  });

  it("sends no arrival rather than an empty one", async () => {
    await commitPreviewRows(
      [
        {
          ...base,
          depTimeLocal: "07:15:00",
          departureLocal: "2023-08-21T07:15:00",
          arrivalLocalCorrected: "",
          timeSemantics: undefined,
        },
      ],
      "imported_openflights"
    );
    const [, payload] = post.mock.calls[0];
    expect(payload[0].departureLocal).toBe("2023-08-21T07:15:00");
    expect(payload[0].arrivalLocal).toBeNull();
  });

  it("carries a year-only precision through", async () => {
    await commitPreviewRows(
      [
        {
          ...base,
          date: "2019-01-01",
          datePrecision: "year",
          departureLocal: "2019-01-01T00:00:00",
          arrivalLocalCorrected: "2019-01-01T00:00:00",
          timeSemantics: "UNKNOWN",
        },
      ],
      "imported_openflights"
    );
    const [, payload] = post.mock.calls[0];
    expect(payload[0]).toMatchObject({ datePrecision: "year", depTimeSemantics: "UNKNOWN" });
  });
  it("sends which occurrence of a repeated autumn hour the preview chose", async () => {
    await commitPreviewRows(
      [
        {
          ...base,
          date: "2024-10-27",
          fromIata: "BER",
          toIata: "LHR",
          departureLocal: "2024-10-27T02:30:00",
          arrivalLocalCorrected: "2024-10-27T01:45:00",
          departureFold: "later",
          arrivalFold: "later",
          timeSemantics: undefined,
          statusDefault: "flown",
        },
        base,
      ],
      "imported_airtrail"
    );
    const [, payload] = post.mock.calls[0];
    expect(payload[0]).toMatchObject({ departureFold: "later", arrivalFold: "later" });
    expect(payload[1]).not.toHaveProperty("departureFold");
    expect(payload[1]).not.toHaveProperty("arrivalFold");
  });
});
