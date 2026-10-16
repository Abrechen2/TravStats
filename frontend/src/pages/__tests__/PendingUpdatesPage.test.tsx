import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import PendingUpdatesPage from "../PendingUpdatesPage";
import { dataQualityFlagsApi } from "../../lib/api/dataQualityFlags";
import { tripSuggestionsApi } from "../../lib/api/tripSuggestions";
import { pendingUpdatesApi } from "../../lib/api/pendingUpdates";
import { photoJourneysApi } from "../../lib/api/photoJourneys";
import { tripsApi } from "../../lib/api/trips";
import { flag, suggestion } from "../../components/inbox/workspace/__tests__/fixtures";

/**
 * The Posteingang is ONE inbox (2026-10-16). Codex's workspace had been added
 * as an "overview" tab beside the six per-kind tabs it was meant to replace,
 * so every item had two cards with different actions. What the PAGE must hold:
 *
 * - two tabs — the inbox and shared trips — and no second card for any item;
 * - every old `?tab=<kind>` link still lands, on the inbox filtered to that
 *   kind; a kind that is switched off falls back to the whole inbox and loads
 *   nothing for it;
 * - each tab label carries a count only once it is measured: no "0" while the
 *   inbox loads, and "+?" when a kind failed rather than a number that lies.
 */

const visible = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/api/sharing", () => ({
  sharingApi: {
    tripSharing: vi.fn().mockResolvedValue({
      groupId: null,
      people: [],
      linkableUsers: [],
      bookingTotals: [],
    }),
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
// Its own list on mount; it has its own tests.
vi.mock("../../components/inbox/UnfiledDocumentsSection", () => ({
  default: () => <div data-testid="unfiled-documents-stub" />,
}));
vi.mock("../../components/GlobeLoader", () => ({ GlobeLoader: () => null }));
vi.mock("../../lib/api/dataQualityFlags", () => ({
  dataQualityFlagsApi: { getAll: vi.fn(), run: vi.fn(), dismiss: vi.fn(), resolve: vi.fn() },
}));
vi.mock("../../lib/api/tripSuggestions", () => ({
  tripSuggestionsApi: { list: vi.fn(), accept: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../lib/api/pendingUpdates", () => ({
  pendingUpdatesApi: { getAll: vi.fn(), apply: vi.fn(), update: vi.fn(), reject: vi.fn() },
}));
vi.mock("../../lib/api/photoJourneys", () => ({
  photoJourneysApi: { list: vi.fn() },
  photoJourneyPreviewUrl: () => "",
}));
vi.mock("../../lib/api/trips", () => ({ tripsApi: { getAll: vi.fn() } }));
vi.mock("../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { list: vi.fn(async () => []), choices: vi.fn() },
}));
vi.mock("../../lib/api/immich", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/immich")>()),
  immichApi: { getSettings: vi.fn().mockResolvedValue({ hasAccess: false }) },
}));

const INBOX_TAB = /inbox\.workspace\.title/;
const SHARING_TAB = /sharing:inbox\.title/;
const W = "dataQuality:inbox.workspace";

function renderPage(initialEntry = "/pending-updates"): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PendingUpdatesPage />
    </MemoryRouter>
  );
}
const pressedFilter = () =>
  within(screen.getByRole("group", { name: `${W}.filterLabel` }))
    .getAllByRole("button")
    .find((button) => button.getAttribute("aria-pressed") === "true");

describe("PendingUpdatesPage — one inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visible.value = true;
    vi.mocked(dataQualityFlagsApi.getAll).mockResolvedValue({ flags: [flag], count: 1 });
    vi.mocked(tripSuggestionsApi.list).mockResolvedValue({
      suggestions: [suggestion],
      total: 1,
      home: "history",
      truncated: false,
    });
    vi.mocked(pendingUpdatesApi.getAll).mockResolvedValue({ updates: [], count: 0 });
    vi.mocked(photoJourneysApi.list).mockResolvedValue([]);
    vi.mocked(tripsApi.getAll).mockResolvedValue([]);
  });

  it("has two tabs, the inbox open by default, and one card per item", async () => {
    renderPage();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: INBOX_TAB })).toHaveAttribute("aria-selected", "true");
    await screen.findByText(`${W}.shown`);
    // The trip proposal has exactly one accept, the question one resolve.
    expect(screen.getAllByRole("button", { name: `${W}.acceptProposal.new_trip` })).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "dataQuality:flag.actions.resolve.label" })
    ).toHaveLength(1);
  });

  it("labels the inbox with no number while it loads, then the measured one", async () => {
    let release!: () => void;
    vi.mocked(dataQualityFlagsApi.getAll).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ flags: [flag], count: 1 });
        })
    );
    renderPage();
    const tab = screen.getByRole("tab", { name: INBOX_TAB });
    expect(within(tab).queryByText(/\d/)).toBeNull();
    release();
    await waitFor(() => expect(within(tab).getByText("2")).toBeInTheDocument());
  });

  it("says the count is a lower bound when a kind failed to load", async () => {
    vi.mocked(pendingUpdatesApi.getAll).mockRejectedValue(new Error("offline"));
    renderPage();
    const tab = screen.getByRole("tab", { name: INBOX_TAB });
    await waitFor(() => expect(within(tab).getByText("2+?")).toBeInTheDocument());
  });

  it.each([
    ["review", "review"],
    ["trips", "trips"],
    ["updates", "updates"],
    ["dawarich", "dawarich"],
    ["photos", "photos"],
  ])("lands an old ?tab=%s link on the inbox filtered to that kind", async (tab, kind) => {
    renderPage(`/pending-updates?tab=${tab}`);
    expect(screen.getByRole("tab", { name: INBOX_TAB })).toHaveAttribute("aria-selected", "true");
    await screen.findByText(`${W}.shown`);
    expect(pressedFilter()).toHaveAccessibleName(new RegExp(`sources\\.${kind} `));
  });

  it("falls back to the whole inbox for ?tab=photos when photos are off, and loads none", async () => {
    visible.value = false;
    renderPage("/pending-updates?tab=photos");
    await screen.findByText(`${W}.shown`);
    expect(pressedFilter()).toHaveAccessibleName(/sources\.all /);
    expect(photoJourneysApi.list).not.toHaveBeenCalled();
  });

  it("opens shared trips from the URL, counts them, and switches back to the inbox", async () => {
    renderPage("/pending-updates?tab=sharing");
    const sharing = screen.getByRole("tab", { name: SHARING_TAB });
    expect(sharing).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(within(sharing).getByText("0")).toBeInTheDocument());
    // The inbox is not loaded for a visit that never opens it.
    expect(dataQualityFlagsApi.getAll).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("tab", { name: INBOX_TAB }));
    await waitFor(() => expect(dataQualityFlagsApi.getAll).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: INBOX_TAB })).toHaveAttribute("aria-selected", "true");
  });
});
