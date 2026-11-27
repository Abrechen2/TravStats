import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
// SharingTab asks whether cross-server sharing is on (fix/shared-trip-companions).
vi.mock("../../lib/api/sharingRemote", () => ({
  sharingRemoteApi: { status: vi.fn().mockResolvedValue({ available: false }) },
}));
// ...and loads local link proposals beside the offers; none here (feat/share-bulk-link).
vi.mock("../../lib/api/sharingLink", () => ({
  sharingLinkApi: { receivedProposals: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../components/inbox/usePhotoJourneysVisible", () => ({
  usePhotoJourneysVisible: () => visible.value,
}));
vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-bar-stub" />,
}));
// Its own list on mount; it has its own tests.
// The mail-intake cards load their own list; they have their own tests.
vi.mock("../../components/inbox/MailIntakeSection", () => ({
  default: () => null,
}));
vi.mock("../../components/inbox/MailboxScanSection", () => ({
  default: () => null,
}));
const waiting = vi.hoisted(() => ({ documents: 0, plugins: 0 }));
vi.mock("../../components/inbox/UnfiledDocumentsSection", async () => {
  const { useEffect } = await import("react");
  return {
    default: function UnfiledStub({ onCount }: { onCount?: (n: number | null) => void }) {
      useEffect(() => onCount?.(waiting.documents), [onCount]);
      return <div data-testid="unfiled-documents-stub" />;
    },
  };
});
vi.mock("../../components/inbox/plugins/PluginsTab", async () => {
  const { useEffect } = await import("react");
  return {
    default: function PluginsStub({ onCount }: { onCount?: (n: number | null) => void }) {
      useEffect(() => onCount?.(waiting.plugins), [onCount]);
      return <div data-testid="plugins-tab-stub" />;
    },
  };
});
// Place captures load their own list on mount; they have their own tests.
vi.mock("../../components/inbox/PlaceCapturesSection", () => ({
  default: () => <div data-testid="place-captures-stub" />,
}));
// Document link suggestions load their own list on mount; they have their own tests.
vi.mock("../../components/inbox/DocumentLinkSuggestionsSection", () => ({
  default: () => <div data-testid="document-link-suggestions-stub" />,
}));
// Memory/record contradictions load their own list on mount; they have their own tests.
vi.mock("../../components/inbox/ProvenanceNoticesSection", () => ({
  default: () => <div data-testid="provenance-notices-stub" />,
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
  dawarichStaysApi: {
    list: vi.fn(async () => []),
    listPage: vi.fn(async () => ({ rows: [], truncated: false })),
    choices: vi.fn(),
  },
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
    waiting.documents = 0;
    waiting.plugins = 0;
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

  it("has its tabs, the inbox open by default, and one card per item", async () => {
    renderPage();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("tab", { name: INBOX_TAB })).toHaveAttribute("aria-selected", "true");
    await screen.findByText(`${W}.shown`);
    // The trip proposal has exactly one accept, the question one resolve.
    expect(screen.getAllByRole("button", { name: `${W}.acceptProposal.new_trip` })).toHaveLength(1);
    fireEvent.click(screen.getByTestId("review-card-menu"));
    expect(
      screen.getAllByRole("menuitem", { name: /dataQuality:flag.actions.resolve.label/ })
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

  describe("documents and plugins have their own tabs (owner 2026-11-26)", () => {
    const DOCS_TAB = /inbox\.tabs\.documents/;
    const PLUGINS_TAB = /inbox\.tabs\.plugins/;

    it("the overview holds no document section, only a one-line link while documents wait", async () => {
      waiting.documents = 3;
      renderPage();
      await screen.findByText(`${W}.shown`);
      // The section lives in the documents tab's panel, hidden on the overview.
      expect(screen.getByTestId("unfiled-documents-stub").closest("[hidden]")).not.toBeNull();
      expect(screen.getByTestId("inbox-documents-link")).toHaveTextContent(
        "dataQuality:inbox.tabs.documentsLink"
      );
    });

    it("no link when nothing waits", async () => {
      renderPage();
      await screen.findByText(`${W}.shown`);
      expect(screen.queryByTestId("inbox-documents-link")).toBeNull();
    });

    it("carries the waiting documents and plugin items as tab badges", async () => {
      waiting.documents = 3;
      waiting.plugins = 5;
      renderPage();
      await waitFor(() =>
        expect(
          within(screen.getByRole("tab", { name: DOCS_TAB })).getByText("3")
        ).toBeInTheDocument()
      );
      expect(
        within(screen.getByRole("tab", { name: PLUGINS_TAB })).getByText("5")
      ).toBeInTheDocument();
    });

    it("deep-links ?tab=documents and ?tab=plugins", async () => {
      renderPage("/pending-updates?tab=documents");
      expect(screen.getByRole("tab", { name: DOCS_TAB })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("unfiled-documents-stub").closest("[hidden]")).toBeNull();
      await userEvent.click(screen.getByRole("tab", { name: PLUGINS_TAB }));
      expect(screen.getByRole("tab", { name: PLUGINS_TAB })).toHaveAttribute(
        "aria-selected",
        "true"
      );
      expect(screen.getByTestId("plugins-tab-stub").closest("[hidden]")).toBeNull();
    });
  });
});
