import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));

import { RentalRow } from "../RentalRow";
import { makeRental } from "./rentalFixture";
import type { RentalBooking } from "../../../types/rental";

function renderRow(rental: RentalBooking): void {
  render(
    <MemoryRouter>
      <ul>
        <RentalRow rental={rental} onEdit={vi.fn()} onDelete={vi.fn()} />
      </ul>
    </MemoryRouter>
  );
}

/**
 * "km offen" says an invoice is still owed. The browser look of 2026-10-01
 * found it on a booked and on a cancelled rental — neither has km to wait for.
 */
describe("RentalRow — the open-km pill", () => {
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
