import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));

import { RentalTableRow, RENTAL_COLUMN_LAYOUT, type RentalColumnId } from "../RentalTableRow";
import { Table, type TableColumn } from "../../ui/Table";
import { makeRental } from "./rentalFixture";
import type { RentalBooking } from "../../../types/rental";

const IDS = Object.keys(RENTAL_COLUMN_LAYOUT) as RentalColumnId[];
const COLUMNS: TableColumn[] = IDS.map((id) => ({
  key: id,
  label: id,
  ...RENTAL_COLUMN_LAYOUT[id],
}));

function renderRow(rental: RentalBooking): HTMLElement {
  render(
    <MemoryRouter>
      <Table columns={COLUMNS} label="rentals">
        <RentalTableRow rental={rental} columns={COLUMNS} onOpen={vi.fn()} />
      </Table>
    </MemoryRouter>
  );
  // Row 0 is the head.
  return screen.getAllByRole("row")[1];
}

const cellOf = (row: HTMLElement, column: RentalColumnId): HTMLElement =>
  within(row).getAllByRole("cell")[IDS.indexOf(column)];

/**
 * "km offen" says an invoice is still owed. The browser look of 2026-10-01
 * found it on a booked and on a cancelled rental — neither has km to wait for.
 */
describe("RentalTableRow — the open-km pill", () => {
  it("waits for the invoice of a returned rental", () => {
    renderRow(makeRental({ status: "completed" }));
    expect(screen.getByTestId("rental-km-open")).toBeInTheDocument();
  });

  it.each(["scheduled", "cancelled"] as const)("is not drawn on a %s rental", (status) => {
    renderRow(makeRental({ status }));
    expect(screen.queryByTestId("rental-km-open")).toBeNull();
  });

  it("shows the invoiced km instead", () => {
    renderRow(makeRental({ status: "completed", distanceKm: 634, distanceSource: "invoice" }));
    expect(screen.queryByTestId("rental-km-open")).toBeNull();
    expect(screen.getByText(/634 km/)).toBeInTheDocument();
  });
});

// forgejo#206: in − out of the two odometer readings counts like an invoice's
// figure; only a hand correction is labelled, and one reading gives nothing.
describe("RentalTableRow — km from the odometer", () => {
  it("shows in − out when both readings are known, unlabelled", () => {
    const row = renderRow(
      makeRental({ status: "completed", odometerOutKm: 12_000, odometerInKm: 12_634 })
    );
    expect(cellOf(row, "km").textContent).toBe("634 km");
    expect(screen.queryByTestId("rental-km-open")).toBeNull();
  });

  it("labels a correction that overrides the readings", () => {
    const row = renderRow(
      makeRental({
        status: "completed",
        odometerOutKm: 12_000,
        odometerInKm: 12_634,
        distanceKm: 640,
        distanceSource: "user",
      })
    );
    expect(cellOf(row, "km").textContent).toBe("640 km (rental:distance.user)");
  });

  it("still waits for the km with only one reading", () => {
    renderRow(makeRental({ status: "completed", odometerOutKm: 12_000 }));
    expect(screen.getByTestId("rental-km-open")).toBeInTheDocument();
  });
});

// forgejo#196: the plate is part of what the row says about the car.
describe("RentalTableRow — licence plate", () => {
  it("shows the plate in the vehicle column when one is recorded", () => {
    const row = renderRow(makeRental({ vehicleClass: "Compact", licensePlate: "F-TS 2026" }));
    expect(cellOf(row, "vehicle").textContent).toBe("CompactF-TS 2026");
  });
});

// forgejo#205: the list named the booked class even when the car driven was known.
describe("RentalTableRow — the car driven", () => {
  it("names the car actually driven first, the plate below it", () => {
    const row = renderRow(
      makeRental({
        vehicleClass: "Compact",
        vehicleDriven: "VW Golf",
        licensePlate: "F-TS 2026",
      })
    );
    const cell = cellOf(row, "vehicle");
    expect(within(cell).getByTestId("rental-vehicle").textContent).toBe("VW Golf");
    expect(cell.textContent).toBe("VW GolfF-TS 2026");
    expect(cell.textContent).not.toContain("Compact");
  });

  it("falls back to the booked class when no driven car is recorded", () => {
    const row = renderRow(
      makeRental({ vehicleClass: "Compact", vehicleDriven: null, licensePlate: "F-TS 2026" })
    );
    const cell = cellOf(row, "vehicle");
    expect(within(cell).getByTestId("rental-vehicle").textContent).toBe("Compact");
    expect(cell.textContent).toBe("CompactF-TS 2026");
  });

  it("abstains with a dash when neither car nor plate is known", () => {
    const row = renderRow(makeRental({ vehicleClass: null, vehicleDriven: null }));
    expect(cellOf(row, "vehicle").textContent).toBe("—");
  });
});

// forgejo#197: the provider tile is a monogram on the domain colour.
// forgejo#207: a status pill on every row — a completed rental used to leave
// the column empty, which read as "unknown".
describe("RentalTableRow — tile and status", () => {
  it("draws the provider's monogram", () => {
    const row = renderRow(makeRental({ provider: "Share Now" }));
    const tile = within(cellOf(row, "provider")).getByTestId("operator-tile");
    expect(tile).toHaveAttribute("title", "Share Now");
    expect(tile.textContent).toContain("SN");
  });

  it.each(["scheduled", "in_progress", "completed", "cancelled"] as const)(
    "states the status of a %s rental as a pill",
    (status) => {
      const row = renderRow(makeRental({ status }));
      const pill = within(cellOf(row, "status")).getByTestId("rental-status");
      expect(pill.textContent).toBe(`rental:status.${status}`);
      expect(pill).toHaveClass("ts-status-pill");
    }
  );
});
