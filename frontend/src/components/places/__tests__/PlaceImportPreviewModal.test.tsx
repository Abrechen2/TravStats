import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlaceImportPreviewModal } from "../PlaceImportPreviewModal";
import type { PlaceImportCandidate, PlaceImportPreviewRow } from "../../../types/placeImport";

// The real picker carries a map and a live geocoder search; here it is one
// button that "finds" a fixed hit, so the test can drive the OFFER path —
// the row without coordinates that the whole preview exists for.
vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({
    onChange,
    idPrefix,
  }: {
    onChange: (sel: {
      lat: number;
      lon: number;
      externalRef?: string;
      city?: string;
      country?: string;
    }) => void;
    idPrefix?: string;
  }) => (
    <button
      data-testid={`${idPrefix}-pick-hit`}
      onClick={() =>
        onChange({
          lat: 50.9413,
          lon: 6.9583,
          externalRef: "osm:way/1",
          city: "Köln",
          country: "DE",
        })
      }
    >
      hit
    </button>
  ),
}));

const positioned: PlaceImportPreviewRow = {
  sourceRowIndex: 0,
  name: "Colosseo",
  lat: 41.8902,
  lon: 12.4922,
  flags: [],
  dedupeHint: "none",
  matchedPlaceId: null,
  action: "create",
};

const unplaced: PlaceImportPreviewRow = {
  sourceRowIndex: 1,
  name: "Kölner Dom",
  lat: null,
  lon: null,
  notes: "Turmbesteigung",
  flags: ["missing_coordinates"],
  dedupeHint: "none",
  matchedPlaceId: null,
  action: "needs_input",
};

const nearby: PlaceImportPreviewRow = {
  sourceRowIndex: 2,
  name: "Colosseo",
  lat: 41.8903,
  lon: 12.4921,
  flags: [],
  dedupeHint: "place_nearby",
  matchedPlaceId: "p-existing",
  action: "needs_input",
};

type CommitFn = (rows: PlaceImportCandidate[]) => Promise<void>;

function renderModal(rows: PlaceImportPreviewRow[], onCommit = vi.fn<CommitFn>(async () => {})) {
  const summary = {
    newRows: rows.filter((r) => r.action === "create").length,
    alreadyPresent: rows.filter((r) => r.action === "skip").length,
    needsInput: rows.filter((r) => r.action === "needs_input").length,
  };
  render(
    <PlaceImportPreviewModal rows={rows} summary={summary} onCommit={onCommit} onCancel={vi.fn()} />
  );
  return onCommit;
}

describe("PlaceImportPreviewModal — the offer for an unplaceable row", () => {
  it("withholds the commit while a row without coordinates is undecided", () => {
    renderModal([positioned, unplaced]);
    expect(screen.getByTestId("place-import-commit")).toBeDisabled();
    // A Place is a point: "create" is not offered for a row that has none.
    const select = screen.getByTestId("place-import-action-1") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", "skip"]);
  });

  it("lets the user set a position, which makes the row creatable and commits it with coordinates", async () => {
    const onCommit = renderModal([positioned, unplaced]);

    fireEvent.click(screen.getByTestId("place-import-pick-1"));
    fireEvent.click(screen.getByTestId("place-import-1-pick-hit"));

    expect(screen.getByTestId("place-import-position-1")).toHaveTextContent("50.9413 · 6.9583");
    const select = screen.getByTestId("place-import-action-1") as HTMLSelectElement;
    expect(select.value).toBe("create");

    const commit = screen.getByTestId("place-import-commit");
    expect(commit).toBeEnabled();
    fireEvent.click(commit);

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    const payload = onCommit.mock.calls[0][0];
    expect(payload).toHaveLength(2);
    expect(payload[1]).toMatchObject({
      sourceRowIndex: 1,
      name: "Kölner Dom",
      lat: 50.9413,
      lon: 6.9583,
      externalRef: "osm:way/1",
      city: "Köln",
      country: "DE",
      // What the file said survives the pick.
      notes: "Turmbesteigung",
    });
    // No preview-only fields travel to the commit endpoint.
    expect(payload[1]).not.toHaveProperty("flags");
    expect(payload[1]).not.toHaveProperty("action");
  });

  it("keeps a nearby-duplicate row waiting for a decision, and leaves a skipped row out of the payload", async () => {
    const onCommit = renderModal([positioned, nearby]);
    expect(screen.getByTestId("place-import-commit")).toBeDisabled();

    fireEvent.change(screen.getByTestId("place-import-action-2"), { target: { value: "skip" } });
    fireEvent.click(screen.getByTestId("place-import-commit"));

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit.mock.calls[0][0].map((r) => r.sourceRowIndex)).toEqual([0]);
  });

  it("does not offer an import that would write nothing", () => {
    renderModal([{ ...positioned, action: "skip", dedupeHint: "place_exact_ref" }]);
    expect(screen.getByTestId("place-import-commit")).toBeDisabled();
  });

  it("shows a translated error and stays open when the commit rejects", async () => {
    renderModal(
      [positioned],
      vi.fn<CommitFn>(async () => Promise.reject(new Error("P2002 raw prisma")))
    );
    fireEvent.click(screen.getByTestId("place-import-commit"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("places:import.preview.commitError");
    expect(screen.queryByText(/P2002/)).not.toBeInTheDocument();
    expect(screen.getByTestId("place-import-commit")).toBeInTheDocument();
  });
});
