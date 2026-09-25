import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && "row" in o
        ? `${k}|${String(o.row)}|${String(o.label)}`
        : o && "value" in o
          ? `${k}|${String(o.field)}|${String(o.value)}`
          : k,
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: () => true }),
}));

// The file is parsed and posted by the client module; the preview is what is
// under test, so both halves are stubbed to a known server answer.
vi.mock("../../../lib/xlsx/importClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/xlsx/importClient")>();
  return {
    ...actual,
    readWorkbookForImport: vi
      .fn()
      .mockResolvedValue([{ key: "lodgingStays", rows: [{}], rowNumbers: [3] }]),
    sendImport: vi.fn().mockResolvedValue({
      dryRun: true,
      mode: "merge",
      clean: true,
      backupId: null,
      sheets: [
        {
          key: "lodgingStays",
          created: 1,
          updated: 1,
          skipped: 0,
          errors: 0,
          deleted: 0,
          rows: [
            { row: 2, action: "create", id: null, label: "Hotel Okura (Tokyo)" },
            {
              row: 3,
              action: "update",
              id: "s-1",
              label: "Hotel Okura (Tokyo)",
              message: "matched_existing",
            },
          ],
        },
        {
          key: "flights",
          created: 1,
          updated: 0,
          skipped: 0,
          errors: 0,
          deleted: 0,
          rows: [
            {
              row: 2,
              action: "create",
              id: null,
              label: "LH 1860",
              notes: ["trip_not_linked"],
            },
          ],
        },
        {
          key: "cruises",
          created: 1,
          updated: 1,
          skipped: 0,
          errors: 0,
          deleted: 0,
          rows: [
            {
              row: 2,
              action: "create",
              id: null,
              label: "Karibik",
              dropped: [{ field: "cabinType", value: "Havana Cabana" }],
            },
            {
              row: 5,
              action: "update",
              id: "c-1",
              label: "Nordland",
              dropped: [{ field: "cabinType", value: "Havana Cabana", kept: true }],
            },
          ],
        },
      ],
    }),
  };
});

import SpreadsheetSection from "../SpreadsheetSection";

async function preview(): Promise<void> {
  render(<SpreadsheetSection />);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "export.xlsx")] } });
  await waitFor(() => expect(screen.getByText("xlsx:import.preview")).toBeTruthy());
}

describe("SpreadsheetSection — import preview", () => {
  it("shows per row whether it is created or changed (tester report, 2026-09-25)", async () => {
    await preview();

    const created = screen.getByTestId("xlsx-row-lodgingStays-2");
    expect(created.textContent).toContain("xlsx:import.actions.create");
    expect(created.textContent).toContain("xlsx:import.rowLine|2|Hotel Okura (Tokyo)");

    const matched = screen.getByTestId("xlsx-row-lodgingStays-3");
    expect(matched.textContent).toContain("xlsx:import.actions.update");
    expect(matched.textContent).toContain("xlsx:import.resolution.matched_existing");
  });

  it("names a remark the row was applied with", async () => {
    await preview();
    expect(screen.getByTestId("xlsx-row-flights-2").textContent).toContain(
      "xlsx:import.notes.trip_not_linked"
    );
  });

  it("names a cell whose value was unknown and left empty (browser acceptance, 2026-09-25)", async () => {
    await preview();
    const row = screen.getByTestId("xlsx-row-cruises-2");
    expect(row.textContent).toContain("xlsx:import.actions.create");
    expect(row.textContent).toContain(
      "xlsx:import.droppedValue|xlsx:columns.cabinType|Havana Cabana"
    );
  });

  it("says the stored value stays when the row updates an existing entry", async () => {
    await preview();
    const row = screen.getByTestId("xlsx-row-cruises-5");
    expect(row.textContent).toContain("xlsx:import.actions.update");
    expect(row.textContent).toContain(
      "xlsx:import.droppedValueKept|xlsx:columns.cabinType|Havana Cabana"
    );
    expect(row.textContent).not.toContain("xlsx:import.droppedValue|");
  });

  it("explains what the table moves and what only the backup moves", () => {
    render(<SpreadsheetSection />);
    expect(screen.getByText(/xlsx:import\.transferNote/)).toBeTruthy();
    expect(screen.queryByText(/xlsx:import\.readOnlySheets/)).toBeNull();
  });
});
