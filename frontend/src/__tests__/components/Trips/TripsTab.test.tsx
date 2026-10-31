import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TripsTab from "../../../components/Trips/TripsTab";
import { useSettingsStore } from "../../../store/settingsStore";
import type { Trip } from "../../../types";

// Real store so useEnabledDomains/features read actual (sane) default state —
// TripCard needs `features.enableCostTracking` and `enabledDomains`, neither
// of which the global settingsStore mock (src/__tests__/setup.ts) provides.
vi.unmock("../../../store/settingsStore");

vi.mock("../../../lib/api", () => ({
  tripsApi: { detect: vi.fn().mockResolvedValue({ proposed: [] }) },
}));

vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

function makeTrip(over: Partial<Trip> & { id: string; name: string }): Trip {
  return {
    userId: "u1",
    description: null,
    color: "#4a90d9",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startDate: null,
    endDate: null,
    status: "planned",
    category: null,
    tags: [],
    companions: [],
    notes: null,
    summary: null,
    originLabel: null,
    destinationLabel: null,
    coverImageUrl: null,
    icon: null,
    countries: [],
    ...over,
  } as Trip;
}

describe("TripsTab — filters are the server's job", () => {
  const trips = [
    makeTrip({ id: "a", name: "Planned trip", status: "planned" }),
    makeTrip({ id: "b", name: "Ongoing trip", status: "in_progress" }),
    makeTrip({ id: "c", name: "Done trip", status: "completed" }),
    makeTrip({ id: "d", name: "Second planned trip", status: "planned" }),
  ];
  const filters = { q: "", status: "all", category: "all" } as const;

  it("a status pill asks the parent to filter instead of hiding rows from the loaded page", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    const onFiltersChange = vi.fn();
    render(
      <MemoryRouter>
        <TripsTab
          trips={trips}
          filters={filters}
          onFiltersChange={onFiltersChange}
          onTripsChange={vi.fn()}
        />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /trips:status.in_progress/ }));
    expect(onFiltersChange).toHaveBeenCalledWith({ status: "in_progress" });
    // Rows are whatever the server sent; the tab never drops one itself.
    expect(screen.getByText("Planned trip")).toBeInTheDocument();
  });
});
