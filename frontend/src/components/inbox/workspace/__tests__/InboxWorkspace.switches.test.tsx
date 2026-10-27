import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import InboxWorkspace from "../InboxWorkspace";
import { dataQualityFlagsApi } from "../../../../lib/api/dataQualityFlags";
import { tripSuggestionsApi } from "../../../../lib/api/tripSuggestions";
import { pendingUpdatesApi } from "../../../../lib/api/pendingUpdates";
import { tripsApi } from "../../../../lib/api/trips";
import { dawarichStaysApi } from "../../../../lib/api/dawarichStays";
import { useSuggestionSwitchesStore } from "../../../../store/suggestionSwitchesStore";
import { flag, suggestion } from "./fixtures";

/**
 * The account's suggestion switches in the inbox (forgejo#306): a switched-off
 * kind has no section and is not even asked for, and a flip shows at once —
 * no reload.
 */

vi.mock("../../../../lib/api/dataQualityFlags", () => ({
  dataQualityFlagsApi: { getAll: vi.fn(), run: vi.fn(), dismiss: vi.fn(), resolve: vi.fn() },
}));
vi.mock("../../../../lib/api/tripSuggestions", () => ({
  tripSuggestionsApi: { list: vi.fn(), accept: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../../../lib/api/pendingUpdates", () => ({
  pendingUpdatesApi: { getAll: vi.fn(), apply: vi.fn(), update: vi.fn(), reject: vi.fn() },
}));
vi.mock("../../../../lib/api/photoJourneys", () => ({
  photoJourneysApi: { list: vi.fn() },
  photoJourneyPreviewUrl: () => "",
}));
vi.mock("../../../../lib/api/trips", () => ({ tripsApi: { getAll: vi.fn() } }));
vi.mock("../../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { list: vi.fn(), choices: vi.fn() },
}));
vi.mock("../../../Settings/DawarichStayScanCard", () => ({
  default: () => <p>gps-scan-card</p>,
}));
vi.mock("../../../GlobeLoader", () => ({ GlobeLoader: () => null }));

const W = "dataQuality:inbox.workspace";

const filterGroup = () => screen.getByRole("group", { name: `${W}.filterLabel` });
const hasFilter = (kind: string) =>
  within(filterGroup()).queryByRole("button", {
    name: new RegExp(`^${W}\\.sources\\.${kind} `),
  }) !== null;

async function mount() {
  render(
    <MemoryRouter initialEntries={["/pending-updates"]}>
      <InboxWorkspace photosVisible={false} />
    </MemoryRouter>
  );
  await screen.findByText(`${W}.shown`);
}

describe("inbox suggestion switches", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(dataQualityFlagsApi.getAll).mockResolvedValue({ flags: [], count: 0 });
    vi.mocked(tripSuggestionsApi.list).mockResolvedValue({
      suggestions: [suggestion],
      total: 1,
      home: "history",
      truncated: false,
    });
    vi.mocked(pendingUpdatesApi.getAll).mockResolvedValue({ updates: [], count: 0 });
    vi.mocked(tripsApi.getAll).mockResolvedValue([]);
    vi.mocked(dawarichStaysApi.list).mockResolvedValue([]);
    useSuggestionSwitchesStore.setState({ trips: true, stays: true });
  });

  it("both on: both sections, both kinds asked for", async () => {
    await mount();
    expect(hasFilter("trips")).toBe(true);
    expect(hasFilter("dawarich")).toBe(true);
    expect(tripSuggestionsApi.list).toHaveBeenCalled();
    expect(dawarichStaysApi.list).toHaveBeenCalled();
  });

  it("trips off: no trips section and no request for them", async () => {
    useSuggestionSwitchesStore.setState({ trips: false });
    // One open question keeps the inbox non-empty, so its filters are drawn
    // (an inbox with nothing at all shows one message, not the filters).
    vi.mocked(dataQualityFlagsApi.getAll).mockResolvedValue({ flags: [flag], count: 1 });
    await mount();
    expect(hasFilter("trips")).toBe(false);
    expect(hasFilter("dawarich")).toBe(true);
    expect(tripSuggestionsApi.list).not.toHaveBeenCalled();
    expect(screen.queryByText(suggestion.members[0].label)).toBeNull();
  });

  it("stays off: no GPS section and no request for stays", async () => {
    useSuggestionSwitchesStore.setState({ stays: false });
    await mount();
    expect(hasFilter("dawarich")).toBe(false);
    expect(hasFilter("trips")).toBe(true);
    expect(dawarichStaysApi.list).not.toHaveBeenCalled();
  });

  it("a flip while the inbox is open drops the kind without a reload", async () => {
    await mount();
    expect(hasFilter("trips")).toBe(true);
    act(() => useSuggestionSwitchesStore.setState({ trips: false }));
    await waitFor(() => expect(hasFilter("trips")).toBe(false));
  });
});
