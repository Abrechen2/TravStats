import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * A delete that fails is said on the page and stays there (forgejo#246) — it
 * was a toast — and a delete that WORKED is never reported as failed because
 * the re-read after it did not (forgejo#247).
 */
const getPlace = vi.fn();
const deleteVisit = vi.fn();
const deletePlace = vi.fn();
const toasts = vi.hoisted(() => ({ addToast: vi.fn() }));

vi.mock("../../lib/api/places", () => ({
  getPlace: (...a: unknown[]) => getPlace(...a),
  deleteVisit: (...a: unknown[]) => deleteVisit(...a),
  deletePlace: (...a: unknown[]) => deletePlace(...a),
  getPlaceRelations: vi.fn(async () => {
    throw new Error("not counted here");
  }),
}));
vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: vi.fn(async () => []) },
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
vi.mock("../../components/places/VisitPhotoStrip", () => ({ VisitPhotoStrip: () => null }));
vi.mock("../../components/places/PlaceGallery", () => ({ PlaceGallery: () => null }));
vi.mock("../../components/common/WikipediaCard", () => ({ default: () => null }));

import PlaceDetailPage from "../PlaceDetailPage";

const PLACE = {
  id: "p1",
  name: "Wartburg",
  category: "landmark",
  country: "DE",
  city: null,
  address: null,
  lat: 50.97,
  lon: 10.31,
  visited: true,
  visits: [
    {
      id: "v1",
      placeId: "p1",
      tripId: null,
      visitedAt: "2019-08-14T00:00:00.000Z",
      notes: null,
      photos: [],
    },
  ],
};
const network = { isAxiosError: true, message: "Network Error" };

async function openVisitDelete(): Promise<void> {
  render(
    <MemoryRouter initialEntries={["/places/p1"]}>
      <Routes>
        <Route path="/places/:id" element={<PlaceDetailPage />} />
        <Route path="/places" element={<div>list</div>} />
      </Routes>
    </MemoryRouter>
  );
  fireEvent.click(await screen.findByRole("button", { name: "Löschen" }));
  const dialog = await screen.findByTestId("confirm-modal");
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Löschen" }));
  });
}

describe("PlaceDetailPage — delete failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPlace.mockResolvedValue(PLACE);
  });

  it("keeps a refused visit delete on the page and sends it again on retry", async () => {
    deleteVisit.mockRejectedValueOnce(network).mockResolvedValueOnce(undefined);
    await openVisitDelete();
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Der Server ist nicht erreichbar");
    expect(toasts.addToast).not.toHaveBeenCalledWith("error", expect.anything());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    });
    await waitFor(() => expect(deleteVisit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("a visit that was deleted is not reported as refused when only the re-read fails", async () => {
    deleteVisit.mockResolvedValue(undefined);
    getPlace.mockResolvedValueOnce(PLACE).mockRejectedValueOnce(network);
    await openVisitDelete();
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Gelöscht. Die Ansicht konnte nicht aktualisiert werden");
    expect(banner).not.toHaveTextContent("nicht gelöscht");
    expect(deleteVisit).toHaveBeenCalledTimes(1);
  });

  it("keeps a refused place delete on the page", async () => {
    deletePlace.mockRejectedValue({
      isAxiosError: true,
      response: { status: 500, data: { error: "boom" } },
    });
    render(
      <MemoryRouter initialEntries={["/places/p1"]}>
        <Routes>
          <Route path="/places/:id" element={<PlaceDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole("button", { name: "Ort löschen" }));
    const dialog = await screen.findByTestId("confirm-modal");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Löschen" }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Der Ort konnte nicht gelöscht werden."
    );
    // Not a failure a second press would cure: no retry offered.
    expect(screen.queryByRole("button", { name: "Erneut versuchen" })).not.toBeInTheDocument();
  });
});
