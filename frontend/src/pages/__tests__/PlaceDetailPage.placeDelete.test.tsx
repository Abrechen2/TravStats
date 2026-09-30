/**
 * Browser acceptance 2026-09-26: "Ort löschen" on the place page showed
 * "… wird mit {{count}} Besuchen dauerhaft gelöscht" — the call passed the
 * name and no count. Rendered through the real German i18next, so a missing
 * variable shows up here exactly as it did on screen.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const deleteVisitMock = vi.fn();
const listForEntryMock = vi.fn();
const placeVisits = vi.hoisted(() => ({ list: [] as unknown[] }));

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
    visits: placeVisits.list,
  })),
  createVisit: vi.fn(),
  deleteVisit: (...a: unknown[]) => deleteVisitMock(...a),
  deletePlace: vi.fn(),
}));

// The visit's documents section fetches on mount, and the network is refused
// in tests (forgejo#110). The count the dialog needs comes from the mock below.
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));

vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: (...args: unknown[]) => listForEntryMock(...args) },
}));

vi.mock("../../components/places/VisitPhotoStrip", () => ({
  VisitPhotoStrip: () => <div data-testid="photo-strip-stub" />,
}));

vi.mock("../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn(async () => []) },
}));

vi.mock("../../hooks/usePlacesVisible", () => ({
  usePlacesAccess: () => "allowed",
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

vi.mock("../../components/location/LocationMiniMap", () => ({
  LocationMiniMap: () => <div data-testid="map-stub" />,
}));

vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslation } = await import("../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslation };
});

import PlaceDetailPage from "../PlaceDetailPage";

const visit = (id: string, visitedAt: string) => ({
  id,
  placeId: "p1",
  visitedAt,
  notes: null,
  tripId: null,
  photos: [],
});

async function openPlaceDeleteDialog(): Promise<HTMLElement> {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/places/p1"]}>
      <Routes>
        <Route path="/places/:id" element={<PlaceDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByRole("heading", { name: /Wartburg/ });
  await user.click(screen.getByRole("button", { name: "Ort löschen" }));
  return screen.findByTestId("confirm-modal");
}

describe("PlaceDetailPage — deleting the place", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listForEntryMock.mockResolvedValue([]);
  });

  it("counts the visits that go with it, in German", async () => {
    placeVisits.list = [
      visit("v1", "2019-08-14T10:00:00.000Z"),
      visit("v2", "2021-05-01T10:00:00.000Z"),
    ];
    const dialog = await openPlaceDeleteDialog();
    expect(dialog.textContent).toContain("wird mit 2 Besuchen dauerhaft gelöscht");
    expect(dialog.textContent).not.toContain("{{");
  });

  it("says one visit, not '1 Besuchen'", async () => {
    placeVisits.list = [visit("v1", "2019-08-14T10:00:00.000Z")];
    const dialog = await openPlaceDeleteDialog();
    expect(dialog.textContent).toContain("wird mit einem Besuch dauerhaft gelöscht");
  });

  it("uses the plain sentence for a place without visits", async () => {
    placeVisits.list = [];
    const dialog = await openPlaceDeleteDialog();
    expect(dialog.textContent).toContain("„Wartburg“ wird dauerhaft gelöscht.");
    expect(dialog.textContent).not.toContain("Besuch");
  });
});
