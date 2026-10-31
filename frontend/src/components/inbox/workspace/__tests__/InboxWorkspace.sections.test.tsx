import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";

import InboxWorkspace from "../InboxWorkspace";
import { dataQualityFlagsApi } from "../../../../lib/api/dataQualityFlags";
import { tripSuggestionsApi } from "../../../../lib/api/tripSuggestions";
import { pendingUpdatesApi } from "../../../../lib/api/pendingUpdates";
import { tripsApi } from "../../../../lib/api/trips";
import { dawarichStaysApi } from "../../../../lib/api/dawarichStays";
import { flag, suggestion, update } from "./fixtures";

/**
 * The one inbox's sections (2026-10-16): the old per-kind tabs became the
 * workspace's filter, so their links, counts, empty states and history have to
 * hold there. Every count is measured or absent — never a zero nobody counted.
 *
 * The global test setup makes `t` return its key.
 */

vi.mock("../../../../lib/api/dataQualityFlags", () => ({
  dataQualityFlagsApi: { getAll: vi.fn(), run: vi.fn(), dismiss: vi.fn(), resolve: vi.fn() },
}));
vi.mock("../../../../lib/api/tripSuggestions", () => ({
  tripSuggestionsApi: { list: vi.fn(), accept: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../../../lib/api/pendingUpdates", () => ({
  pendingUpdatesApi: {
    getAll: vi.fn(),
    getStatistics: vi.fn(),
    apply: vi.fn(),
    update: vi.fn(),
    reject: vi.fn(),
  },
}));
vi.mock("../../../../lib/api/photoJourneys", () => ({
  photoJourneysApi: { list: vi.fn() },
  photoJourneyPreviewUrl: () => "",
}));
vi.mock("../../../../lib/api/trips", () => ({ tripsApi: { getAll: vi.fn() } }));
vi.mock("../../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { list: vi.fn(), listPage: vi.fn(), choices: vi.fn() },
}));
vi.mock("../../../Settings/DawarichStayScanCard", () => ({
  default: () => <p>gps-scan-card</p>,
}));
vi.mock("../../../GlobeLoader", () => ({ GlobeLoader: () => null }));

const addToast = vi.fn();
const toastState = { addToast: (...args: unknown[]) => addToast(...args) };
vi.mock("../../../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));

const W = "dataQuality:inbox.workspace";

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

async function mount(url = "/pending-updates", onCount = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <InboxWorkspace photosVisible={false} onCount={onCount} />
      <Location />
    </MemoryRouter>
  );
  await screen.findByText(`${W}.shown`);
  return onCount;
}
const filter = (kind: string) =>
  within(screen.getByRole("group", { name: `${W}.filterLabel` })).getByRole("button", {
    name: new RegExp(`^${W}\\.sources\\.${kind} `),
  });

describe("the inbox's sections", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(dataQualityFlagsApi.getAll).mockResolvedValue({ flags: [flag], count: 1 });
    vi.mocked(tripSuggestionsApi.list).mockResolvedValue({
      suggestions: [suggestion],
      total: 1,
      home: "history",
      truncated: false,
    });
    vi.mocked(pendingUpdatesApi.getAll).mockResolvedValue({ updates: [], count: 0 });
    vi.mocked(tripsApi.getAll).mockResolvedValue([]);
    vi.mocked(dawarichStaysApi.list).mockResolvedValue([]);
    vi.mocked(dawarichStaysApi.listPage).mockResolvedValue({ rows: [], truncated: false });
  });

  it("reports no count until it has measured one, then the measured count", async () => {
    let release!: () => void;
    vi.mocked(dataQualityFlagsApi.getAll).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ flags: [flag], count: 1 });
        })
    );
    const onCount = vi.fn();
    render(
      <MemoryRouter initialEntries={["/pending-updates"]}>
        <InboxWorkspace photosVisible={false} onCount={onCount} />
      </MemoryRouter>
    );
    expect(filter("all")).toHaveTextContent("(…)");
    expect(onCount).not.toHaveBeenCalledWith(expect.objectContaining({ count: 0 }));
    expect(onCount).toHaveBeenLastCalledWith(null);

    release();
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith({ count: 2, complete: true }));
    expect(filter("all")).toHaveTextContent("(2)");
    expect(filter("review")).toHaveTextContent("(1)");
    expect(filter("updates")).toHaveTextContent("(0)");
  });

  it("marks a count as a lower bound when a kind failed to load", async () => {
    vi.mocked(pendingUpdatesApi.getAll).mockRejectedValue(new Error("offline"));
    const onCount = await mount();
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith({ count: 2, complete: false }));
    expect(filter("updates")).toHaveTextContent("(0+?)");
    // A failed kind never shows its "nothing waiting" state.
    await userEvent.click(filter("updates"));
    expect(screen.queryByText("pendingUpdates:empty.title")).not.toBeInTheDocument();
  });

  it("opens the kind an old tab link names, and the filter writes it back", async () => {
    await mount("/pending-updates?tab=review");
    expect(filter("review")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(`${W}.acceptProposal.new_trip`)).not.toBeVisible();

    await userEvent.click(filter("trips"));
    expect(screen.getByTestId("location")).toHaveTextContent("?tab=trips");
    await userEvent.click(filter("all"));
    expect(screen.getByTestId("location")).toHaveTextContent("");
  });

  it("shows a kind's own empty state once that kind has loaded empty", async () => {
    await mount("/pending-updates?tab=updates");
    expect(screen.getByText("pendingUpdates:empty.title")).toBeInTheDocument();
    expect(screen.getByText("dataQuality:inbox.flightUpdates.description")).toBeInTheDocument();
    expect(screen.queryByText(`${W}.noMatches`)).not.toBeInTheDocument();
  });

  it("lands the GPS link (?tab=dawarich) on the stays, with their scan", async () => {
    await mount("/pending-updates?tab=dawarich");
    expect(filter("dawarich")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("gps-scan-card")).toBeInTheDocument();
    expect(screen.getByText("trips:dawarichStays.empty")).toBeInTheDocument();
  });

  it("answers 'I have corrected it' with a confirmation, and reloads", async () => {
    vi.mocked(dataQualityFlagsApi.resolve).mockResolvedValue({ success: true } as never);
    await mount("/pending-updates?tab=review");
    vi.mocked(dataQualityFlagsApi.getAll).mockResolvedValue({ flags: [], count: 0 });
    await userEvent.click(
      screen.getByRole("button", { name: "dataQuality:flag.actions.resolve.label" })
    );
    await waitFor(() => expect(dataQualityFlagsApi.resolve).toHaveBeenCalledWith("flag1"));
    expect(dataQualityFlagsApi.dismiss).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith("success", "dataQuality:inbox.messages.resolved");
    expect(await screen.findByText("dataQuality:inbox.review.empty.title")).toBeInTheDocument();
  });

  it("re-runs the checks for the whole inbox and reloads", async () => {
    vi.mocked(dataQualityFlagsApi.run).mockResolvedValue({
      opened: 0,
      reopened: 0,
      updated: 0,
      autoResolved: 0,
      open: 1,
    });
    await mount();
    await userEvent.click(screen.getByRole("button", { name: `${W}.recheckAll` }));
    await waitFor(() => expect(dataQualityFlagsApi.run).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(dataQualityFlagsApi.getAll).toHaveBeenCalledTimes(2));
  });

  it("looks back at answered questions without offering to change them", async () => {
    vi.mocked(dataQualityFlagsApi.getAll).mockImplementation(async (filters) =>
      filters?.status === "dismissed"
        ? { flags: [{ ...flag, id: "old", status: "dismissed" }], count: 1 }
        : filters?.status === "resolved"
          ? { flags: [], count: 0 }
          : { flags: [flag], count: 1 }
    );
    await mount("/pending-updates?tab=review");
    await userEvent.click(screen.getByRole("button", { name: `${W}.history.show` }));
    const history = await screen.findByRole("region", { name: `${W}.history.title` });
    expect(within(history).getByText("dataQuality:flag.status.dismissed")).toBeInTheDocument();
    expect(within(history).queryByRole("button")).toBeNull();
    expect(dataQualityFlagsApi.getAll).toHaveBeenCalledWith({ status: "dismissed" });
  });

  it("keeps the flight-update totals and answered updates in the history", async () => {
    vi.mocked(pendingUpdatesApi.getAll).mockImplementation(async (filters) =>
      filters?.status === "applied"
        ? { updates: [{ ...update, id: "u-old", status: "applied" }], count: 1 }
        : { updates: [], count: 0 }
    );
    vi.mocked(pendingUpdatesApi.getStatistics).mockResolvedValue({
      totalUpdates: 4,
      appliedUpdates: 1,
      rejectedUpdates: 2,
      editedUpdates: 0,
      expiredUpdates: 1,
      mostChangedFields: {},
      averageUpdateTime: null,
    });
    await mount("/pending-updates?tab=updates");
    await userEvent.click(screen.getByRole("button", { name: `${W}.history.show` }));
    const history = await screen.findByRole("region", { name: `${W}.history.title` });
    expect(within(history).getByText(/4 pendingUpdates:statistics\.total/)).toBeInTheDocument();
    expect(within(history).getByText("LH1171 LIS → FRA")).toBeInTheDocument();
    expect(within(history).getByText(/pendingUpdates:status\.applied/)).toBeInTheDocument();
  });

  it("says a failed history load failed, and retries it", async () => {
    vi.mocked(dawarichStaysApi.list).mockImplementation(async (status) => {
      if (status === "pending") return [];
      throw new Error("offline");
    });
    await mount("/pending-updates?tab=dawarich");
    await userEvent.click(screen.getByRole("button", { name: `${W}.history.show` }));
    expect(await screen.findByText(`${W}.history.failed`)).toBeInTheDocument();
    vi.mocked(dawarichStaysApi.list).mockResolvedValue([]);
    await userEvent.click(screen.getByRole("button", { name: `${W}.retry` }));
    expect(await screen.findByText(`${W}.history.empty`)).toBeInTheDocument();
  });
});
