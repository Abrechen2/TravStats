import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPlaceList = vi.fn();
const removePlaceFromList = vi.fn();
const addPlaceToList = vi.fn();
const reorderPlaceList = vi.fn();

vi.mock("../../lib/api/placeLists", () => ({
  getPlaceList: (...a: unknown[]) => getPlaceList(...a),
  removePlaceFromList: (...a: unknown[]) => removePlaceFromList(...a),
  addPlaceToList: (...a: unknown[]) => addPlaceToList(...a),
  reorderPlaceList: (...a: unknown[]) => reorderPlaceList(...a),
  updatePlaceList: vi.fn(),
  deletePlaceList: vi.fn(),
}));
vi.mock("../../lib/api/places", () => ({ listPlaces: vi.fn(async () => []) }));
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("../../hooks/usePlacesVisible", () => ({ usePlacesAccess: () => "allowed" }));
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/places/PlaceListLabelFields", () => ({
  PlaceListLabelFields: () => null,
  hasSymbol: (v: string) => v.trim().length > 0,
}));
vi.mock("../../components/places/smartList/SmartListPanel", () => ({ default: () => null }));
vi.mock("../../components/places/listTable/PlaceListTable", async () => ({
  default: (await import("./helpers/placeListTableStub")).default,
}));
vi.mock("../../components/purpose/PurposeSegment", () => ({ default: () => null }));

import PlaceListDetailPage from "../PlaceListDetailPage";
import { useToastStore } from "../../store/toastStore";

const place = (id: string, name: string) => ({ id, name, category: "landmark" });
const entries = [
  { id: "e1", placeId: "a", sortIdx: 0, place: place("a", "Pantheon") },
  { id: "e2", placeId: "b", sortIdx: 1, place: place("b", "Trevi") },
];
const LIST = {
  id: "l1",
  name: "Rom",
  color: "#f0a947",
  icon: null,
  curatedKey: null,
  labelMode: "name",
  sortIdx: 0,
  description: null,
  placeCount: 2,
  visitedCount: 0,
  countryCount: 1,
  createdAt: "",
  updatedAt: "",
  entries,
};

describe("PlaceListDetailPage — removing a place", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    getPlaceList.mockResolvedValue(LIST);
    removePlaceFromList.mockResolvedValue({ ...LIST, entries: [entries[1]] });
    addPlaceToList.mockResolvedValue({ ...LIST, entries: [entries[1], entries[0]] });
    reorderPlaceList.mockResolvedValue(LIST);
  });

  it("offers an undo after removing a place and puts it back where it was (removal was irreversible)", async () => {
    render(
      <MemoryRouter initialEntries={["/places/lists/l1"]}>
        <Routes>
          <Route path="/places/lists/:id" element={<PlaceListDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "„Pantheon“ aus der Liste entfernen" })
    );
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const offered = useToastStore.getState().toasts[0];
    expect(offered.message).toBe("„Pantheon“ aus der Liste entfernt");
    offered.undo?.onUndo();
    await waitFor(() => expect(addPlaceToList).toHaveBeenCalledWith("l1", "a", undefined));
    await waitFor(() => expect(reorderPlaceList).toHaveBeenCalledWith("l1", ["a", "b"]));
  });

  it("rebuilds the order from the server's current members when other removals came between", async () => {
    render(
      <MemoryRouter initialEntries={["/places/lists/l1"]}>
        <Routes>
          <Route path="/places/lists/:id" element={<PlaceListDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "„Pantheon“ aus der Liste entfernen" })
    );
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    // "b" was removed afterwards: the server now holds only the re-added "a".
    addPlaceToList.mockResolvedValue({ ...LIST, entries: [entries[0]] });
    useToastStore.getState().toasts[0].undo?.onUndo();
    await waitFor(() => expect(reorderPlaceList).toHaveBeenCalledWith("l1", ["a"]));
  });

  it("restores an automatically added entry's provenance, not 'manual' (auto entries came back manual)", async () => {
    getPlaceList.mockResolvedValue({
      ...LIST,
      entries: [{ ...entries[0], createdBy: "brandRule" }, entries[1]],
    });
    render(
      <MemoryRouter initialEntries={["/places/lists/l1"]}>
        <Routes>
          <Route path="/places/lists/:id" element={<PlaceListDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "„Pantheon“ aus der Liste entfernen" })
    );
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    useToastStore.getState().toasts[0].undo?.onUndo();
    await waitFor(() =>
      expect(addPlaceToList).toHaveBeenCalledWith("l1", "a", { createdBy: "brandRule" })
    );
  });

  it("says a failed undo on the page instead of dropping it silently", async () => {
    render(
      <MemoryRouter initialEntries={["/places/lists/l1"]}>
        <Routes>
          <Route path="/places/lists/:id" element={<PlaceListDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "„Pantheon“ aus der Liste entfernen" })
    );
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    addPlaceToList.mockRejectedValue(new Error("boom"));
    useToastStore.getState().toasts[0].undo?.onUndo();
    expect(
      await screen.findByText("Der Ort konnte nicht zurückgelegt werden.")
    ).toBeInTheDocument();
  });
});
