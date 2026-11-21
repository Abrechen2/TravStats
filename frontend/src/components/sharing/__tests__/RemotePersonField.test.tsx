import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RemotePersonField, { parsePersonAddress } from "../RemotePersonField";
import { sharingRemoteApi } from "../../../lib/api/sharingRemote";
import { sharingConnectionsApi } from "../../../lib/api/sharingConnections";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, o?: { origin?: string; name?: string }) =>
      o?.origin ? `${key}|${o.name ?? ""}|${o.origin}` : key,
  }),
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../../../lib/api/sharingRemote", () => ({ sharingRemoteApi: { listServers: vi.fn() } }));
vi.mock("../../../lib/api/sharingConnections", () => ({
  sharingConnectionsApi: { list: vi.fn(), request: vi.fn() },
}));
const remote = vi.mocked(sharingRemoteApi);
const conns = vi.mocked(sharingConnectionsApi);
const P = "sharing:remote.trip.person";

async function submit(onOffer = vi.fn().mockResolvedValue(true), text = "ben@far.example.org") {
  const onCreateCode = vi.fn();
  render(<RemotePersonField busy={false} onOffer={onOffer} onCreateCode={onCreateCode} />);
  await userEvent.type(screen.getByLabelText(`${P}.label`), text);
  await userEvent.click(screen.getByText(`${P}.submit`));
  return { onOffer, onCreateCode };
}

beforeEach(() => {
  vi.clearAllMocks();
  remote.listServers.mockResolvedValue([{ origin: "https://far.example.org" }] as never);
  conns.list.mockResolvedValue([]);
});

describe("parsePersonAddress", () => {
  it("splits at the last @ and defaults to https", () => {
    expect(parsePersonAddress("ben@Far.Example.org/")).toEqual({
      origin: "https://far.example.org",
      username: "ben",
    });
    expect(parsePersonAddress("ben")).toBeNull();
    expect(parsePersonAddress("@far.example.org")).toBeNull();
  });
});

describe("RemotePersonField — one field for a person on another server", () => {
  it("offers the trip at once when the connection is confirmed", async () => {
    conns.list.mockResolvedValue([
      { origin: "https://far.example.org", username: "ben", state: "active" },
    ] as never);
    const { onOffer } = await submit();
    await waitFor(() => expect(onOffer).toHaveBeenCalledWith("https://far.example.org", "ben"));
    expect(conns.request).not.toHaveBeenCalled();
  });

  it("requests the connection (trip offers only) when there is none, and says so", async () => {
    conns.request.mockResolvedValue({} as never);
    const { onOffer } = await submit();
    await screen.findByText(`${P}.requested|ben|https://far.example.org`);
    expect(conns.request).toHaveBeenCalledWith("https://far.example.org", "ben", {
      plans: false,
      stats: "off",
      achievements: false,
      leaderboard: false,
      tripOffers: true,
    });
    expect(onOffer).not.toHaveBeenCalled();
  });

  it("says an open request is still open instead of asking again", async () => {
    conns.list.mockResolvedValue([
      { origin: "https://far.example.org", username: "ben", state: "pending_out" },
    ] as never);
    await submit();
    await screen.findByText(`${P}.waiting|ben|https://far.example.org`);
    expect(conns.request).not.toHaveBeenCalled();
  });

  it("names a server that is not admitted yet, and asks nothing of it", async () => {
    const { onOffer } = await submit(undefined, "ben@elsewhere.example.org");
    await screen.findByText(`${P}.serverNotConnected||https://elsewhere.example.org`);
    expect(conns.request).not.toHaveBeenCalled();
    expect(onOffer).not.toHaveBeenCalled();
  });

  it("shows a failed request instead of swallowing it", async () => {
    conns.request.mockRejectedValue({ response: { status: 502, data: {} } });
    await submit();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("rejects an entry that is not user@server", async () => {
    await submit(undefined, "just-a-name");
    expect((await screen.findByRole("alert")).textContent).toBe(`${P}.invalid`);
  });

  it("keeps the invitation code behind a small link in the help text", async () => {
    const { onCreateCode } = await submit(undefined, "x");
    await userEvent.click(screen.getByText(`${P}.codeLink`));
    expect(onCreateCode).toHaveBeenCalled();
  });
});
