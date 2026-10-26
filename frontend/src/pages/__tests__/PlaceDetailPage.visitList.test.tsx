/**
 * The place page's visit list, after tester feedback (Discord, 2026-10):
 * planned visits sat at the bottom, the date format setting was ignored (ISO
 * on every row), and every row carried its own photo strip, suggestion link
 * and documents section. These pin the redesign the owner approved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { setClockForTests } from "../../shared/time";
import { visitAt } from "../../components/places/__tests__/visitFixtures";

const display = vi.hoisted(() => ({
  language: "de",
  dateFormat: "DD.MM.YYYY",
  timeFormat: "24h",
}));

vi.mock("../../store/settingsStore", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../store/settingsStore");
  const state = () => ({ display, units: { currency: "EUR", distanceUnit: "kilometers" } });
  const useSettingsStore = Object.assign(
    (selector?: (s: ReturnType<typeof state>) => unknown) =>
      typeof selector === "function" ? selector(state()) : state(),
    { getState: state }
  );
  return { ...actual, useSettingsStore };
});

const VISITS = [
  visitAt("past-2025", "2025-11-14T18:30:00.000Z", { notes: "Saisonauftakt" }),
  visitAt("next-week", "2026-11-06T18:30:00.000Z", { notes: "AEV – Eisbären" }),
  visitAt("undated", null, { notes: "Mit der Schulklasse" }),
  visitAt("feb", "2026-02-27T12:30:00.000Z", {
    notes: "AEV – Kölner Haie\nMit Alex, Stehplatz Nord.",
    tripId: "t1",
    rating: 4,
    documentCount: 2,
    photos: [{ id: "ph1" }, { id: "ph2" }] as never,
  }),
  visitAt("thursday", "2026-10-29T12:30:00.000Z", { notes: "DEL", documentCount: 1 }),
];

vi.mock("../../lib/api/places", () => ({
  getPlace: vi.fn(async () => ({
    id: "p1",
    name: "Curt-Frenzel-Stadion",
    category: "other",
    country: "DE",
    city: "Augsburg",
    address: null,
    lat: 48.3738,
    lon: 10.8865,
    visited: true,
    visits: VISITS,
  })),
  createVisit: vi.fn(),
  deleteVisit: vi.fn(),
  deletePlace: vi.fn(),
}));

// The real strip renders; its suggestions (which fetch on click) are stubbed.
vi.mock("../../components/places/VisitPhotoSuggestions", () => ({
  VisitPhotoSuggestions: ({ visitId }: { visitId: string }) => (
    <div data-testid={`photo-suggestions-${visitId}`} />
  ),
}));
vi.mock("../../components/documents/DocumentsSection", () => ({
  default: ({ entry }: { entry: { id: string } }) => <div data-testid={`documents-${entry.id}`} />,
}));
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn(async () => [{ id: "t1", name: "Augsburg Februar" }]) },
}));
vi.mock("../../hooks/usePlacesVisible", () => ({ usePlacesAccess: () => "allowed" }));
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/location/LocationMiniMap", () => ({ LocationMiniMap: () => <div /> }));
vi.mock("../../components/places/PlaceGallery", () => ({ PlaceGallery: () => null }));
vi.mock("../../components/common/WikipediaCard", () => ({ default: () => null }));

import PlaceDetailPage from "../PlaceDetailPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/places/p1"]}>
      <Routes>
        <Route path="/places/:id" element={<PlaceDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

/** The row toggles, in document order, by the date they start with. */
const rowToggles = (): HTMLElement[] =>
  screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));

describe("PlaceDetailPage — visit list", () => {
  beforeEach(() => {
    // Monday 26 October 2026, 09:00 in Augsburg.
    setClockForTests(new Date("2026-10-26T08:00:00.000Z"));
    display.dateFormat = "DD.MM.YYYY";
  });
  afterEach(() => setClockForTests(null));

  it("lists planned visits first (next one first), then the past by year, newest first, undated last", async () => {
    renderPage();
    await screen.findByRole("heading", { level: 3, name: /Geplant/ });

    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Geplantzählt erst, wenn der Besuch vorbei ist",
      "20261 Besuch",
      "20251 Besuch",
      "Ohne Datumzählt als Besuch",
    ]);
    expect(rowToggles().map((b) => b.textContent?.slice(0, 13))).toEqual([
      "Do 29.10.2026",
      "Fr 06.11.2026",
      "Fr 27.02.2026",
      "Fr 14.11.2025",
      "Ohne DatumMit",
    ]);
  });

  it("shows dates in the user's format — MM/DD/YYYY when that is the setting", async () => {
    display.dateFormat = "MM/DD/YYYY";
    renderPage();
    expect(await screen.findByText("Fr 02/27/2026")).toBeInTheDocument();
    expect(screen.queryByText(/2026-02-27/)).not.toBeInTheDocument();
  });

  it("names the planned visit's distance, and summarises the history in one line", async () => {
    renderPage();
    expect(await screen.findByText("Geplant · in 3 Tagen")).toBeInTheDocument();
    expect(screen.getByTestId("visit-summary").textContent).toBe(
      "3× besucht · zuletzt 27.02.2026 · erster datierter Besuch 14.11.2025 · nächster 29.10.2026, 13:30"
    );
  });

  it("carries trip, photo, document and rating on the row without opening it", async () => {
    renderPage();
    const row = await screen.findByTestId("visit-row-feb");
    expect(within(row).getByText(/Reise: Augsburg Februar/)).toBeInTheDocument();
    expect(within(row).getByText("2 Fotos")).toBeInTheDocument();
    expect(within(row).getByText("2 Dokumente")).toBeInTheDocument();
    expect(within(row).getByText("4 von 5 Sternen")).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Besuch vom 27.02.2026 bearbeiten" })
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Besuch vom 27.02.2026 löschen" })
    ).toBeInTheDocument();
  });

  it("mounts photos and documents only for the open row, one row at a time", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("visit-row-feb");
    expect(screen.queryByTestId(/^documents-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^photo-suggestions-/)).not.toBeInTheDocument();

    const feb = within(screen.getByTestId("visit-row-feb")).getAllByRole("button")[0];
    await user.click(feb);
    expect(feb).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("documents-feb")).toBeInTheDocument();
    // It has a trip, so the suggestions are offered.
    expect(screen.getByTestId("photo-suggestions-feb")).toBeInTheDocument();
    expect(screen.getByText(/Mit Alex, Stehplatz Nord\./)).toBeInTheDocument();

    const thursday = within(screen.getByTestId("visit-row-thursday")).getAllByRole("button")[0];
    await user.click(thursday);
    expect(screen.queryByTestId("documents-feb")).not.toBeInTheDocument();
    // A planned visit: its ticket, but no photo strip.
    expect(screen.getByTestId("documents-thursday")).toBeInTheDocument();
    expect(screen.queryByTestId("photo-suggestions-thursday")).not.toBeInTheDocument();
  });

  it("offers the photo suggestions for a past visit without a trip too", async () => {
    const user = userEvent.setup();
    renderPage();
    const row = await screen.findByTestId("visit-row-past-2025");
    await user.click(within(row).getAllByRole("button")[0]);
    expect(screen.getByTestId("photo-suggestions-past-2025")).toBeInTheDocument();
  });

  it("filters to planned or to visited", async () => {
    const user = userEvent.setup();
    renderPage();
    const planned = await screen.findByRole("button", { name: "Geplant · 2" });
    const visited = screen.getByRole("button", { name: "Besucht · 3" });
    expect(screen.getByRole("button", { name: "Alle" })).toHaveAttribute("aria-pressed", "true");

    await user.click(planned);
    expect(planned).toHaveAttribute("aria-pressed", "true");
    expect(rowToggles()).toHaveLength(2);
    expect(screen.queryByTestId("visit-row-feb")).not.toBeInTheDocument();

    await user.click(visited);
    expect(rowToggles()).toHaveLength(3);
    expect(screen.queryByTestId("visit-row-thursday")).not.toBeInTheDocument();
    expect(screen.getByTestId("visit-row-undated")).toBeInTheDocument();
  });
});
