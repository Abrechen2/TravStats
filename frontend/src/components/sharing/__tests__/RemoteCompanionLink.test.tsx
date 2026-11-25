import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  linkRemoteCompanion: vi.fn(),
  markNotSameRemote: vi.fn(),
  unlinkCompanion: vi.fn(),
}));
vi.mock("../../../lib/api/sharing", () => ({ sharingApi: api }));

import RemoteCompanionLink from "../RemoteCompanionLink";
import type { RemoteMember } from "../../../types/sharingRemote";

const member = (over: Partial<RemoteMember> = {}): RemoteMember =>
  ({
    id: "m1",
    remoteId: "r1",
    displayName: "Norbert Wittke",
    username: "norbert",
    origin: "https://trav.example",
    state: "active",
    stateReason: null,
    stateSince: "2026-11-24T00:00:00Z",
    delivery: { state: "delivered", stateSince: null, reason: null, field: null, label: null },
    companion: null,
    nameMatches: [{ id: "c1", name: "Norbert Wittke", onTrip: true }],
    ...over,
  }) as RemoteMember;

const run = vi.fn(async (action: () => Promise<void>) => action());

describe("RemoteCompanionLink — one person, one companion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a name match is only a question: nothing is linked until the reader says yes", async () => {
    render(<RemoteCompanionLink tripId="t1" member={member()} busy={false} run={run} />);
    expect(screen.getByTestId("remote-companion-question")).toBeInTheDocument();
    expect(api.linkRemoteCompanion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "sharing:remote.trip.companion.yes" }));
    await waitFor(() => expect(api.linkRemoteCompanion).toHaveBeenCalledWith("c1", "r1"));
  });

  it("'no' remembers the answer instead of linking", async () => {
    render(<RemoteCompanionLink tripId="t1" member={member()} busy={false} run={run} />);
    fireEvent.click(screen.getByRole("button", { name: "sharing:remote.trip.companion.no" }));
    await waitFor(() => expect(api.markNotSameRemote).toHaveBeenCalledWith("c1", "r1"));
    expect(api.linkRemoteCompanion).not.toHaveBeenCalled();
  });

  it("a linked person shows the companion and can be unlinked", async () => {
    render(
      <RemoteCompanionLink
        tripId="t1"
        member={member({ companion: { id: "c1", name: "Norbert" }, nameMatches: [] })}
        busy={false}
        run={run}
      />
    );
    expect(screen.queryByTestId("remote-companion-question")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "sharing:remote.trip.companion.unlink" }));
    await waitFor(() => expect(api.unlinkCompanion).toHaveBeenCalledWith("c1"));
  });
});
