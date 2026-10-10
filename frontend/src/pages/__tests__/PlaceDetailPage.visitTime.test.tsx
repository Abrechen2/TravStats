import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PlaceDetailPage from "../PlaceDetailPage";
import { findNamed, getNamed } from "../../__tests__/helpers/namedElement";

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

const toasts = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: (...a: unknown[]) => void }) => unknown) =>
    selector({ addToast: toasts.addToast }),
}));
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

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

async function typeVisit(date: string, time: string): Promise<void> {
  const user = userEvent.setup();
  renderPage();
  await user.click(await findNamed("button", /Besuch/));
  // The dialog opens on "Heute"; a typed day is "Anderes Datum" (forgejo#231).
  await user.click(getNamed("button", "Anderes Datum"));
  fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: date } });
  fireEvent.change(document.querySelector('input[type="time"]')!, { target: { value: time } });
  await user.click(getNamed("button", "Speichern"));
}

const refused = (code: string) => ({
  isAxiosError: true,
  response: { status: 422, data: { error: "English prose for a log", code } },
});

/**
 * A visit under the time model (ADR 0002, D3; Q4). The web wrote
 * `${date}T${time}:00.000Z` — a wall clock pretending to be UTC, the value the
 * Companion's real instants could not be told apart from. It now sends what
 * was typed with the place it was typed for, and the server places it.
 */
describe("PlaceDetailPage — visit time model", () => {
  beforeEach(() => {
    createVisit.mockReset().mockResolvedValue({ id: "v1" });
    toasts.addToast.mockReset();
  });

  it("a date and a time go as {local, placeRef: place}", async () => {
    await typeVisit("2027-10-31", "02:30");
    await waitFor(() =>
      expect(createVisit).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({
          visitedAt: { local: "2027-10-31T02:30", placeRef: { kind: "place", id: "p1" } },
        })
      )
    );
  });

  it("a date without a time goes as the day, not as midnight UTC", async () => {
    await typeVisit("2027-10-31", "");
    await waitFor(() =>
      expect(createVisit).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ visitedAt: "2027-10-31" })
      )
    );
  });

  it.each([
    ["LOCAL_TIME_NONEXISTENT", /Zeitumstellung/],
    ["TZ_UNRESOLVED", /keine Zeitzone bekannt/],
    ["TIME_SHAPE_REQUIRED", /lade die Seite neu/],
  ])("a %s refusal reaches the reader in German", async (code, sentence) => {
    createVisit.mockRejectedValue(refused(code));
    await typeVisit("2027-03-28", "02:30");
    // Said in the dialog, and it stays there (forgejo#246) — not a toast.
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toMatch(sentence);
    expect(banner.textContent).not.toMatch(/English/);
    expect(toasts.addToast).not.toHaveBeenCalledWith("error", expect.anything());
  });
});
