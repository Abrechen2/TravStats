import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * SRV-EXPORT-002 (P1, beta audit 2026-09-20), held at the button.
 *
 * `flightsApi.getEvery` has its own test; this one pins that the export
 * actually USES it. The export was rebuilt for six domains on main while the
 * fix sat on a branch, and a merge that kept main's `getAll({ limit: 5000 })`
 * line would have passed every other test — the server stub below answers
 * that call with one capped page, exactly as the real server does.
 */

const SERVER_CAP = 500;
const TOTAL = 501;

const { getMock, exportMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  exportMock: vi.fn(),
}));

vi.mock("../../../lib/api/client", () => ({ api: { get: getMock } }));
vi.mock("../../../lib/xlsx/exportAll", () => ({
  exportWorkbook: exportMock,
  exportFilename: () => "export.xlsx",
}));
vi.mock("../../../lib/api/cruise", () => ({ cruiseApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock("../../../lib/api/lodging", () => ({ listLodgings: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../lib/api/places", () => ({ placesApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock("../../../lib/api/roadtrips", () => ({
  roadtripsApi: { list: vi.fn().mockResolvedValue([]), get: vi.fn() },
}));
vi.mock("../../../lib/api/tourIndex", () => ({
  tourIndexApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../../lib/api/tours", () => ({ toursApi: { get: vi.fn() } }));
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: () => false }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: (d: string) => d === "flight" }),
}));

import SpreadsheetSection from "../SpreadsheetSection";

/** The server: `limit` capped at 500 whatever is asked, `total` the truth. */
getMock.mockImplementation(
  (url: string, cfg?: { params?: { limit?: number; offset?: number } }) => {
    if (url !== "/flights") throw new Error(`unexpected GET ${url}`);
    const limit = Math.min(cfg?.params?.limit ?? SERVER_CAP, SERVER_CAP);
    const offset = cfg?.params?.offset ?? 0;
    const flights = Array.from(
      { length: Math.max(0, Math.min(limit, TOTAL - offset)) },
      (_, i) => ({ id: `f-${offset + i}` })
    );
    return Promise.resolve({ data: { flights, total: TOTAL } });
  }
);

describe("the spreadsheet export", () => {
  it("hands the workbook every flight, not the server's first page", async () => {
    // A null blob ends the handler before it touches URL.createObjectURL.
    exportMock.mockResolvedValue(null);
    render(<SpreadsheetSection />);

    fireEvent.click(screen.getByRole("button", { name: /xlsx:export\.button/ }));

    await waitFor(() => expect(exportMock).toHaveBeenCalledTimes(1));
    const data = exportMock.mock.calls[0][1] as { flights: { id: string }[] };
    expect(data.flights).toHaveLength(TOTAL);
    expect(data.flights[TOTAL - 1]?.id).toBe(`f-${TOTAL - 1}`);
  });
});
