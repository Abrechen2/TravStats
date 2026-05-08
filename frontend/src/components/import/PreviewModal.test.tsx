import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreviewModal } from "./PreviewModal";
import type { PreviewRowEnriched } from "../../lib/api/import";

function row(over: Partial<PreviewRowEnriched> = {}): PreviewRowEnriched {
  return {
    date: "2024-01-15",
    fromIata: "FRA",
    toIata: "JFK",
    flightNumber: "LH400",
    source: "fr24",
    sourceRowIndex: 0,
    depUtc: "2024-01-15T10:00:00Z",
    arrUtc: "2024-01-15T18:25:00Z",
    arrivalLocalCorrected: "2024-01-15T13:25:00",
    depTimezone: "Europe/Berlin",
    arrTimezone: "America/New_York",
    depLat: 50,
    depLon: 8,
    arrLat: 40,
    arrLon: -73,
    flightNumberNormalised: "LH400",
    statusDefault: "flown",
    flags: [],
    dedupeHint: "none",
    ...over,
  };
}

describe("PreviewModal", () => {
  it("renders one row per input", () => {
    render(
      <PreviewModal
        rows={[row(), row({ sourceRowIndex: 1, flightNumber: "AA1234", flightNumberNormalised: "AA1234" })]}
        summary={{ ok: 2, problems: 0, duplicates: 0, unresolvable: 0 }}
        onCommit={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getAllByRole("row")).toHaveLength(3); // 2 rows + header
  });

  it("auto-unchecks rows with red-flag errors", () => {
    render(
      <PreviewModal
        rows={[row({ flags: ["unresolvable_airport"] })]}
        summary={{ ok: 0, problems: 1, duplicates: 0, unresolvable: 1 }}
        onCommit={() => {}}
        onCancel={() => {}}
      />
    );
    const cb = screen.getByRole("checkbox", { name: /row 0/i });
    expect(cb).not.toBeChecked();
    expect(cb).toBeDisabled(); // no recovery affordance
  });

  it("checks rows with yellow warnings (duplicates) by default", () => {
    render(
      <PreviewModal
        rows={[row({ dedupeHint: "exact_match" })]}
        summary={{ ok: 0, problems: 0, duplicates: 1, unresolvable: 0 }}
        onCommit={() => {}}
        onCancel={() => {}}
      />
    );
    const cb = screen.getByRole("checkbox", { name: /row 0/i });
    expect(cb).toBeChecked();
    expect(cb).not.toBeDisabled();
  });

  it("on Commit, calls onCommit with the checked rows only", () => {
    const onCommit = vi.fn();
    render(
      <PreviewModal
        rows={[
          row({ sourceRowIndex: 0 }),
          row({ sourceRowIndex: 1, dedupeHint: "exact_match" }),
        ]}
        summary={{ ok: 1, problems: 0, duplicates: 1, unresolvable: 0 }}
        onCommit={onCommit}
        onCancel={() => {}}
      />
    );
    // uncheck the duplicate
    const cb1 = screen.getByRole("checkbox", { name: /row 1/i });
    fireEvent.click(cb1);
    fireEvent.click(screen.getByRole("button", { name: /import .* row/i }));
    expect(onCommit).toHaveBeenCalledWith([expect.objectContaining({ sourceRowIndex: 0 })]);
  });
});
