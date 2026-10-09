import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * The inline forms of a list page (forgejo#246, #247, #249). Every refusal
 * here was a toast that vanished — a reorder that did not stick, a rename that
 * did not happen — and an empty name closed the editor without a word. The
 * rename could only be cancelled with Escape, which an iPad does not have.
 */

const getPlaceList = vi.fn();
const updatePlaceList = vi.fn();
const reorderPlaceList = vi.fn();

vi.mock("../../lib/api/placeLists", () => ({
  getPlaceList: (...a: unknown[]) => getPlaceList(...a),
  updatePlaceList: (...a: unknown[]) => updatePlaceList(...a),
  reorderPlaceList: (...a: unknown[]) => reorderPlaceList(...a),
  addPlaceToList: vi.fn(),
  removePlaceFromList: vi.fn(),
  deletePlaceList: vi.fn(),
}));
vi.mock("../../lib/api/places", () => ({ listPlaces: vi.fn(async () => []) }));
const toasts = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: (...a: unknown[]) => void }) => unknown) =>
    selector({ addToast: toasts.addToast }),
}));
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("../../hooks/usePlacesVisible", () => ({ usePlacesAccess: () => "allowed" }));
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
// The emoji picker behind the label fields cannot load in a symlinked worktree
// and is not what this file is about.
vi.mock("../../components/places/PlaceListLabelFields", () => ({
  PlaceListLabelFields: () => null,
  hasSymbol: (v: string) => v.trim().length > 0,
}));

import PlaceListDetailPage from "../PlaceListDetailPage";

const place = (id: string, name: string) => ({
  id,
  name,
  category: "landmark",
  city: null,
  country: null,
  visited: false,
});

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
  entries: [
    { id: "e1", placeId: "a", sortIdx: 0, place: place("a", "Pantheon") },
    { id: "e2", placeId: "b", sortIdx: 1, place: place("b", "Trevi") },
  ],
};

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/places/lists/l1"]}>
      <Routes>
        <Route path="/places/lists/:id" element={<PlaceListDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const network = { isAxiosError: true, message: "Network Error" };

describe("PlaceListDetailPage — inline forms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPlaceList.mockResolvedValue(LIST);
  });

  it("refuses an empty name at the field instead of closing silently", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    const input = screen.getByRole("textbox", { name: "Name" });
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Eine Liste braucht einen Namen.");
    expect(updatePlaceList).not.toHaveBeenCalled();
  });

  it("says a refused rename at the field and keeps the typed name", async () => {
    updatePlaceList.mockRejectedValue(network);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    const input = screen.getByRole("textbox", { name: "Name" });
    fireEvent.change(input, { target: { value: "Rom 2027" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(input).toHaveValue("Rom 2027");
    expect(toasts.addToast).not.toHaveBeenCalled();
  });

  it("can cancel the rename by touch, not only with Escape", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();
  });

  it("keeps a refused reorder on the page and sends the same order again on retry", async () => {
    reorderPlaceList.mockRejectedValueOnce(network).mockResolvedValueOnce({
      ...LIST,
      entries: [LIST.entries[1], LIST.entries[0]],
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "„Trevi“ nach oben schieben" }));

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Der Server ist nicht erreichbar");
    expect(toasts.addToast).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(reorderPlaceList).toHaveBeenNthCalledWith(1, "l1", ["b", "a"]);
    expect(reorderPlaceList).toHaveBeenNthCalledWith(2, "l1", ["b", "a"]);
  });

  it("gives the small row controls a touch-sized box on a coarse pointer", async () => {
    renderPage();
    const up = await screen.findByRole("button", { name: "„Trevi“ nach oben schieben" });
    // jsdom cannot measure; the pointer-scoped class is the contract.
    expect(up.className).toContain("pointer-coarse:min-h-(--ts-size-touch-min)");
    expect(
      screen.getByRole("button", { name: "„Trevi“ aus der Liste entfernen" }).className
    ).toContain("pointer-coarse:min-w-(--ts-size-touch-min)");
  });
});
