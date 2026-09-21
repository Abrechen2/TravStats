import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Trip } from "../../types";

/**
 * Alex, 2026-09-20: "Der Zurück-Button im Tour Editor führt zurück zur Reise
 * Startseite anstatt zur Tourenliste." The tab was component state alone, so
 * no link could name one — the editor's back link could only ever land on the
 * overview. The open tab lives in the URL now, which is what lets
 * `/trips/:id?tab=tours` mean the tour list.
 */
const getByIdMock = vi.fn();

vi.mock("../../hooks/useHasLlm", () => ({ useHasLlm: () => true }));
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));
vi.mock("../../lib/api", () => ({
  tripsApi: { getById: (...args: unknown[]) => getByIdMock(...args) },
}));
vi.mock("../../lib/api/places", () => ({ listPlaces: vi.fn().mockResolvedValue([]) }));
vi.mock("../../lib/api/tours", () => ({
  toursApi: { list: vi.fn().mockResolvedValue([]), create: vi.fn(), remove: vi.fn() },
}));
vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight", "cruise", "lodging"], isEnabled: () => true }),
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

import TripDetailPage from "../TripDetailPage";

function makeTrip(): Trip {
  return {
    id: "trip-1",
    userId: "user-1",
    name: "Tabprobe",
    description: null,
    color: "#818cf8",
    createdAt: "2024-05-01T00:00:00.000Z",
    updatedAt: "2024-05-01T00:00:00.000Z",
    startDate: "2024-05-13T00:00:00.000Z",
    endDate: "2024-05-15T00:00:00.000Z",
    status: "completed",
    category: null,
    tags: [],
    companions: [],
    notes: null,
    summary: null,
    originLabel: null,
    destinationLabel: null,
    coverImageUrl: null,
    icon: null,
    countries: [],
    flights: [],
    cruises: [],
    stops: [],
    journalEntries: [],
    photos: [],
    lodgingStays: [],
    bookings: [],
  } as unknown as Trip;
}

function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <div data-testid="search">{location.search}</div>;
}

async function renderAt(entry: string): Promise<void> {
  getByIdMock.mockResolvedValue(makeTrip());
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/trips/:id"
          element={
            <>
              <TripDetailPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(getByIdMock).toHaveBeenCalled());
  await screen.findByText("Tabprobe");
}

describe("the trip page's open tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the tab the URL names, so a link back from the tour editor lands there", async () => {
    await renderAt("/trips/trip-1?tab=tours");

    expect(screen.getByRole("tab", { name: "trips:detail.tabs.tours" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("writes the chosen tab into the URL", async () => {
    await renderAt("/trips/trip-1");

    await userEvent.click(screen.getByRole("tab", { name: "trips:detail.tabs.tours" }));

    await waitFor(() => expect(screen.getByTestId("search").textContent).toBe("?tab=tours"));
  });

  it("falls back to the overview when the URL names a tab that does not exist", async () => {
    await renderAt("/trips/trip-1?tab=nonsense");

    expect(screen.getByRole("tab", { name: "trips:detail.tabs.overview" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("offers no way to add a stop — the places domain owns that", async () => {
    // Alex, 2026-09-21: "'Stopp/Ort' Button aus Timeline von Reisen
    // entfernen. Das doppelt sich mit der eigentlichen POI Domäne."
    // The journal button proves the row itself still rendered, so this is
    // the button being gone and not the toolbar failing to appear.
    await renderAt("/trips/trip-1?tab=timeline");

    expect(screen.getByText("trips:detail.timeline.addJournal")).toBeInTheDocument();
    expect(screen.queryByText("trips:detail.timeline.addStop")).not.toBeInTheDocument();
  });
});

/**
 * Alex, 2026-09-20: "In der Timeline könnte man vereinheitlichen und den
 * vollen Inhalt eines Tagebucheintrages auch zum Ausklappen machen wie bei
 * Flügen. Dann muss man nicht das winzig kleine Auge finden."
 */
describe("a diary entry on the trip timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function renderWithJournal(): Promise<void> {
    getByIdMock.mockResolvedValue({
      ...makeTrip(),
      journalEntries: [
        {
          id: "j-1",
          tripId: "trip-1",
          title: "Ankunft",
          body: "Der **erste** Tag am Meer.",
          entryDate: "2024-05-13T00:00:00.000Z",
          weather: null,
          mood: null,
          createdAt: "2024-05-13T00:00:00.000Z",
          updatedAt: "2024-05-13T00:00:00.000Z",
        },
      ],
    } as unknown as Trip);
    render(
      <MemoryRouter initialEntries={["/trips/trip-1?tab=timeline"]}>
        <Routes>
          <Route path="/trips/:id" element={<TripDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(getByIdMock).toHaveBeenCalled());
    await screen.findByText("Ankunft");
  }

  it("opens in place on the header, the way a flight does", async () => {
    await renderWithJournal();

    const toggle = screen.getByRole("button", { name: /Ankunft/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Rendered Markdown, not the source — the body is one node with the
    // emphasis marked up, so the text is matched across its elements.
    expect(screen.queryByText(/erste/)).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("erste")).toBeInTheDocument();
    expect(screen.getByText("trips:detail.timeline.openJournal")).toBeInTheDocument();
  });
});
