import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * Saved places around a lodging or a point (forgejo#233), read through the real
 * German resources. No location permission is needed for either start; the
 * device's position is an optional start that never reaches the address bar.
 */
const listPlaces = vi.fn();
const listLodgings = vi.fn();
const createVisit = vi.fn();
const domains = vi.hoisted(() => ({ lodging: true }));

vi.mock("../../lib/api/places", () => ({
  listPlaces: (...a: unknown[]) => listPlaces(...a),
  createVisit: (...a: unknown[]) => createVisit(...a),
  updateVisit: vi.fn(),
  uploadVisitPhotos: vi.fn(),
  getVisitDateSuggestions: vi.fn(async () => []),
}));
vi.mock("../../lib/api/lodging", () => ({ listLodgings: (...a: unknown[]) => listLodgings(...a) }));
vi.mock("../../lib/api/trips", () => ({ tripsApi: { getAll: vi.fn(async () => []) } }));
vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: [],
    isEnabled: (k: string) => (k === "lodging" ? domains.lodging : true),
  }),
}));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/location/LocationInput", () => ({
  LocationInput: ({ onChange, label }: { onChange: (s: unknown) => void; label: string }) => (
    <button
      type="button"
      onClick={() => onChange({ lat: 50.9661, lon: 10.3064, name: "Eisenach" })}
    >
      {label}
    </button>
  ),
}));

import PlacesNearbyPage from "../PlacesNearbyPage";

const place = (id: string, name: string, lat: number, over: Record<string, unknown> = {}) => ({
  id,
  name,
  category: "landmark",
  lat,
  lon: 10.3064,
  visited: false,
  plannedVisitCount: 0,
  ...over,
});

const PLACES = [
  place("p1", "Wartburg", 50.9671, { visited: true }),
  place("p2", "Lutherhaus", 50.9761),
  place("p3", "Bachhaus", 50.9861, { plannedVisitCount: 1, category: "museum" }),
  place("p4", "Erfurter Dom", 50.9761 + 0.08, { visited: true }),
];

const LODGINGS = [
  { id: "h1", name: "Hotel am Markt", city: "Eisenach", lat: 50.9661, lon: 10.3064 },
  { id: "h2", name: "Pension ohne Pin", city: null, lat: null, lon: null },
];

function SearchProbe(): JSX.Element {
  return <div data-testid="search">{useLocation().search}</div>;
}

async function renderAt(entry = "/places/nearby"): Promise<void> {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/places/nearby"
          element={
            <>
              <PlacesNearbyPage />
              <SearchProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
  await act(async () => {});
}

// The results section, named by its heading ("3 Orte bis 5 km um …").
const results = (): HTMLElement => screen.getByRole("region", { name: /^(\d+ Orte?|Orte)\b/ });

describe("PlacesNearbyPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    domains.lodging = true;
    listPlaces.mockResolvedValue(PLACES);
    listLodgings.mockResolvedValue(LODGINGS);
    createVisit.mockResolvedValue({ id: "v1" });
  });
  afterEach(() => {
    Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });
  });

  it("asks for a starting point before it shows anything", async () => {
    await renderAt();
    expect(screen.getByText(/Wähle einen Ausgangspunkt/)).toBeInTheDocument();
  });

  it("lists saved places around a chosen lodging, nearest first, each state by mark and word", async () => {
    await renderAt();
    fireEvent.change(screen.getByLabelText("Unterkunft"), { target: { value: "h1" } });

    const items = within(results()).getAllByRole("listitem");
    expect(items.map((li) => within(li).getByRole("link").textContent)).toEqual([
      "Wartburg",
      "Lutherhaus",
      "Bachhaus",
    ]);
    expect(items[0]).toHaveTextContent("✓ Besucht");
    expect(items[1]).toHaveTextContent("☆ Gemerkt");
    expect(items[2]).toHaveTextContent("◷ Geplant");
    expect(items[0]).toHaveTextContent("111 m");
    expect(screen.getByText("3 Orte bis 5 km um Hotel am Markt")).toBeInTheDocument();
    // A lodging is a shareable start.
    expect(screen.getByTestId("search").textContent).toBe("?lodging=h1");
    // One without a position cannot be chosen, and that is said.
    expect(
      screen.getByText("Eine Unterkunft ohne Standort ist nicht wählbar.")
    ).toBeInTheDocument();
  });

  it("opens at a linked lodging", async () => {
    await renderAt("/places/nearby?lodging=h1");
    await waitFor(() =>
      expect(screen.getByText("3 Orte bis 5 km um Hotel am Markt")).toBeInTheDocument()
    );
  });

  // Review M5: a link to a lodging that cannot be a start says so.
  it("says when a linked lodging has no position", async () => {
    await renderAt("/places/nearby?lodging=h2");
    expect(screen.getByRole("alert")).toHaveTextContent("Diese Unterkunft hat keinen Standort");
  });

  it("starts from a point on the map without any permission", async () => {
    await renderAt();
    fireEvent.click(screen.getByRole("button", { name: "Ort oder Punkt" }));
    fireEvent.click(screen.getByRole("button", { name: "Ort suchen oder Punkt setzen" }));
    expect(screen.getByText("3 Orte bis 5 km um Eisenach")).toBeInTheDocument();
    expect(screen.getByTestId("search").textContent).toContain("lat=50.96610");
  });

  it("filters by distance, category and state, and offers the way out of an empty result", async () => {
    await renderAt("/places/nearby?lat=50.9661&lon=10.3064");
    fireEvent.change(screen.getByLabelText("Umkreis"), { target: { value: "0.5" } });
    expect(within(results()).getAllByRole("listitem")).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Kategorie"), { target: { value: "museum" } });
    expect(screen.getByText("Keine Orte passen zu den Filtern.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Umkreis auf 1 km erweitern" }));
    fireEvent.click(screen.getByRole("button", { name: "Umkreis auf 2 km erweitern" }));
    fireEvent.click(screen.getByRole("button", { name: "Umkreis auf 5 km erweitern" }));
    expect(within(results()).getByRole("link", { name: "Bachhaus" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Geplant/ }));
    expect(screen.getByRole("button", { name: /Geplant/ })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    fireEvent.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    expect(within(results()).getAllByRole("listitem")).toHaveLength(3);
  });

  it("uses the device's position once, when asked, and keeps it out of the address bar", async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) =>
      ok({ coords: { latitude: 50.9661, longitude: 10.3064 } } as GeolocationPosition)
    );
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    });
    await renderAt();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Mein Standort" }));
    fireEvent.click(screen.getByRole("button", { name: "Standort einmal verwenden" }));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByText("3 Orte bis 5 km um dein Standort")).toBeInTheDocument();
    expect(screen.getByTestId("search").textContent).toBe("");
  });

  it("says when the location is refused, and points to the other starts", async () => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) =>
          fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
      },
      configurable: true,
    });
    await renderAt();
    fireEvent.click(screen.getByRole("button", { name: "Mein Standort" }));
    fireEvent.click(screen.getByRole("button", { name: "Standort einmal verwenden" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Standort nicht freigegeben");
  });

  it("tells a failed load from an empty result and retries it", async () => {
    listPlaces
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 } })
      .mockResolvedValueOnce(PLACES);
    await renderAt("/places/nearby?lat=50.9661&lon=10.3064");
    expect(screen.getByText("Orte konnten nicht geladen werden.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(within(results()).getAllByRole("listitem")).toHaveLength(3));
  });

  it("offers no lodging start while the lodging domain is off", async () => {
    domains.lodging = false;
    await renderAt();
    expect(screen.queryByRole("button", { name: "Unterkunft" })).not.toBeInTheDocument();
    expect(listLodgings).not.toHaveBeenCalled();
  });

  it("records a visit straight from a row", async () => {
    await renderAt("/places/nearby?lat=50.9661&lon=10.3064");
    const row = within(results()).getAllByRole("listitem")[1];
    fireEvent.click(within(row).getByRole("button", { name: "Besuch erfassen" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(createVisit).toHaveBeenCalledWith("p2", expect.anything()));
    await waitFor(() => expect(listPlaces).toHaveBeenCalledTimes(2));
  });
});
