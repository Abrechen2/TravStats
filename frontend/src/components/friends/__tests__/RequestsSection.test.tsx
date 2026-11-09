import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RequestsSection from "../RequestsSection";
import { friendsApi } from "../../../lib/api/friends";
import type { FriendRequest } from "../../../lib/friends/types";
import type { OwnAdmission } from "../../../lib/comparison/types";
import { ALL_ON, friendOf, person } from "./fixtures";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { origin?: string }) => (o?.origin ? `${k}|${o.origin}` : k),
    i18n: {
      language: "de",
      exists: (k: string) => k === "comparison:error.COMPARISON_INVITE_INVALID",
    },
  }),
}));
vi.mock("../../Settings/ConnectionSwitchesForm", () => ({
  default: () => <div data-testid="switches-form" />,
  theirsSummary: () => "plans",
}));
vi.mock("../../../lib/api/friends", async (original) => ({
  ...(await original<typeof import("../../../lib/api/friends")>()),
  friendsApi: {
    accept: vi.fn().mockResolvedValue({}),
    decline: vi.fn().mockResolvedValue({}),
  },
}));

const request: FriendRequest = {
  ...friendOf(person("1", "Ben"), { state: "pending_in", theirs: ALL_ON, confirmedAt: null }),
  switches: ALL_ON,
  proposed: null,
  viaLink: false,
  fingerprint: null,
  requestedAt: "2026-11-07T00:00:00.000Z",
};
const admission = (
  status: OwnAdmission["status"],
  failureReason: string | null = null
): OwnAdmission => ({
  id: `a-${status}`,
  origin: "https://far.example",
  fingerprint: "f".repeat(64),
  status,
  failureReason,
  createdAt: "2026-11-07T00:00:00.000Z",
  expiresAt: "2026-11-21T00:00:00.000Z",
});

describe("RequestsSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when there is nothing to answer", () => {
    const { container } = render(
      <RequestsSection requests={[]} admissions={[admission("approved")]} onChanged={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("accepts a request with the reader's own switches, everything on by default", async () => {
    const onChanged = vi.fn();
    render(<RequestsSection requests={[request]} admissions={[]} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "requests.accept" }));
    expect(screen.getByTestId("switches-form")).toBeInTheDocument();
    expect(friendsApi.accept).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole("button", { name: "requests.accept" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(friendsApi.accept).toHaveBeenCalledWith("local:1", ALL_ON));
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows a redeemed invitation link with the redeemer's server and fingerprint, and says declining burns it", () => {
    render(
      <RequestsSection
        requests={[
          {
            ...request,
            key: "remote:9",
            origin: "https://far.example",
            viaLink: true,
            fingerprint: "ab12",
          },
        ]}
        admissions={[]}
        onChanged={vi.fn()}
      />
    );
    expect(screen.getByText("friend.requests.viaLink")).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/far\.example/)).toBeInTheDocument();
    expect(screen.getByText(/friend\.requests\.fingerprint/)).toBeInTheDocument();
    expect(screen.getByText("friend.requests.declineBurns")).toBeInTheDocument();
  });

  it("declines through /friends, by key", async () => {
    const onChanged = vi.fn();
    render(<RequestsSection requests={[request]} admissions={[]} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "requests.decline" }));
    await waitFor(() => expect(friendsApi.decline).toHaveBeenCalledWith("local:1"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("says why a decline failed instead of swallowing it", async () => {
    vi.mocked(friendsApi.decline).mockRejectedValueOnce(new Error("boom"));
    render(<RequestsSection requests={[request]} admissions={[]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "requests.decline" }));
    expect((await screen.findByRole("alert")).textContent).toBe("error.unknown");
  });

  it("reads each admission state as its own sentence and shows a reason only when it has copy", () => {
    render(
      <RequestsSection
        requests={[]}
        admissions={[
          admission("pending"),
          admission("sent"),
          admission("failed", "COMPARISON_INVITE_INVALID"),
          admission("expired", "some English prose from a server"),
        ]}
        onChanged={vi.fn()}
      />
    );
    expect(screen.getByText("friends.admission.pending|https://far.example")).toBeInTheDocument();
    expect(screen.getByText("friends.admission.sent|https://far.example")).toBeInTheDocument();
    expect(
      screen.getByText(
        "friends.admission.failed|https://far.example – error.COMPARISON_INVITE_INVALID"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("friends.admission.expired|https://far.example")).toBeInTheDocument();
    expect(screen.queryByText(/English prose/)).toBeNull();
  });
});
