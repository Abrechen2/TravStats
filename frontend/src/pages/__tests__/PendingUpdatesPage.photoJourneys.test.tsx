import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import PendingUpdatesPage from "../PendingUpdatesPage";
import { photoJourneysApi } from "../../lib/api/photoJourneys";
import { immichApi } from "../../lib/api/immich";
import type { PhotoJourney } from "../../types/photoJourney";

/**
 * The Posteingang grows a third tab (forgejo#94, point 1). Two properties of
 * the PAGE, as opposed to the tab's own behaviour:
 *
 * - The tab is there whenever the surface is enabled — not "when there are
 *   rows". An inbox that hides its empty section cannot tell a reader that a
 *   feature exists, and the scan lives inside it.
 * - It is absent when neither flights nor places are on, and `?tab=photos`
 *   then falls back to the first tab rather than selecting a tab that is not
 *   in the strip. That gap — gated chrome, ungated deep link — is the one
 *   `statsTabAccess.ts` exists to close one page over.
 */

const visible = vi.hoisted(() => ({ value: true }));
vi.mock("../../components/inbox/usePhotoJourneysVisible", () => ({
  usePhotoJourneysVisible: () => visible.value,
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-bar-stub" />,
}));
// Its own fetching is irrelevant here, and unmocked it reaches the network.
vi.mock("../../components/DataQuality/DataQualityFlagsSection", () => ({
  default: () => <div data-testid="flags-section-stub" />,
}));
// Same reason: the unfiled-documents block asks for its own list on mount.
// It has its own tests; these are about the tabs.
vi.mock("../../components/inbox/UnfiledDocumentsSection", () => ({
  default: () => <div data-testid="unfiled-documents-stub" />,
}));
// The flight-updates tab shows it while loading; in jsdom its canvas prints a
// "getContext is not implemented" stack per render and says nothing about tabs.
vi.mock("../../components/GlobeLoader", () => ({
  GlobeLoader: () => <div data-testid="globe-loader-stub" />,
}));
vi.mock("../../lib/api", () => ({
  pendingUpdatesApi: {
    getAll: vi.fn().mockResolvedValue({ updates: [] }),
    getStatistics: vi.fn().mockResolvedValue(null),
    apply: vi.fn(),
    reject: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock("../../lib/api/photoJourneys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/photoJourneys")>();
  return {
    ...actual,
    photoJourneysApi: { list: vi.fn(), scan: vi.fn(), accept: vi.fn(), dismiss: vi.fn() },
  };
});
vi.mock("../../lib/api/immich", () => ({
  immichApi: { getSettings: vi.fn() },
}));

function makeJourney(id: string): PhotoJourney {
  return {
    id,
    status: "pending",
    kind: "trip",
    startDate: "2026-04-02T08:00:00.000Z",
    endDate: "2026-04-06T19:00:00.000Z",
    photoCount: 12,
    locatedCount: 12,
    lat: 38.7223,
    lon: -9.1393,
    countryCode: "PT",
    countryName: "Portugal",
    city: "Lissabon",
    previewAssetIds: [],
    placeId: null,
    distanceKm: null,
    nights: null,
    airportIata: "LIS",
    spreadKm: null,
    createdTripId: null,
    createdPlaceVisitId: null,
    createdLodgingStayId: null,
    resolvedAt: null,
    createdAt: "2026-04-07T03:00:00.000Z",
  };
}

const PHOTO_TAB = "dataQuality:inbox.photoJourneys.title";

function renderPage(initialEntry = "/pending-updates"): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PendingUpdatesPage />
    </MemoryRouter>
  );
}

describe("PendingUpdatesPage — the photo-journey tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visible.value = true;
    vi.mocked(photoJourneysApi.list).mockResolvedValue([]);
    vi.mocked(immichApi.getSettings).mockRejectedValue(new Error("not asked in these cases"));
  });

  it("offers three tabs, with the third counting the pending rows", async () => {
    vi.mocked(photoJourneysApi.list).mockResolvedValue([makeJourney("a"), makeJourney("b")]);
    renderPage();

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
    const tab = screen.getByRole("tab", { name: new RegExp(PHOTO_TAB) });
    await waitFor(() => expect(within(tab).getByText("2")).toBeInTheDocument());
  });

  it("is there with no rows at all — the scan lives behind it", async () => {
    renderPage();

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
    expect(screen.getByRole("tab", { name: new RegExp(PHOTO_TAB) })).toBeInTheDocument();
  });

  it("opens from the URL and selects itself when clicked", async () => {
    renderPage("/pending-updates?tab=photos");

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: new RegExp(PHOTO_TAB) })).toHaveAttribute(
        "aria-selected",
        "true"
      )
    );

    await userEvent.click(screen.getByRole("tab", { name: /inbox.review.title/ }));
    expect(screen.getByRole("tab", { name: new RegExp(PHOTO_TAB) })).toHaveAttribute(
      "aria-selected",
      "false"
    );
  });

  it("is absent when neither flights nor places are enabled, and ?tab=photos falls back", async () => {
    visible.value = false;
    renderPage("/pending-updates?tab=photos");

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    expect(screen.queryByRole("tab", { name: new RegExp(PHOTO_TAB) })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /inbox.review.title/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // Nothing was loaded for a tab that does not exist.
    expect(photoJourneysApi.list).not.toHaveBeenCalled();
  });
});
