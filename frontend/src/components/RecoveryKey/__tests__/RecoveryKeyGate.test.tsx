import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
const status = vi.fn();
const reveal = vi.fn();
const confirm = vi.fn();
vi.mock("../../../lib/api/recoveryKey", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api/recoveryKey")>()),
  recoveryKeyApi: {
    status: () => status(),
    reveal: (b: unknown) => reveal(b),
    confirm: (s: string) => confirm(s),
  },
}));
vi.mock("../../../lib/api/twoFactor", () => ({
  twoFactorApi: { getTwoFactorStatus: () => Promise.resolve({ enabled: false }) },
}));
vi.mock("../../../lib/api/passkeys", () => ({
  passkeyApi: { list: () => Promise.resolve([]), reauthOptions: vi.fn() },
}));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: vi.fn() }));

import { useAuthStore } from "../../../store/authStore";
import RecoveryKeyGate, { STATUS_RETRY_MS } from "../RecoveryKeyGate";

/**
 * Owner requirement 2026-11-24: an instance with a backup target whose recovery
 * key is unconfirmed blocks every admin on every page until the flow is done,
 * leaves ordinary accounts alone, unblocks after the confirmation and blocks
 * again once the key (its fingerprint) changes.
 */

const KEY = "A1A1 ".repeat(16).trim();
const required = { required: true, confirmed: false };
const done = { required: false, confirmed: true };

let goTo: (path: string) => void = () => {};
function Navigator(): null {
  const navigate = useNavigate();
  goTo = navigate;
  return null;
}

const mount = (isAdmin: boolean, path = "/dashboard") => {
  useAuthStore.setState({ user: { id: "u1", username: "mara", isAdmin } as never });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Navigator />
      <RecoveryKeyGate sessionConfirmed />
    </MemoryRouter>
  );
};
const settle = () => act(async () => {});

describe("RecoveryKeyGate", () => {
  beforeEach(() => {
    status.mockReset();
    reveal.mockReset();
    confirm.mockReset();
  });
  afterEach(() => cleanup());

  it("blocks an admin with an existing target and an unconfirmed key — no way to dismiss it", async () => {
    status.mockResolvedValue(required);
    mount(true);
    await settle();
    const dialog = screen.getByTestId("recovery-key-dialog");
    expect(dialog).toBeTruthy();
    // No ×, and Escape does nothing.
    expect(screen.queryByRole("button", { name: "common:buttons.close" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    await settle();
    expect(screen.getByTestId("recovery-key-dialog")).toBeTruthy();
    // The one exit: signing out.
    expect(screen.getByRole("button", { name: "settings:recoveryKey.signOut" })).toBeTruthy();
  });

  it("blocks on every route, not only the one it first appeared on", async () => {
    status.mockResolvedValue(required);
    mount(true, "/flights");
    await settle();
    for (const path of ["/settings/sicherungen", "/trips", "/dashboard/cruise"]) {
      await act(async () => goTo(path));
      await settle();
      expect(screen.getByTestId("recovery-key-dialog")).toBeTruthy();
    }
    expect(status.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("never blocks an ordinary account, and does not even ask", async () => {
    status.mockResolvedValue(required);
    mount(false);
    await settle();
    expect(screen.queryByTestId("recovery-key-dialog")).toBeNull();
    expect(status).not.toHaveBeenCalled();
  });

  it("unblocks after the confirmation and blocks again when the key changes", async () => {
    status.mockResolvedValue(required);
    reveal.mockResolvedValue({ key: KEY, fingerprint: "f", instanceName: "T", filename: "x.txt" });
    confirm.mockResolvedValue(done);
    mount(true);
    await settle();

    fireEvent.change(screen.getByLabelText("settings:recoveryKey.reauth.password"), {
      target: { value: "pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings:recoveryKey.reauth.submit" }));
    await settle();
    expect(screen.getByTestId("recovery-key").textContent).toBe(KEY);
    fireEvent.click(screen.getByRole("button", { name: "settings:recoveryKey.show.next" }));
    fireEvent.change(screen.getByLabelText("settings:recoveryKey.confirm.label"), {
      target: { value: "A1A1" },
    });
    status.mockResolvedValue(done);
    fireEvent.click(screen.getByRole("button", { name: "settings:recoveryKey.confirm.submit" }));
    await settle();
    expect(confirm).toHaveBeenCalledWith("A1A1");
    expect(screen.queryByTestId("recovery-key-dialog")).toBeNull();

    // The key was replaced (e.g. a restore without the recovery key): the next page blocks.
    status.mockResolvedValue({ ...required, confirmedForOtherKey: true });
    await act(async () => goTo("/trips"));
    await settle();
    expect(screen.getByTestId("recovery-key-dialog")).toBeTruthy();
  });

  it("a first status read that fails is asked again, and then blocks", async () => {
    vi.useFakeTimers();
    try {
      status.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(required);
      mount(true);
      await act(async () => {});
      expect(screen.queryByTestId("recovery-key-dialog")).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(STATUS_RETRY_MS);
      });
      await act(async () => {});
      expect(screen.getByTestId("recovery-key-dialog")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed status read does not unblock", async () => {
    status.mockResolvedValueOnce(required).mockRejectedValue(new Error("offline"));
    mount(true);
    await settle();
    await act(async () => goTo("/trips"));
    await settle();
    expect(screen.getByTestId("recovery-key-dialog")).toBeTruthy();
  });
});
