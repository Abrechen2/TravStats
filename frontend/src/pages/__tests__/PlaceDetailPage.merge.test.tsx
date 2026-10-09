import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * The place page is where a duplicate is merged in (forgejo#232): the action
 * sits beside "Bearbeiten", and after the merge the page re-reads the place
 * that stayed — visits, photos and all.
 */
const getPlace = vi.fn();
const toasts = vi.hoisted(() => ({ addToast: vi.fn() }));

vi.mock("../../lib/api/places", () => ({
  getPlace: (...a: unknown[]) => getPlace(...a),
  deletePlace: vi.fn(),
  deleteVisit: vi.fn(),
  getPlaceRelations: vi.fn(async () => null),
}));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: (...a: unknown[]) => void }) => unknown) =>
    selector({ addToast: toasts.addToast }),
}));
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("../../lib/api/trips", () => ({ tripsApi: { getAll: vi.fn(async () => []) } }));
vi.mock("../../hooks/usePlacesVisible", () => ({ usePlacesAccess: () => "allowed" }));
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/location/LocationMiniMap", () => ({ LocationMiniMap: () => <div /> }));
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));
vi.mock("../../components/places/PlaceGallery", () => ({ PlaceGallery: () => null }));
vi.mock("../../components/common/WikipediaCard", () => ({ default: () => null }));
vi.mock("../../components/places/PlaceMergeDialog", () => ({
  PlaceMergeDialog: ({ onMerged }: { onMerged: (p: unknown) => Promise<void> }) => (
    <div role="dialog" aria-label="merge">
      <button type="button" onClick={() => void onMerged({ id: "p1" })}>
        mock-merged
      </button>
    </div>
  ),
}));

import PlaceDetailPage from "../PlaceDetailPage";

const PLACE = {
  id: "p1",
  name: "Kolosseum",
  category: "landmark",
  country: "IT",
  city: "Rom",
  address: null,
  lat: 41.89,
  lon: 12.49,
  visited: true,
  visits: [],
};

describe("PlaceDetailPage — merging a duplicate in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPlace.mockResolvedValue(PLACE);
  });

  it("offers the merge beside editing and re-reads the place afterwards", async () => {
    render(
      <MemoryRouter initialEntries={["/places/p1"]}>
        <Routes>
          <Route path="/places/:id" element={<PlaceDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole("button", { name: "Dublette zusammenführen" }));
    fireEvent.click(screen.getByRole("button", { name: "mock-merged" }));

    await waitFor(() => expect(getPlace).toHaveBeenCalledTimes(2));
    expect(toasts.addToast).toHaveBeenCalledWith("success", "„Kolosseum“ ist zusammengeführt.");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "merge" })).not.toBeInTheDocument()
    );
  });
});
