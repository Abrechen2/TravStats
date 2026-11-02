import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RemoteOtherServerOffer from "../RemoteOtherServerOffer";
import { sharingRemoteApi } from "../../../lib/api/sharingRemote";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../lib/api/sharingRemote", () => ({ sharingRemoteApi: { listServers: vi.fn() } }));
const api = vi.mocked(sharingRemoteApi);

beforeEach(() => vi.clearAllMocks());

describe("Auf anderem Server", () => {
  it("shows every warning before the button and offers by server and username", async () => {
    api.listServers.mockResolvedValue([{ origin: "https://far.example.org" }]);
    const onOffer = vi.fn().mockResolvedValue(true);
    render(<RemoteOtherServerOffer busy={false} onOffer={onOffer} />);
    await screen.findByText("sharing:remote.trip.otherServer.warnStored");
    for (const key of ["warnEdits", "warnPrivate", "warnRecall", "warnAccept"])
      expect(screen.getByText(`sharing:remote.trip.otherServer.${key}`)).toBeTruthy();
    await userEvent.type(screen.getByLabelText("sharing:remote.trip.otherServer.username"), "ben");
    await userEvent.click(screen.getByText("sharing:remote.trip.otherServer.submit"));
    await waitFor(() => expect(onOffer).toHaveBeenCalledWith("https://far.example.org", "ben"));
  });

  it("keeps the name when the offer was refused, so it can be retried", async () => {
    api.listServers.mockResolvedValue([{ origin: "https://far.example.org" }]);
    const onOffer = vi.fn().mockResolvedValue(false);
    render(<RemoteOtherServerOffer busy={false} onOffer={onOffer} />);
    const input = await screen.findByLabelText("sharing:remote.trip.otherServer.username");
    await userEvent.type(input, "ben");
    await userEvent.click(screen.getByText("sharing:remote.trip.otherServer.submit"));
    await waitFor(() => expect(onOffer).toHaveBeenCalled());
    expect((input as HTMLInputElement).value).toBe("ben");
  });

  it("says so when no server is connected, and draws no button", async () => {
    api.listServers.mockResolvedValue([]);
    render(<RemoteOtherServerOffer busy={false} onOffer={vi.fn()} />);
    await screen.findByText("sharing:remote.trip.otherServer.noServers");
    expect(screen.queryByText("sharing:remote.trip.otherServer.submit")).toBeNull();
  });
});
