import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import PlaceDetailPage from "../PlaceDetailPage";

/**
 * Editing a place visit — the answer to the inbox's "Uhrzeit unbekannt"
 * (ADR 0002, plan Phase 3b). The web could add and delete a visit but never
 * change one, so a flag asking for a time of day had no form to send the user
 * to. `?editVisit=<id>` opens that visit's form filled in; saving updates THAT
 * visit and never creates a second one; `?edit=1` opens the place form, where
 * a missing zone is fixed through the coordinates.
 */

const createVisit = vi.fn();
const updateVisit = vi.fn();

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
    visits: [
      {
        id: "v1",
        placeId: "p1",
        tripId: null,
        visitedAt: "2024-05-02T00:00:00.000Z",
        orderIdx: 0,
        notes: "Lutherstube",
        rating: null,
        createdAt: "2024-05-02T00:00:00.000Z",
        updatedAt: "2024-05-02T00:00:00.000Z",
      },
    ],
  })),
  createVisit: (...a: unknown[]) => createVisit(...a),
  updateVisit: (...a: unknown[]) => updateVisit(...a),
  deleteVisit: vi.fn(),
  deletePlace: vi.fn(),
  getVisitDateSuggestions: vi.fn(async () => []),
}));

const toasts = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: (...a: unknown[]) => void }) => unknown) =>
    selector({ addToast: toasts.addToast }),
}));
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("../../lib/api/trips", () => ({ tripsApi: { getAll: vi.fn(async () => []) } }));
vi.mock("../../hooks/usePlacesVisible", () => ({
  usePlacesAccess: () => ({ visible: true, loading: false }),
}));
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/location/LocationMiniMap", () => ({ LocationMiniMap: () => <div /> }));
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));
vi.mock("../../components/places/VisitPhotoStrip", () => ({ VisitPhotoStrip: () => null }));
vi.mock("../../components/places/PlaceGallery", () => ({ PlaceGallery: () => null }));
vi.mock("../../components/common/WikipediaCard", () => ({ default: () => null }));
vi.mock("../../components/places/PlaceFormModal", () => ({
  PlaceFormModal: () => <div data-testid="place-editor" />,
}));

function LocationProbe(): JSX.Element {
  return <div data-testid="search">{useLocation().search}</div>;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/places/:id"
          element={
            <>
              <PlaceDetailPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

const refused = (code: string) => ({
  isAxiosError: true,
  message: "Request failed with status code 422",
  response: { status: 422, data: { error: "English prose for a log", code } },
});

describe("PlaceDetailPage — editing a visit", () => {
  beforeEach(() => {
    createVisit.mockReset().mockResolvedValue({ id: "new" });
    updateVisit.mockReset().mockResolvedValue({ id: "v1" });
    toasts.addToast.mockReset();
  });

  it("?editVisit opens that visit's form, filled in, and drops the parameter", async () => {
    renderAt("/places/p1?editVisit=v1");

    expect(await screen.findByText("Besuch bearbeiten", { selector: "h3" })).toBeInTheDocument();
    expect((document.querySelector('input[type="date"]') as HTMLInputElement).value).toBe(
      "2024-05-02"
    );
    // Midnight is "no time" — the very gap the flag asks the user to fill.
    expect((document.querySelector('input[type="time"]') as HTMLInputElement).value).toBe("");
    expect(screen.getByDisplayValue("Lutherstube")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("search").textContent).toBe(""));
  });

  it("saving updates the visit with the typed time at this place — it never adds a second one", async () => {
    const user = userEvent.setup();
    renderAt("/places/p1?editVisit=v1");
    await screen.findByText("Besuch bearbeiten", { selector: "h3" });

    fireEvent.change(document.querySelector('input[type="time"]')!, { target: { value: "14:30" } });
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(updateVisit).toHaveBeenCalledWith("v1", {
        visitedAt: { local: "2024-05-02T14:30", placeRef: { kind: "place", id: "p1" } },
        notes: "Lutherstube",
        tripId: null,
      })
    );
    expect(createVisit).not.toHaveBeenCalled();
    expect(toasts.addToast).toHaveBeenCalledWith("success", "Besuch gespeichert.");
  });

  it("a refused save says so in German and keeps the form open", async () => {
    updateVisit.mockRejectedValue(refused("SOMETHING_UNMAPPED"));
    const user = userEvent.setup();
    renderAt("/places/p1?editVisit=v1");
    await screen.findByText("Besuch bearbeiten", { selector: "h3" });
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(toasts.addToast).toHaveBeenCalledWith(
        "error",
        "Der Besuch konnte nicht gespeichert werden."
      )
    );
    expect(toasts.addToast).not.toHaveBeenCalledWith(
      "error",
      expect.stringMatching(/English|status code/)
    );
    expect(screen.getByText("Besuch bearbeiten", { selector: "h3" })).toBeInTheDocument();
  });

  it("a link to a visit that is gone says so instead of opening an empty form", async () => {
    renderAt("/places/p1?editVisit=gone");

    await waitFor(() =>
      expect(toasts.addToast).toHaveBeenCalledWith(
        "error",
        "Diesen Besuch gibt es an diesem Ort nicht mehr."
      )
    );
    expect(screen.queryByText("Besuch bearbeiten", { selector: "h3" })).not.toBeInTheDocument();
  });

  it("the row's edit button opens the same form", async () => {
    const user = userEvent.setup();
    renderAt("/places/p1");
    await user.click(await screen.findByRole("button", { name: "Besuch bearbeiten" }));

    expect(screen.getByText("Besuch bearbeiten", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Lutherstube")).toBeInTheDocument();
  });

  it("?edit=1 opens the place form, where a missing zone is fixed", async () => {
    renderAt("/places/p1?edit=1");
    expect(await screen.findByTestId("place-editor")).toBeInTheDocument();
  });
});
