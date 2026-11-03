import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ConnectionsSection from "../ConnectionsSection";
import { sharingConnectionsApi } from "../../../lib/api/sharingConnections";
import { sharingRemoteApi } from "../../../lib/api/sharingRemote";
import { NO_SWITCHES, type Connection } from "../../../types/sharingRemote";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    i18n: { language: "de" },
  }),
}));
vi.mock("../../sharing/RemotePlanInvitations", () => ({ default: () => null }));
vi.mock("../../../lib/api/sharingRemote", () => ({
  sharingRemoteApi: {
    status: vi.fn(),
    getFindable: vi.fn(),
    setFindable: vi.fn(),
    listServers: vi.fn(),
  },
}));
vi.mock("../../../lib/api/sharingConnections", () => ({
  sharingConnectionsApi: {
    list: vi.fn(),
    request: vi.fn(),
    accept: vi.fn(),
    decline: vi.fn(),
    setSwitches: vi.fn(),
    end: vi.fn(),
    achievements: vi.fn(),
  },
}));
const remote = vi.mocked(sharingRemoteApi);
const api = vi.mocked(sharingConnectionsApi);
const FAR = "https://far.example.org";

const connection = (over: Partial<Connection>): Connection => ({
  id: "c1",
  origin: FAR,
  username: "ben",
  displayName: "Ben",
  state: "active",
  mine: NO_SWITCHES,
  theirs: NO_SWITCHES,
  requestedAt: null,
  confirmedAt: null,
  revokedAt: null,
  ...over,
});
const refusal = (code: string) => ({ response: { data: { code } } });
const KEY = "sharing:remote.connections";

beforeEach(() => {
  vi.clearAllMocks();
  remote.status.mockResolvedValue({
    available: true,
    reason: null,
    origin: "https://me.example.org",
    peerAdmitted: true,
  });
  remote.getFindable.mockResolvedValue(false);
  remote.listServers.mockResolvedValue([{ origin: FAR }]);
  api.list.mockResolvedValue([]);
});

describe("Verbindungen", () => {
  it("draws nothing while trip sharing across servers is off", async () => {
    remote.status.mockResolvedValue({
      available: false,
      reason: "switch-off",
      origin: null,
      peerAdmitted: false,
    });
    const { container } = render(<ConnectionsSection />);
    await waitFor(() => expect(remote.status).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("asks with every switch off unless chosen, and says the request is on its way", async () => {
    api.request.mockResolvedValue(connection({ state: "pending_out" }));
    render(<ConnectionsSection />);
    await userEvent.type(await screen.findByLabelText(`${KEY}.request.username`), "ben");
    await userEvent.click(screen.getByRole("switch", { name: `${KEY}.switches.plans.label` }));
    await userEvent.click(screen.getByText(`${KEY}.request.submit`));
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(FAR, "ben", { ...NO_SWITCHES, plans: true })
    );
    await screen.findByText(new RegExp(`${KEY}.request.sent`));
    expect(await screen.findByText(`${KEY}.state.pending_out`)).toBeTruthy();
  });

  it("says why a request failed instead of drawing nothing", async () => {
    api.request.mockRejectedValue(refusal("SHARE_REMOTE_PEER_NOT_ADMITTED"));
    render(<ConnectionsSection />);
    await userEvent.type(await screen.findByLabelText(`${KEY}.request.username`), "x");
    await userEvent.click(screen.getByText(`${KEY}.request.submit`));
    await screen.findByText(/sharing:remote.errors.notAdmitted/);
  });

  it("lists a waiting request with what the asker gives and confirms with the switches chosen", async () => {
    api.list.mockResolvedValue([
      connection({ state: "pending_in", theirs: { ...NO_SWITCHES, stats: "overview" } }),
    ]);
    api.accept.mockResolvedValue(
      connection({ state: "active", mine: { ...NO_SWITCHES, tripOffers: true } })
    );
    render(<ConnectionsSection />);
    const request = await screen.findByTestId("connection-request");
    expect(request.textContent).toContain(`${KEY}.waiting.asks`);
    await userEvent.click(within(request).getByText(`${KEY}.waiting.confirm`));
    const dialog = await screen.findByRole("dialog");
    // The dialog shows what the person gives before the person sets their own switches.
    expect(dialog.textContent).toContain(`${KEY}.confirm.theirs`);
    expect(dialog.textContent).toContain("sharing:remote.connections.switches.stats.short");
    await userEvent.click(
      within(dialog).getByRole("switch", { name: `${KEY}.switches.tripOffers.label` })
    );
    await userEvent.click(within(dialog).getByText(`${KEY}.confirm.submit`));
    await waitFor(() =>
      expect(api.accept).toHaveBeenCalledWith("c1", { ...NO_SWITCHES, tripOffers: true })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByTestId("connection-request")).toBeNull();
  });

  it("keeps the dialog open and says so when the other server did not get the confirmation", async () => {
    api.list.mockResolvedValue([connection({ state: "pending_in" })]);
    api.accept.mockRejectedValue(refusal("SHARE_REMOTE_UNREACHABLE"));
    render(<ConnectionsSection />);
    await userEvent.click(await screen.findByText(`${KEY}.waiting.confirm`));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByText(`${KEY}.confirm.submit`));
    await within(dialog).findByText(/sharing:remote.errors.unreachable/);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByTestId("connection-request")).toBeTruthy();
  });

  it("declines a request, and shows a refusal of the decline", async () => {
    api.list.mockResolvedValue([connection({ state: "pending_in" })]);
    api.decline.mockRejectedValueOnce(refusal("SHARE_REMOTE_CONNECTION_STATE"));
    api.decline.mockResolvedValueOnce(connection({ state: "declined" }));
    render(<ConnectionsSection />);
    await userEvent.click(await screen.findByText(`${KEY}.waiting.decline`));
    await screen.findByText(/sharing:remote.errors.connectionState/);
    await userEvent.click(screen.getByText(`${KEY}.waiting.decline`));
    await waitFor(() => expect(api.decline).toHaveBeenCalledTimes(2));
    await screen.findByText(`${KEY}.state.declined`);
  });

  it("offers a pairing from before connections to be confirmed, saying nothing new starts before", async () => {
    api.list.mockResolvedValue([connection({ state: "reconfirm" })]);
    render(<ConnectionsSection />);
    const row = await screen.findByTestId("connection-request");
    expect(row.textContent).toContain(`${KEY}.waiting.reconfirm`);
  });

  it("changes what is given on an active connection and shows what the other side shares", async () => {
    api.list.mockResolvedValue([
      connection({ theirs: { ...NO_SWITCHES, plans: true, stats: "full" } }),
    ]);
    api.setSwitches.mockResolvedValue(connection({ mine: { ...NO_SWITCHES, achievements: true } }));
    render(<ConnectionsSection />);
    const row = await screen.findByTestId("connection");
    expect(row.textContent).toContain(`${KEY}.theirs`);
    await userEvent.click(within(row).getByText(`${KEY}.change`));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("switch", { name: `${KEY}.switches.achievements.label` })
    );
    await userEvent.click(within(dialog).getByText(`${KEY}.changeDialog.submit`));
    await waitFor(() =>
      expect(api.setSwitches).toHaveBeenCalledWith("c1", { ...NO_SWITCHES, achievements: true })
    );
  });

  it("shows a failed save of the switches inside the dialog", async () => {
    api.list.mockResolvedValue([connection({})]);
    api.setSwitches.mockRejectedValue(refusal("SHARE_REMOTE_LEADERBOARD_UNAVAILABLE"));
    render(<ConnectionsSection />);
    await userEvent.click(await screen.findByText(`${KEY}.change`));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByText(`${KEY}.changeDialog.submit`));
    await within(dialog).findByText(/sharing:remote.errors.leaderboardUnavailable/);
  });

  it("ends a connection only after the question, and shows it ended", async () => {
    api.list.mockResolvedValue([connection({})]);
    api.end.mockResolvedValue(connection({ state: "revoked" }));
    render(<ConnectionsSection />);
    const row = await screen.findByTestId("connection");
    await userEvent.click(within(row).getByText(`${KEY}.end.action`));
    expect(api.end).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByText(`${KEY}.end.action`));
    await waitFor(() => expect(api.end).toHaveBeenCalledWith("c1"));
    await screen.findByText(`${KEY}.state.revoked`);
  });

  it("only offers to view statistics the other side shows", async () => {
    api.list.mockResolvedValue([connection({})]);
    const { rerender } = render(<ConnectionsSection />);
    await screen.findByTestId("connection");
    expect(screen.queryByText("sharing:remote.connected.stats.view")).toBeNull();
    api.list.mockResolvedValue([connection({ theirs: { ...NO_SWITCHES, stats: "overview" } })]);
    rerender(<ConnectionsSection key="again" />);
    await screen.findByText("sharing:remote.connected.stats.view");
  });

  it("shows the achievements of a person who switched them on, and says so when they are refused", async () => {
    api.list.mockResolvedValue([connection({})]);
    const { rerender } = render(<ConnectionsSection />);
    await screen.findByTestId("connection");
    expect(screen.queryByText(`${KEY}.achievements.view`)).toBeNull();
    api.list.mockResolvedValue([connection({ theirs: { ...NO_SWITCHES, achievements: true } })]);
    rerender(<ConnectionsSection key="again" />);
    api.achievements.mockResolvedValue({
      summary: {
        totalAchievements: 10,
        unlockedAchievements: 1,
        totalPoints: 50,
        rank: "newcomer",
      },
      earned: [
        {
          code: "X1",
          name: "Globetrotter",
          description: "d",
          category: "explorer",
          domain: "shared",
          tier: "gold",
          icon: "star",
          points: 50,
          unlockedAt: null,
        },
      ],
    });
    await userEvent.click(await screen.findByText(`${KEY}.achievements.view`));
    expect(await screen.findByTestId("remote-badge")).toBeTruthy();
    expect(api.achievements).toHaveBeenCalledWith("c1");
    // The person turned it off meanwhile: its own sentence, not an empty list.
    api.achievements.mockRejectedValue(refusal("SHARE_REMOTE_ACHIEVEMENTS_NOT_SHARED"));
    await userEvent.click(screen.getByText(`${KEY}.achievements.close`));
    await userEvent.click(screen.getByText(`${KEY}.achievements.view`));
    expect((await screen.findByTestId("remote-achievements-error")).textContent).toContain(
      "sharing:remote.errors.achievementsNotShared"
    );
  });
});
