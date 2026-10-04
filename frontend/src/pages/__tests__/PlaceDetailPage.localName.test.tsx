import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PlaceDetailPage from "../PlaceDetailPage";

vi.mock("../../lib/api/places", () => ({
  getPlace: vi.fn(async () => ({
    id: "p1",
    name: "Banpo Bridge Moonlight Rainbow Fountain",
    localName: "반포대교 달빛무지개분수",
    category: "landmark",
    country: "South Korea",
    city: "Seoul",
    address: null,
    lat: 37.5126,
    lon: 126.9958,
    visited: true,
    visits: [],
  })),
  createVisit: vi.fn(),
  deleteVisit: vi.fn(),
  deletePlace: vi.fn(),
  getVisitDateSuggestions: vi.fn(async () => []),
}));

vi.mock("../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn(async () => []) },
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

/** forgejo#199: the name on the sign stands under the readable title. */
describe("PlaceDetailPage — the second name", () => {
  it("shows the local name under the title", async () => {
    render(
      <MemoryRouter initialEntries={["/places/p1"]}>
        <Routes>
          <Route path="/places/:id" element={<PlaceDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { name: "Banpo Bridge Moonlight Rainbow Fountain" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("place-local-name")).toHaveTextContent("반포대교 달빛무지개분수");
  });
});
