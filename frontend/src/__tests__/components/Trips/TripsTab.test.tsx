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

describe("TripsTab — status filter (#status-from-dates)", () => {
  it('the "Aktuell"/in_progress filter chip matches trip.status === "in_progress"', () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    const trips = [
      makeTrip({ id: "a", name: "Planned trip", status: "planned" }),
      makeTrip({ id: "b", name: "Ongoing trip", status: "in_progress" }),
      makeTrip({ id: "c", name: "Done trip", status: "completed" }),
      makeTrip({ id: "d", name: "Second planned trip", status: "planned" }),
    ];

    render(
      <MemoryRouter>
        <TripsTab trips={trips} onTripsChange={vi.fn()} />
      </MemoryRouter>
    );

    // The filter bar only renders once trips.length >= 4 (showFilters). The
    // filter button and the "Ongoing trip" card's own status pill share the
    // same i18n key text, so disambiguate by role.
    fireEvent.click(screen.getByRole("button", { name: "trips:status.in_progress" }));

    expect(screen.getByText("Ongoing trip")).toBeInTheDocument();
    expect(screen.queryByText("Planned trip")).not.toBeInTheDocument();
    expect(screen.queryByText("Done trip")).not.toBeInTheDocument();
    expect(screen.queryByText("Second planned trip")).not.toBeInTheDocument();
  });
});
