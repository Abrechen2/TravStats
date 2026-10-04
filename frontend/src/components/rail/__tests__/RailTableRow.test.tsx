import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}/${o.count}` : k),
    i18n: { language: "de" },
    ready: true,
  }),
}));

import { RailTableRow, RAIL_COLUMN_LAYOUT, type RailColumnId } from "../RailTableRow";
import { Table, type TableColumn } from "../../ui/Table";
import { RAIL_JOURNEY_FIXTURE } from "./railJourneyFixture";
import type { RailJourney } from "../../../types/rail";

const IDS = Object.keys(RAIL_COLUMN_LAYOUT) as RailColumnId[];
const COLUMNS: TableColumn[] = IDS.map((id) => ({ key: id, label: id, ...RAIL_COLUMN_LAYOUT[id] }));

const base = RAIL_JOURNEY_FIXTURE;

function renderRow(legs: RailJourney[], onOpen = vi.fn()): HTMLElement {
  render(
    <MemoryRouter>
      <Table columns={COLUMNS} label="rail">
        <RailTableRow connection={{ id: legs[0].id, legs }} columns={COLUMNS} onOpen={onOpen} />
      </Table>
    </MemoryRouter>
  );
  // Row 0 is the head.
  return screen.getAllByRole("row")[1];
}

/** The cell of `column` in the rendered row. */
const cellOf = (row: HTMLElement, column: RailColumnId): HTMLElement =>
  within(row).getAllByRole("cell")[IDS.indexOf(column)];

describe("RailTableRow distance label", () => {
  it("says a distance runs along the traced line", () => {
    const row = renderRow([base]);
    expect(cellOf(row, "distance").textContent).toBe("88 kmrail:tracedLine");
  });

  // Review 2026-09-26, finding 7: a converted roadtrip leg read "along the
  // track, Transitous" although Transitous never traced it.
  it("says a converted roadtrip leg's distance runs along the roadtrip route", () => {
    const row = renderRow([{ ...base, distanceKm: 243.5, distanceSource: "roadtrip" }]);
    expect(cellOf(row, "distance").textContent).toBe("244 kmrail:roadtripLine");
  });

  it("still says a measured distance is a straight line", () => {
    const row = renderRow([
      { ...base, distanceSource: "great_circle", geometry: null, geometrySource: "straight" },
    ]);
    expect(cellOf(row, "distance").textContent).toContain("rail:straightLine");
  });

  it("shows no distance for a ride with changes — a sum would mix measurements", () => {
    const row = renderRow([base, { ...base, id: "j2", depStationName: "Fulda" }]);
    expect(cellOf(row, "distance").textContent).toBe("—");
  });
});

describe("RailTableRow opening", () => {
  it("opens the ride from anywhere on the row, by click or keyboard", () => {
    const onOpen = vi.fn();
    const row = renderRow([base], onOpen);
    fireEvent.click(cellOf(row, "route"));
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

// forgejo#132 item 16: the DB station code beside each name, never a guess.
describe("RailTableRow station codes", () => {
  it("shows each station's short code beside its name", () => {
    renderRow([{ ...base, depStationShortCode: "FF", arrStationShortCode: "FFU" }]);
    const codes = screen.getAllByTestId("station-short-code").map((el) => el.textContent);
    expect(codes).toEqual(["FF", "FFU"]);
  });

  it("shows no code where none is known", () => {
    renderRow([{ ...base, depStationShortCode: "FF", arrStationShortCode: null }]);
    expect(screen.getAllByTestId("station-short-code").map((el) => el.textContent)).toEqual(["FF"]);
  });
});

// forgejo#197: the operator tile — a monogram, and for a grouped ride the
// operator that carried it furthest.
describe("RailTableRow operator tile", () => {
  it("draws the operator's monogram and names it for a screen reader", () => {
    const row = renderRow([{ ...base, operator: "DB Fernverkehr" }]);
    const tile = within(cellOf(row, "operator")).getByTestId("operator-tile");
    expect(tile).toHaveAttribute("title", "DB Fernverkehr");
    expect(tile.textContent).toBe("DBDB Fernverkehr");
  });

  it("names a grouped ride after the operator of its longest stretch", () => {
    const row = renderRow([
      { ...base, operator: "DB Regio", distanceKm: 40 },
      { ...base, id: "j2", operator: "Thalys", distanceKm: 300 },
    ]);
    expect(within(cellOf(row, "operator")).getByTestId("operator-tile")).toHaveAttribute(
      "title",
      "Thalys"
    );
  });

  it("invents no letters for a ride without an operator", () => {
    const row = renderRow([{ ...base, operator: null }]);
    const tile = within(cellOf(row, "operator")).getByTestId("operator-tile");
    expect(tile).not.toHaveAttribute("title");
    expect(tile.textContent).toBe("");
  });
});
