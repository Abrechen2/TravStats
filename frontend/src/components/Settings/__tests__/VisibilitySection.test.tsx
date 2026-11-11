import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetWriteQueue } from "../../ui/settings/writeQueue";

vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
const remote = vi.hoisted(() => ({
  status: vi.fn(),
  getFindable: vi.fn(),
  setFindable: vi.fn(),
}));
vi.mock("../../../lib/api/sharingRemote", () => ({ sharingRemoteApi: remote }));

import VisibilitySection from "../VisibilitySection";

const available = {
  available: true,
  reason: null,
  origin: "https://a.example",
  peerAdmitted: true,
};
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 450));
  });
const findable = () => screen.findByRole("switch", { name: "settings:visibility.findable.label" });

beforeEach(() => {
  vi.clearAllMocks();
  remote.status.mockResolvedValue(available);
  remote.getFindable.mockResolvedValue(false);
  remote.setFindable.mockImplementation(async (next: boolean) => next);
});
afterEach(() => {
  cleanup();
  act(() => resetWriteQueue());
});

describe("Profil › Sichtbarkeit › Für andere Server auffindbar", () => {
  it("reads the switch from the server and writes the choice through /sharing/remote/findable", async () => {
    remote.getFindable.mockResolvedValue(true);
    render(<VisibilitySection />);
    const toggle = await findable();
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    await userEvent.click(toggle);
    await settle();
    expect(remote.setFindable).toHaveBeenCalledWith(false);
  });

  it("says why it cannot act while the admin has not allowed other servers, and does not offer a write", async () => {
    remote.status.mockResolvedValue({
      available: false,
      reason: "switch-off",
      origin: null,
      peerAdmitted: false,
    });
    render(<VisibilitySection />);
    expect(await screen.findByText("settings:blocks.dep.noFederation.reason")).toBeInTheDocument();
    const toggle = await findable();
    expect(toggle).toBeDisabled();
    // Nothing is read that the server would refuse.
    expect(remote.getFindable).not.toHaveBeenCalled();
    await userEvent.click(toggle);
    await settle();
    expect(remote.setFindable).not.toHaveBeenCalled();
  });

  it("draws no switch before the server has answered, and no notice either: unknown is not 'off by the admin'", async () => {
    remote.status.mockReturnValue(new Promise(() => {}));
    render(<VisibilitySection />);
    await act(async () => {});
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText("settings:blocks.dep.noFederation.reason")).toBeNull();
  });

  it("draws no switch while the state of 'findable' itself is still being read", async () => {
    remote.getFindable.mockReturnValue(new Promise(() => {}));
    render(<VisibilitySection />);
    await act(async () => {});
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("keeps the choice on its row and says it was not saved when the server refuses", async () => {
    remote.setFindable.mockRejectedValue(new Error("refused"));
    render(<VisibilitySection />);
    const toggle = await findable();
    await userEvent.click(toggle);
    await settle();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(
      screen
        .getAllByRole("alert")
        .some((a) => /settings:blocks.save.failed/.test(a.textContent ?? ""))
    ).toBe(true);
  });

  it("says when the state could not be read instead of drawing a switch that would write over it", async () => {
    remote.status.mockRejectedValue(new Error("down"));
    render(<VisibilitySection />);
    expect(await screen.findByText("settings:visibility.loadFailed")).toBeInTheDocument();
    // A switch drawn from a guess would write over the state that could not be read.
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("does not draw a switch when only the findable read fails", async () => {
    remote.getFindable.mockRejectedValue(new Error("down"));
    render(<VisibilitySection />);
    expect(await screen.findByText("settings:visibility.loadFailed")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
