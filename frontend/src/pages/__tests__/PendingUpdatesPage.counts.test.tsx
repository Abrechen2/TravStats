import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import PendingUpdatesPage from "../PendingUpdatesPage";
import { pendingUpdatesApi } from "../../lib/api";
import { photoJourneysApi } from "../../lib/api/photoJourneys";
import { immichApi } from "../../lib/api/immich";

const visible = vi.hoisted(() => ({ value: true }));
// Shared trips (2026-10-09): the trip overview, the settings and the inbox
// read the sharing API on mount; answered empty so no request escapes.
vi.mock("@/lib/api/sharing", () => ({
  sharingApi: {
    tripSharing: vi
      .fn()
      .mockResolvedValue({ groupId: null, members: [], candidates: [], bookingTotals: [] }),
    listConsents: vi.fn().mockResolvedValue({ incoming: [], outgoing: [] }),
    listCompanions: vi.fn().mockResolvedValue({ companions: [], linkableUsers: [] }),
    listNotices: vi.fn().mockResolvedValue([]),
    inboxCount: vi.fn().mockResolvedValue(0),
  },
}));

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
// The trip-suggestion tab loads its own list; it has its own tests.
vi.mock("../../components/inbox/workspace/InboxWorkspace", () => ({
  default: () => <div data-testid="inbox-workspace-stub" />,
}));
vi.mock("../../components/inbox/TripSuggestionsTab", async () => {
  const { useEffect } = await import("react");
  function TripSuggestionsStub({ onCount }: { onCount: (n: number) => void }) {
    useEffect(() => onCount(3), [onCount]);
    return <div data-testid="trip-suggestions-stub" />;
  }
  return { default: TripSuggestionsStub };
});
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

const tab = (name: RegExp) => screen.getByRole("tab", { name });
function renderPage(initialEntry: string): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PendingUpdatesPage />
    </MemoryRouter>
  );
}

/**
 * The tab labels carry counts. On the overview the flight-update list is never
 * loaded, so its label read "0" from the empty initial list — a zero nobody
 * measured — and the other tabs' sections are unmounted there, so their
 * counts froze at whatever they last reported.
 */
describe("PendingUpdatesPage — tab counts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visible.value = true;
    vi.mocked(photoJourneysApi.list).mockResolvedValue([]);
    vi.mocked(immichApi.getSettings).mockRejectedValue(new Error("not asked in these cases"));
  });

  it("claims no flight-update count on the overview, where none was loaded", async () => {
    renderPage("/pending-updates");
    await waitFor(() => expect(screen.getByTestId("inbox-workspace-stub")).toBeVisible());
    expect(pendingUpdatesApi.getAll).not.toHaveBeenCalled();
    expect(tab(/inbox.flightUpdates.title/).textContent).not.toMatch(/\d/);
  });

  it("shows the measured count once the updates tab has loaded", async () => {
    vi.mocked(pendingUpdatesApi.getAll).mockResolvedValue({ updates: [] } as never);
    renderPage("/pending-updates?tab=updates");
    await waitFor(() => expect(tab(/inbox.flightUpdates.title/).textContent).toMatch(/0$/));
  });

  it("drops counts it can no longer keep current when the overview opens", async () => {
    renderPage("/pending-updates?tab=trips");
    await waitFor(() => expect(tab(/inbox.tripSuggestions.title/).textContent).toMatch(/3$/));
    await userEvent.click(tab(/inbox.workspace.title/));
    await waitFor(() => expect(tab(/inbox.tripSuggestions.title/).textContent).not.toMatch(/\d/));
  });
});
