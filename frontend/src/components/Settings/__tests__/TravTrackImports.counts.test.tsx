import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}=${o.count}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../lib/api/travtrackImports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/travtrackImports")>()),
  travTrackImportsApi: {
    list: vi.fn().mockResolvedValue([
      {
        id: "i1",
        kind: "gpx",
        fileName: "Timeline.json",
        status: "succeeded",
        report: {
          read: 321000,
          stored: 268534,
          duplicate: 7805,
          dropped: { privacy_zone: 44641, deleted_range: 0, invalid: 20, null_island: 0 },
          withoutTime: 0,
          format: "google-timeline",
        },
        pointCount: 268534,
        fromAt: null,
        toAt: null,
        createdAt: "2026-11-22T10:00:00Z",
        finishedAt: "2026-11-22T10:05:00Z",
      },
    ]),
  },
}));

import TravTrackImports from "../TravTrackImports";

/**
 * UAT rc.45: "268534 Positionen · 268534 Positionen gespeichert · 7805 schon vorhanden · 44641
 * verworfen" — the row led with the STORED count, so its parts did not add up.
 */
describe("TravTrackImports — an import's counts add up", () => {
  it("leads with what the file held, then what became of it", async () => {
    render(<TravTrackImports canImport canDelete onChanged={vi.fn()} />);
    const row = await screen.findByText(/report\.read=321000/);
    expect(row.textContent).toContain("track:imports.report.stored=268534");
    expect(row.textContent).not.toContain("track:imports.points=268534");
  });
});
