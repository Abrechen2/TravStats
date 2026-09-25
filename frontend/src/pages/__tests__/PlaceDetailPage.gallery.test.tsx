/**
 * Package 9, item 3: the place page leads with a photograph of its visits.
 * Editing the place answers WITHOUT photos (the update carries the list shape),
 * so taking that answer whole emptied the gallery until the next reload.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const PLACE = {
  id: "p1",
  name: "Wartburg",
  category: "landmark",
  country: "DE",
  city: null,
  address: null,
  lat: 50.9661,
  lon: 10.3064,
  visited: true,
  coverPhotoId: null,
  visits: [
    {
      id: "v1",
      placeId: "p1",
      visitedAt: "2019-08-14T10:00:00.000Z",
      notes: null,
      tripId: null,
      photos: [{ id: "ph1", url: "/api/v1/places/visits/v1/photos/ph1/file", caption: null }],
    },
  ],
};

vi.mock("../../lib/api/places", () => ({
  getPlace: vi.fn(async () => PLACE),
  createVisit: vi.fn(),
  deleteVisit: vi.fn(),
  deletePlace: vi.fn(),
  setPlaceCover: vi.fn(),
}));
vi.mock("../../components/places/PlaceFormModal", () => ({
  PlaceFormModal: ({ onSaved }: { onSaved: (p: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onSaved({
          ...PLACE,
          name: "Wartburg Castle",
          visits: [{ ...PLACE.visits[0], photos: undefined }],
        })
      }
    >
      save-stub
    </button>
  ),
}));
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));
vi.mock("../../components/common/WikipediaCard", () => ({ default: () => null }));
vi.mock("../../components/places/VisitPhotoStrip", () => ({ VisitPhotoStrip: () => null }));
vi.mock("../../lib/api/trips", () => ({ tripsApi: { getAll: vi.fn(async () => []) } }));
vi.mock("../../hooks/usePlacesVisible", () => ({ usePlacesAccess: () => "allowed" }));
vi.mock("../../components/NavigationBar", () => ({ default: () => null }));
vi.mock("../../components/location/LocationMiniMap", () => ({ LocationMiniMap: () => null }));

import PlaceDetailPage from "../PlaceDetailPage";

describe("PlaceDetailPage gallery", () => {
  it("leads with a visit photo, and keeps it after the place is edited", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/places/p1"]}>
        <Routes>
          <Route path="/places/:id" element={<PlaceDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    const lead = await screen.findByRole("img", { name: "places:gallery.lead" });
    expect(lead).toHaveAttribute("src", "/api/v1/places/visits/v1/photos/ph1/file");

    await user.click(screen.getByRole("button", { name: "common:buttons.edit" }));
    await user.click(screen.getByRole("button", { name: "save-stub" }));

    expect(await screen.findByText("Wartburg Castle")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "places:gallery.lead" })).toBeInTheDocument();
  });
});
