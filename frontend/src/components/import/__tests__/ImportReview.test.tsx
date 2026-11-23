import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlaceImportPreviewModal } from "../../places/PlaceImportPreviewModal";
import { focusNextOpenItem } from "../ImportReviewBar";
import { placeObvious, railObvious, railOpen } from "../obviousRows";
import type { PlaceImportPreviewRow } from "../../../types/placeImport";
import type { EditableRow as PlaceRow } from "../../places/PlaceImportPreviewRow";
import type { RailImportRow } from "../../rail/railImportModel";

vi.mock("../../location/LocationInput", () => ({ LocationInput: () => null }));

const base: PlaceImportPreviewRow = {
  sourceRowIndex: 0,
  name: "Colosseo",
  lat: 41.8902,
  lon: 12.4922,
  flags: [],
  dedupeHint: "none",
  matchedPlaceId: null,
  action: "create",
};
const duplicate: PlaceImportPreviewRow = {
  ...base,
  sourceRowIndex: 1,
  name: "Pantheon",
  dedupeHint: "place_exact_ref",
  matchedPlaceId: "p1",
  action: "skip",
};
const open: PlaceImportPreviewRow = {
  ...base,
  sourceRowIndex: 2,
  name: "Kölner Dom",
  lat: null,
  lon: null,
  flags: ["missing_coordinates"],
  action: "needs_input",
};
const guess: PlaceImportPreviewRow = {
  ...base,
  sourceRowIndex: 3,
  name: "Forum",
  dedupeHint: "place_nearby",
  matchedPlaceId: "p2",
  action: "needs_input",
};

const asRow = (r: PlaceImportPreviewRow): PlaceRow =>
  ({
    ...r,
    decision: r.action === "needs_input" ? "" : r.action,
    picking: false,
    takeout: null,
  }) as PlaceRow;

describe("obvious rows", () => {
  it("calls a clean positioned create new and an exact-reference skip a duplicate", () => {
    expect(placeObvious(asRow(base))).toBe("new");
    expect(placeObvious(asRow(duplicate))).toBe("duplicate");
  });

  it("never calls a nearby guess or an unplaced row obvious", () => {
    expect(placeObvious(asRow(guess))).toBeNull();
    expect(placeObvious(asRow(open))).toBeNull();
  });

  it("rail: a leg already in the logbook is a duplicate, a placed new one is new, a station-less one is open", () => {
    const placed = {
      name: "Köln Hbf",
      lat: 50.9,
      lon: 6.9,
      country: "DE",
      code: null,
      stationId: 1,
    };
    const unplaced = {
      name: "Irgendwo",
      lat: null,
      lon: null,
      country: null,
      code: null,
      stationId: null,
    };
    const row = (over: Partial<RailImportRow>, dup: string | null = null): RailImportRow =>
      ({
        leg: { duplicateOf: dup },
        selected: true,
        departure: placed,
        arrival: placed,
        saveAs: "rail",
        ...over,
      }) as unknown as RailImportRow;
    expect(railObvious(row({}))).toBe("new");
    expect(railObvious(row({}, "j1"))).toBe("duplicate");
    expect(railObvious(row({ arrival: unplaced }))).toBeNull();
    expect(railOpen(row({ arrival: unplaced }))).toBe(true);
    expect(railOpen(row({}))).toBe(false);
  });
});

describe("PlaceImportPreviewModal review bar", () => {
  const renderModal = (rows: PlaceImportPreviewRow[]) =>
    render(
      <PlaceImportPreviewModal
        rows={rows}
        summary={{ newRows: 1, alreadyPresent: 1, needsInput: 2 }}
        onCommit={vi.fn(async () => {})}
        onCancel={vi.fn()}
      />
    );

  it("puts obviously new rows back to create and obvious duplicates back to skip, leaving guesses alone", () => {
    renderModal([base, duplicate, open, guess]);
    const sel = (i: number) => screen.getByTestId(`place-import-action-${i}`) as HTMLSelectElement;
    fireEvent.change(sel(0), { target: { value: "skip" } });
    fireEvent.change(sel(1), { target: { value: "create" } });
    fireEvent.click(screen.getByTestId("import-take-obvious"));
    expect(sel(0).value).toBe("create");
    expect(sel(1).value).toBe("create");
    fireEvent.click(screen.getByTestId("import-skip-obvious"));
    expect(sel(1).value).toBe("skip");
    // The guess and the unplaced row are still the user's to answer.
    expect(sel(2).value).toBe("");
    expect(sel(3).value).toBe("");
  });

  it("moves the cursor to the next open row on N, but not while typing in a field", () => {
    renderModal([base, open, guess]);
    const rowOf = (index: number): Element | null =>
      screen.getByTestId(`place-import-action-${index}`).closest("tr");
    fireEvent.keyDown(document.body, { key: "n" });
    expect(document.activeElement?.closest("tr")).toBe(rowOf(2));
    // From inside the first open row the next jump reaches the second open row.
    focusNextOpenItem(document.body);
    expect(document.activeElement?.closest("tr")).toBe(rowOf(3));
    // And wraps round at the end.
    focusNextOpenItem(document.body);
    expect(document.activeElement?.closest("tr")).toBe(rowOf(2));
    const typing = screen.getByTestId("place-import-name-0") as HTMLInputElement;
    typing.focus();
    fireEvent.keyDown(typing, { key: "n" });
    expect(document.activeElement).toBe(typing);
  });
});
