import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RemotePeopleSection from "../RemotePeopleSection";
import { sharingRemoteApi } from "../../../lib/api/sharingRemote";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "de" } }),
}));
vi.mock("../../../lib/api/sharingRemote", () => ({
  sharingRemoteApi: {
    status: vi.fn(),
    getFindable: vi.fn(),
    setFindable: vi.fn(),
    listServers: vi.fn(),
    listPeople: vi.fn(),
    findPerson: vi.fn(),
    setStatsLevel: vi.fn(),
    setLeaderboard: vi.fn(),
  },
}));
const api = vi.mocked(sharingRemoteApi);
const PERSON = {
  id: "p1",
  origin: "https://far.example.org",
  username: "ben",
  displayName: "Ben",
  consent: "accepted" as const,
  statsLevel: "off" as const,
  leaderboard: "off" as const,
  createdAt: "2026-11-02T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  api.status.mockResolvedValue({
    available: true,
    reason: null,
    origin: "https://me.example.org",
    peerAdmitted: true,
  });
  api.getFindable.mockResolvedValue(false);
  api.listServers.mockResolvedValue([{ origin: PERSON.origin }]);
  api.listPeople.mockResolvedValue([PERSON]);
});

describe("Personen auf verbundenen Servern", () => {
  it("draws nothing while trip sharing across servers is off", async () => {
    api.status.mockResolvedValue({
      available: false,
      reason: "switch-off",
      origin: null,
      peerAdmitted: false,
    });
    const { container } = render(<RemotePeopleSection />);
    await waitFor(() => expect(api.status).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("starts not findable and everything off, and saves a chosen statistics level", async () => {
    api.setStatsLevel.mockResolvedValue({ ...PERSON, statsLevel: "overview" });
    render(<RemotePeopleSection />);
    const findable = await screen.findByRole("switch", {
      name: /sharing:remote.connected.findable.label/,
    });
    expect((findable as HTMLInputElement).checked).toBe(false);
    await userEvent.click(await screen.findByText("sharing:remote.connected.stats.overview"));
    await waitFor(() => expect(api.setStatsLevel).toHaveBeenCalledWith("p1", "overview"));
  });

  it("says why a person was not found instead of drawing nothing", async () => {
    api.findPerson.mockRejectedValue({
      response: { data: { code: "SHARE_REMOTE_PERSON_UNKNOWN" } },
    });
    render(<RemotePeopleSection />);
    await userEvent.type(
      await screen.findByLabelText("sharing:remote.connected.find.username"),
      "x"
    );
    await userEvent.click(screen.getByText("sharing:remote.connected.find.submit"));
    await screen.findByText("sharing:remote.errors.personUnknown");
  });
});
