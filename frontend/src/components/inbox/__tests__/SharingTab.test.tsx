import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import SharingTab from "../SharingTab";
import { sharingApi } from "../../../lib/api/sharing";
import type { ShareConsent, ShareNotice } from "../../../types/sharing";

/**
 * The "Geteilte Reisen" inbox tab (trip sharing S1): a consent request must be
 * answerable, its count must reach the tab label, and every failure must be
 * said — a failed load is not an empty inbox, a failed answer keeps the card.
 */

vi.mock("../../../lib/api/sharing", () => ({
  sharingApi: {
    listConsents: vi.fn(),
    listNotices: vi.fn(),
    answerConsent: vi.fn(),
    markNoticeRead: vi.fn(),
  },
}));

// Trips offered from other servers: off unless a test turns them on.
const remote = vi.hoisted(() => ({
  status: vi.fn(async () => ({ available: false })),
  listOffers: vi.fn(async () => [] as unknown[]),
}));
vi.mock("../../../lib/api/sharingRemote", () => ({ sharingRemoteApi: remote }));
// Local link proposals load beside the offers; none here (Codex P1, 2026-11-27).
vi.mock("../../../lib/api/sharingLink", () => ({
  sharingLinkApi: { receivedProposals: vi.fn().mockResolvedValue([]) },
}));

// The real globe paints a canvas jsdom cannot; keep its status semantics.
vi.mock("../../GlobeLoader", () => ({
  GlobeLoader: ({ label }: { label?: string }) => <div role="status" aria-label={label} />,
}));

const addToast = vi.fn();
const toastState = { addToast: (...args: unknown[]) => addToast(...args) };
vi.mock("../../../store/pageErrorStore", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  reportPageError: (message: string, tone = "error") => addToast(tone, message),
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));

const api = vi.mocked(sharingApi);

const request: ShareConsent = {
  id: "c1",
  status: "pending",
  createdAt: "2026-10-09T10:00:00.000Z",
  decidedAt: null,
  person: { id: "u-anna", username: "anna", displayName: "Anna" },
};

const notice: ShareNotice = {
  id: "n1",
  kind: "shared",
  entityType: "trip",
  entityKey: "trip-of-reader",
  after: { tripName: "Lissabon" },
  createdAt: "2026-10-09T10:05:00.000Z",
  readAt: null,
  undoneAt: null,
  actor: { id: "u-anna", username: "anna", displayName: "Anna" },
  remoteActor: null,
  changes: [],
};

function renderTab(onCount = vi.fn()) {
  render(
    <MemoryRouter>
      <SharingTab onCount={onCount} />
    </MemoryRouter>
  );
  return onCount;
}

describe("SharingTab — loading", () => {
  it("shows the globe loader, named, until the first answer", () => {
    api.listConsents.mockReturnValue(new Promise(() => {}));
    api.listNotices.mockReturnValue(new Promise(() => {}));
    renderTab();
    expect(screen.getByRole("status", { name: "common:loading.default" })).toBeTruthy();
  });
});

describe("SharingTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listConsents.mockResolvedValue({
      incoming: [request, { ...request, id: "c-old", status: "accepted" }],
      outgoing: [],
    });
    api.listNotices.mockResolvedValue([notice, { ...notice, id: "n-old", readAt: "x" }]);
  });

  it("shows a pending request and an unread notice, and counts exactly those", async () => {
    const onCount = renderTab();
    expect(await screen.findAllByTestId("share-request")).toHaveLength(1);
    expect(screen.getAllByTestId("share-notice")).toHaveLength(2);
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(2));
    expect(screen.getAllByRole("link", { name: "sharing:inbox.notices.open" })[0]).toHaveProperty(
      "href",
      expect.stringContaining("/trips/trip-of-reader")
    );
  });

  it("lists trips offered from other servers in the inbox and counts them (2026-11-24)", async () => {
    remote.status.mockResolvedValueOnce({ available: true });
    remote.listOffers.mockResolvedValue([
      {
        id: "o1",
        from: { displayName: "Ben", username: "ben", origin: "https://b.example" },
        trip: { name: "Island", startDay: null, endDay: null },
        roster: [],
        counts: {},
        offeredAt: "2026-11-24T10:00:00.000Z",
      },
    ]);
    const onCount = renderTab();
    expect(await screen.findByText(/sharing:remote.offers.row/)).toBeTruthy();
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(3));
    remote.listOffers.mockResolvedValue([]);
  });

  it("accepts a request and reloads", async () => {
    api.answerConsent.mockResolvedValue({ ...request, status: "accepted" });
    renderTab();
    const card = (await screen.findAllByTestId("share-request"))[0];
    api.listConsents.mockResolvedValue({ incoming: [], outgoing: [] });
    await userEvent.click(
      within(card).getByRole("button", { name: "sharing:inbox.requests.accept" })
    );
    expect(api.answerConsent).toHaveBeenCalledWith("c1", "accept");
    await waitFor(() => expect(screen.queryByTestId("share-request")).toBeNull());
    expect(addToast).toHaveBeenCalledWith("success", "sharing:inbox.messages.accepted");
  });

  it("says why an answer failed, by the server's code", async () => {
    api.answerConsent.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { code: "SHARE_CONSENT_NOT_PENDING" } },
    });
    renderTab();
    const card = (await screen.findAllByTestId("share-request"))[0];
    await userEvent.click(
      within(card).getByRole("button", { name: "sharing:inbox.requests.decline" })
    );
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "sharing:errors.notPending")
    );
  });

  it("shows a failed load as a failure with a retry, never as an empty inbox", async () => {
    api.listNotices.mockRejectedValue(new Error("down"));
    const onCount = renderTab();
    expect(await screen.findByText("sharing:inbox.errors.loadFailed")).toBeTruthy();
    expect(screen.queryByText("sharing:inbox.empty.title")).toBeNull();
    expect(onCount).not.toHaveBeenCalled();
    api.listNotices.mockResolvedValue([]);
    await userEvent.click(screen.getByRole("button", { name: "sharing:inbox.errors.retry" }));
    expect(await screen.findAllByTestId("share-request")).toHaveLength(1);
  });

  it("marks a notice read", async () => {
    api.markNoticeRead.mockResolvedValue(undefined);
    renderTab();
    const [first] = await screen.findAllByTestId("share-notice");
    await userEvent.click(
      within(first).getByRole("button", { name: "sharing:inbox.notices.markRead" })
    );
    expect(api.markNoticeRead).toHaveBeenCalledWith("n1");
  });
});
