import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { get, update, reset } = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({ pushRelayApi: { get, update, reset } }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: typeof addToast }) => unknown) =>
    selector({ addToast }),
}));

import PushSettings from "../PushSettings";

const OFF = {
  pushEnabled: false,
  pushRelayUrl: "https://push.travstats.de",
  registered: false,
  pausedUntil: null,
  consentAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue(OFF);
});

describe("PushSettings", () => {
  it("renders the switch off, the relay address and the registration state", async () => {
    render(<PushSettings />);
    const box = await screen.findByRole("checkbox", { name: "pushRelay:enable" });
    expect(box).not.toBeChecked();
    expect(screen.getByLabelText("pushRelay:relayUrl")).toHaveValue("https://push.travstats.de");
    expect(screen.getByTestId("push-registration")).toHaveTextContent("pushRelay:notRegistered");
  });

  it("links the privacy policy", async () => {
    render(<PushSettings />);
    const link = await screen.findByRole("link", { name: "pushRelay:privacyLink" });
    expect(link).toHaveAttribute("href", "https://travstats.de/datenschutz");
  });

  it("switching on sends pushEnabled: true and shows the answer", async () => {
    update.mockResolvedValue({ ...OFF, pushEnabled: true, consentAt: "2026-10-02T10:00:00Z" });
    render(<PushSettings />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "pushRelay:enable" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ pushEnabled: true }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "pushRelay:enable" })).toBeChecked()
    );
  });

  it("keeps the switch off and toasts when saving fails", async () => {
    update.mockRejectedValue(new Error("boom"));
    render(<PushSettings />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "pushRelay:enable" }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("error", "pushRelay:saveFailed"));
    expect(screen.getByRole("checkbox", { name: "pushRelay:enable" })).not.toBeChecked();
  });

  it("saves a changed relay address", async () => {
    update.mockResolvedValue({ ...OFF, pushRelayUrl: "https://relay.example.org" });
    render(<PushSettings />);
    const input = await screen.findByLabelText("pushRelay:relayUrl");
    await userEvent.clear(input);
    await userEvent.type(input, "https://relay.example.org");
    await userEvent.click(screen.getByRole("button", { name: "pushRelay:saveUrl" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ pushRelayUrl: "https://relay.example.org" })
    );
  });

  it("offers no reset while nothing is registered", async () => {
    render(<PushSettings />);
    expect(await screen.findByRole("button", { name: "pushRelay:reset" })).toBeDisabled();
  });

  it("resets a registered instance", async () => {
    get.mockResolvedValue({ ...OFF, pushEnabled: true, registered: true });
    reset.mockResolvedValue({ ...OFF, pushEnabled: true });
    render(<PushSettings />);
    expect(await screen.findByTestId("push-registration")).toHaveTextContent(
      "pushRelay:registered"
    );
    await userEvent.click(screen.getByRole("button", { name: "pushRelay:reset" }));
    await waitFor(() => expect(reset).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("push-registration")).toHaveTextContent("pushRelay:notRegistered")
    );
  });
});
