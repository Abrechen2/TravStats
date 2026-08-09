import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import InstanceSettings from "../../../components/Admin/InstanceSettings";

// Unlike most tests, `t` is deliberately a FRESH function on every call —
// mirroring the real `hooks/useTranslation`, whose `t` is re-created on
// every render (react-i18next returns a new translation object each time).
// Issue #190 only reproduces with an unstable `t`: a load effect that lists
// `t` in its dependencies re-fires on every keystroke's re-render and
// overwrites the form with the server response, making typing impossible.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "de", changeLanguage: vi.fn() },
    ready: true,
  }),
}));

const getInstanceSettings = vi.fn();
const updateInstanceSettings = vi.fn();
vi.mock("../../../lib/api", () => ({
  adminApi: {
    getInstanceSettings: (...args: unknown[]) => getInstanceSettings(...args),
    updateInstanceSettings: (...args: unknown[]) => updateInstanceSettings(...args),
  },
}));

const serverSettings = {
  instanceName: "TravStats",
  maxUsers: 10,
  allowRegistration: false,
  frontendUrl: null,
  publicUrl: "http://192.168.1.5:3010",
  lanUrl: null,
  webauthnRpId: null,
  webauthnOrigins: [],
};

const notConfigured = { usable: false, reason: "notConfigured" };

describe("InstanceSettings (#190 — typing must not be reset by the load effect)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getInstanceSettings.mockResolvedValue({ settings: serverSettings, passkeyStatus: notConfigured });
  });

  it("keeps a typed public URL instead of resetting it to the server value", async () => {
    render(<InstanceSettings />);
    const input = (await screen.findByDisplayValue("http://192.168.1.5:3010")) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "https://trav.example.de" } });

    // Let any (wrongly) re-fired load effect resolve its GET — with the bug,
    // the response lands here and stomps the keystroke back to the server IP.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(input.value).toBe("https://trav.example.de");
  });

  it("fetches the instance settings exactly once for the whole editing session", async () => {
    render(<InstanceSettings />);
    const input = (await screen.findByDisplayValue("http://192.168.1.5:3010")) as HTMLInputElement;

    // Several keystrokes → several re-renders. The load effect must not
    // re-run for any of them.
    fireEvent.change(input, { target: { value: "h" } });
    fireEvent.change(input, { target: { value: "ht" } });
    fireEvent.change(input, { target: { value: "htt" } });
    await act(async () => {
      await Promise.resolve();
    });

    expect(getInstanceSettings).toHaveBeenCalledTimes(1);
  });

  it("still writes the edited value on save and reflects the server response", async () => {
    updateInstanceSettings.mockResolvedValue({
      settings: { ...serverSettings, publicUrl: "https://trav.example.de" },
      passkeyStatus: notConfigured,
    });
    render(<InstanceSettings />);
    const input = (await screen.findByDisplayValue("http://192.168.1.5:3010")) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "https://trav.example.de" } });
    fireEvent.click(screen.getByRole("button", { name: /buttons\.save/i }));

    await waitFor(() =>
      expect(updateInstanceSettings).toHaveBeenCalledWith(
        expect.objectContaining({ publicUrl: "https://trav.example.de" })
      )
    );
    expect(input.value).toBe("https://trav.example.de");
  });
});
