import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    depUtc: "2024-01-15T10:00:00.000Z",
    arrUtc: "2024-01-15T18:25:00.000Z",
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
  it("renders one row per input plus the table header", () => {
    render(
      <PreviewModal
        rows={[
          row(),
          row({ sourceRowIndex: 1, flightNumber: "AA1234", flightNumberNormalised: "AA1234" }),
        ]}
        summary={{ ok: 2, problems: 0, duplicates: 0, unresolvable: 0 }}
        onCommit={vi.fn().mockResolvedValue({ committed: 2, failedChunks: 0 })}
        onClose={vi.fn()}
      />
    );
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("disables and unchecks rows with hard-error flags (no recovery affordance)", () => {
    render(
      <PreviewModal
        rows={[row({ flags: ["unresolvable_airport"] })]}
        summary={{ ok: 0, problems: 1, duplicates: 0, unresolvable: 1 }}
        onCommit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const cb = screen.getByRole("checkbox");
    expect(cb).not.toBeChecked();
    expect(cb).toBeDisabled();
  });

  it("keeps checkbox enabled and renders Date+Status for soft-warning duration_mismatch rows", () => {
    // Regression test for jay-tau UAT report: BLR-international rows with
    // FR24-side Duration drift were silently dropped (disabled checkbox,
    // Date and Status rendered as "—"). They must stay importable now that
    // the backend supplies valid depUtc/arrUtc on duration_mismatch.
    render(
      <PreviewModal
        rows={[
          row({
            sourceRowIndex: 7,
            flags: ["duration_mismatch"],
            depUtc: "2024-09-12T18:00:00.000Z",
            statusDefault: "flown",
          }),
        ]}
        summary={{ ok: 0, problems: 1, duplicates: 0, unresolvable: 0 }}
        onCommit={vi.fn().mockResolvedValue({ committed: 1, failedChunks: 0 })}
        onClose={vi.fn()}
      />
    );
    const cb = screen.getByRole("checkbox");
    expect(cb).toBeChecked();
    expect(cb).not.toBeDisabled();
    expect(screen.getByText("2024-09-12")).toBeInTheDocument();
    expect(screen.getByText("flown")).toBeInTheDocument();
  });

  it("leaves a row the server already holds unticked, but still tickable", () => {
    // Changed deliberately: this used to assert `exact_match` was TICKED, with
    // no reason recorded. That produced Forgejo #4 — re-importing the same CSV
    // showed "0 bereit / 1 Duplikate" above a live button reading "1 Zeile
    // importieren", which then imported nothing, because the count comes from
    // the ticked rows and a duplicate is not a hard error.
    //
    // Unticked, not DISABLED: forcing the import back on is still one click,
    // so the capability the old behaviour gave away for free is intact — the
    // button simply stops promising it by default.
    render(
      <PreviewModal
        rows={[row({ dedupeHint: "exact_match" })]}
        summary={{ ok: 0, problems: 0, duplicates: 1, unresolvable: 0 }}
        onCommit={vi.fn().mockResolvedValue({ committed: 1, failedChunks: 0 })}
        onClose={vi.fn()}
      />
    );
    const cb = screen.getByRole("checkbox");
    expect(cb).not.toBeChecked();
    expect(cb).not.toBeDisabled();
  });

  it("ticks a same-day same-route row, which is a suspicion and not a duplicate", () => {
    // Two different flights genuinely share a day and a route. Pre-unticking
    // these would silently drop real rows — the opposite mistake, and a worse
    // one, because nothing on screen would say a row had been dropped.
    render(
      <PreviewModal
        rows={[row({ dedupeHint: "same_day_same_route" })]}
        summary={{ ok: 0, problems: 0, duplicates: 1, unresolvable: 0 }}
        onCommit={vi.fn().mockResolvedValue({ committed: 1, failedChunks: 0 })}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("disables the commit button when every row is one the server already holds", () => {
    // The whole point of #4: the visible action must match what will happen.
    render(
      <PreviewModal
        rows={[row({ dedupeHint: "exact_match" })]}
        summary={{ ok: 0, problems: 0, duplicates: 1, unresolvable: 0 }}
        onCommit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("settings:import.preview.commit").closest("button")).toBeDisabled();
  });

  it("on commit, awaits onCommit and transitions to success view with count", async () => {
    const onCommit = vi.fn().mockResolvedValue({ committed: 1, failedChunks: 0 });
    render(
      <PreviewModal
        rows={[row({ sourceRowIndex: 0 })]}
        summary={{ ok: 1, problems: 0, duplicates: 0, unresolvable: 0 }}
        onCommit={onCommit}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("settings:import.preview.commit"));
    await waitFor(() => {
      expect(screen.getByText("settings:import.preview.success.imported")).toBeInTheDocument();
    });
    expect(onCommit).toHaveBeenCalledWith([expect.objectContaining({ sourceRowIndex: 0 })]);
  });

  it("only sends checked rows to onCommit", () => {
    const onCommit = vi.fn().mockResolvedValue({ committed: 1, failedChunks: 0 });
    render(
      <PreviewModal
        rows={[row({ sourceRowIndex: 0 }), row({ sourceRowIndex: 1, dedupeHint: "exact_match" })]}
        summary={{ ok: 1, problems: 0, duplicates: 1, unresolvable: 0 }}
        onCommit={onCommit}
        onClose={vi.fn()}
      />
    );
    const checkboxes = screen.getAllByRole("checkbox");
    // Row 1 is an exact match and therefore starts UNTICKED, so it needs no
    // click to be excluded — the assertion below is what still matters.
    expect(checkboxes[1]).not.toBeChecked();
    fireEvent.click(screen.getByText("settings:import.preview.commit"));
    expect(onCommit).toHaveBeenCalledWith([expect.objectContaining({ sourceRowIndex: 0 })]);
  });

  it("on commit error, switches to error state and keeps the form open", async () => {
    const onCommit = vi.fn().mockRejectedValue(new Error("Network down"));
    render(
      <PreviewModal
        rows={[row({ sourceRowIndex: 0 })]}
        summary={{ ok: 1, problems: 0, duplicates: 0, unresolvable: 0 }}
        onCommit={onCommit}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("settings:import.preview.commit"));
    await waitFor(() => {
      expect(screen.getByText("Network down")).toBeInTheDocument();
    });
    // Form is still rendered (commit button visible) so the user can retry
    expect(screen.getByText("settings:import.preview.commit")).toBeInTheDocument();
  });
});
