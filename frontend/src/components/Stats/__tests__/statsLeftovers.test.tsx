import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SeatStats } from "../../../types";
import StatsSeatSection from "../StatsSeatSection";

/**
 * Figures the backend computed and no screen rendered (ledger
 * stats-unused-data-opportunities): the seat section's `noSeatCount`.
 * The fun section's `afternoon` is pinned in funUniqueEvidenceWiring.test.tsx.
 */
const seats: SeatStats = {
  windowCount: 3,
  middleCount: 1,
  aisleCount: 2,
  unknownCount: 0,
  noSeatCount: 4,
  frontCount: 2,
  middleZoneCount: 2,
  backCount: 2,
  mostCommonSeat: "14A",
  seatClassDistribution: { economy: 6 },
  avgRowNumber: 14,
};

function renderSeats(stats: SeatStats): void {
  render(
    <MemoryRouter>
      <StatsSeatSection seatStats={stats} />
    </MemoryRouter>
  );
}

describe("StatsSeatSection leftovers", () => {
  it("says how many flights carry no seat number instead of dropping them silently", () => {
    renderSeats(seats);
    expect(screen.getByTestId("seats-no-seat").textContent).toContain("seats.noSeat");
  });

  it("hides the no-seat note at zero", () => {
    renderSeats({ ...seats, noSeatCount: 0 });
    expect(screen.queryByTestId("seats-no-seat")).not.toBeInTheDocument();
  });
});
