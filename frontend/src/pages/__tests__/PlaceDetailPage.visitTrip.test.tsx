import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PlaceDetailPage from "../PlaceDetailPage";

const createVisit = vi.fn();

vi.mock("../../lib/api/places", () => ({
  getPlace: vi.fn(async () => ({
    id: "p1",
    name: "Wartburg",
    category: "landmark",
    country: "DE",
    city: null,
    address: null,
    lat: 50.9661,
    lon: 10.3064,
    visited: true,
    visits: [],
  })),
  createVisit: (...a: unknown[]) => createVisit(...a),
  deleteVisit: vi.fn(),
  deletePlace: vi.fn(),
  getVisitDateSuggestions: vi.fn(async () => [
    { date: "2026-05-02", source: "stay", label: "Hotel am Markt", photoCount: null },
  ]),
}));

vi.mock("../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn(async () => [{ id: "t1", name: "Thüringen 2026" }]) },
}));

vi.mock("../../hooks/usePlacesVisible", () => ({
  usePlacesAccess: () => ({ visible: true, loading: false }),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

vi.mock("../../components/location/LocationMiniMap", () => ({
  LocationMiniMap: () => <div data-testid="map-stub" />,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/places/p1"]}>
      <Routes>
        <Route path="/places/:id" element={<PlaceDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

/**
 * `PlaceVisit.tripId` was accepted by the API from the day the visit routes
 * were written — create and update both take it, and `assertTripOwned` checks
 * the ownership — but no component ever set it, so a place could not be
 * attached to a trip from the interface at all.
 */
describe("PlaceDetailPage — attaching a visit to a trip", () => {
  beforeEach(() => {
    createVisit.mockReset();
    createVisit.mockResolvedValue({ id: "v1" });
  });

  it("sends the chosen trip with the new visit", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /detail\.addVisit/ }));
    const select = await screen.findByRole("combobox", { name: /detail\.visitTrip/ });
    await user.selectOptions(select, "t1");
    await user.click(screen.getByRole("button", { name: /buttons\.save/ }));

    await waitFor(() =>
      expect(createVisit).toHaveBeenCalledWith("p1", expect.objectContaining({ tripId: "t1" }))
    );
  });

  // "Not linked to a trip" must clear, not send an empty string the API would
  // reject as a malformed uuid.
  it("sends null when no trip is chosen", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /detail\.addVisit/ }));
    await user.click(screen.getByRole("button", { name: /buttons\.save/ }));

    await waitFor(() =>
      expect(createVisit).toHaveBeenCalledWith("p1", expect.objectContaining({ tripId: null }))
    );
  });

  // A date chip only fills the field; the visit is saved with it like a typed one.
  it("saves the visit with a picked date suggestion", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /detail\.addVisit/ }));
    await user.click(await screen.findByRole("button", { name: /suggestionChip/ }));
    await user.click(screen.getByRole("button", { name: /buttons\.save/ }));

    await waitFor(() =>
      expect(createVisit).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ visitedAt: "2026-05-02T00:00:00.000Z" })
      )
    );
  });
});
