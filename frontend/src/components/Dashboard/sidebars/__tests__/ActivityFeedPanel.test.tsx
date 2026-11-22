import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ActivityFeedPanel } from "../ActivityFeedPanel";
import { activityFeedApi, type ActivityFeedItem } from "../../../../lib/api/activityFeed";
import { DOMAIN_KEYS } from "../../../../shared/domains";

vi.mock("../../../../lib/api/activityFeed", async (orig) => ({
  ...(await orig<typeof import("../../../../lib/api/activityFeed")>()),
  activityFeedApi: { page: vi.fn() },
}));

const page = vi.mocked(activityFeedApi.page);

const item = (over: Partial<ActivityFeedItem> & { id: string }): ActivityFeedItem => ({
  key: `${over.domain ?? "flight"}:${over.id}`,
  domain: "flight",
  subjectId: over.id,
  title: `Title ${over.id}`,
  subtitle: null,
  place: null,
  date: { date: "2026-05-01", zone: "Europe/Berlin", precision: "day" },
  sortAt: "2026-05-01T08:00:00.000Z",
  planned: false,
  point: { lat: 1, lon: 2 },
  bbox: null,
  path: `/flights/${over.id}`,
  ...over,
});

const FEED_DOMAINS = DOMAIN_KEYS;

const renderPanel = (over: Partial<Parameters<typeof ActivityFeedPanel>[0]> = {}) =>
  render(
    <MemoryRouter>
      <ActivityFeedPanel
        isOpen
        onClose={vi.fn()}
        onSelect={vi.fn()}
        onDetails={vi.fn()}
        {...over}
      />
    </MemoryRouter>
  );

describe("ActivityFeedPanel", () => {
  beforeEach(() => page.mockReset());

  it("lists rows in the server's order, planned ones labelled, a date on every row", async () => {
    page.mockResolvedValue({
      items: [
        item({ id: "a", title: "Future flight", planned: true }),
        item({ id: "b", title: "Past flight" }),
      ],
      nextCursor: null,
      failed: [],
      domains: ["flight"],
    });
    renderPanel();
    const rows = await screen.findAllByTestId("activity-feed-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Future flight"),
      expect.stringContaining("Past flight"),
    ]);
    expect(screen.getAllByTestId("activity-feed-planned")).toHaveLength(1);
    expect(rows[0].textContent).toMatch(/sidebar\.planned/);
    expect(rows[1].textContent).not.toMatch(/sidebar\.planned/);
  });

  it("draws a row for every domain the feed answers, with its domain icon", async () => {
    page.mockResolvedValue({
      items: FEED_DOMAINS.map((domain) => item({ id: domain, domain, title: `T ${domain}` })),
      nextCursor: null,
      failed: [],
      domains: [],
    });
    renderPanel();
    const rows = await screen.findAllByTestId("activity-feed-row");
    expect(rows.map((r) => r.getAttribute("data-domain"))).toEqual(FEED_DOMAINS);
  });

  it("selects on a click anywhere on the row and opens details only from the arrow", async () => {
    page.mockResolvedValue({
      items: [item({ id: "a", title: "Row A", subtitle: "sub", place: "MUC" })],
      nextCursor: null,
      failed: [],
      domains: ["flight"],
    });
    const onSelect = vi.fn();
    const onDetails = vi.fn();
    renderPanel({ onSelect, onDetails });
    await userEvent.click(await screen.findByText("sub · MUC"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    expect(onDetails).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /details/i }));
    expect(onDetails).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("loads the next page by cursor and appends it", async () => {
    page
      .mockResolvedValueOnce({
        items: [item({ id: "a" })],
        nextCursor: "c1",
        failed: [],
        domains: ["flight"],
      })
      .mockResolvedValueOnce({
        items: [item({ id: "b" })],
        nextCursor: null,
        failed: [],
        domains: ["flight"],
      });
    renderPanel();
    await screen.findByText("Title a");
    await userEvent.click(screen.getByRole("button", { name: /feedLoadMore/ }));
    await screen.findByText("Title b");
    expect(page).toHaveBeenLastCalledWith({ cursor: "c1" });
    expect(screen.getAllByTestId("activity-feed-row")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /feedLoadMore/ })).toBeNull();
  });

  it("says so when the list cannot be loaded, and retries", async () => {
    page.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({
      items: [item({ id: "a" })],
      nextCursor: null,
      failed: [],
      domains: ["flight"],
    });
    renderPanel();
    expect(await screen.findByTestId("activity-feed-error")).toBeInTheDocument();
    // A failure is not an empty list.
    expect(screen.queryByText(/emptyActivity/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /feedRetry/ }));
    await screen.findByText("Title a");
    expect(screen.queryByTestId("activity-feed-error")).toBeNull();
  });

  it("names the domains whose reader failed instead of showing a thinner list silently", async () => {
    page.mockResolvedValue({
      items: [item({ id: "a" })],
      nextCursor: null,
      failed: ["rail"],
      domains: ["flight", "rail"],
    });
    renderPanel();
    expect(await screen.findByTestId("activity-feed-partial")).toHaveTextContent(/feedPartial/);
  });

  it("shows an empty state only for a successful empty answer", async () => {
    page.mockResolvedValue({ items: [], nextCursor: null, failed: [], domains: ["flight"] });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/emptyActivity/)).toBeInTheDocument());
  });

  it("marks a row with no coordinates as not on the map", async () => {
    page.mockResolvedValue({
      items: [item({ id: "a", point: null, bbox: null })],
      nextCursor: null,
      failed: [],
      domains: ["flight"],
    });
    renderPanel();
    const row = await screen.findByTestId("activity-feed-row");
    expect(row).toHaveAttribute("title", expect.stringMatching(/notOnMap/));
  });

  it("requests nothing while closed", () => {
    renderPanel({ isOpen: false });
    expect(page).not.toHaveBeenCalled();
  });
});
