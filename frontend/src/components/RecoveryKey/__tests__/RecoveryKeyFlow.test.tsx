import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
const reveal = vi.fn();
const confirm = vi.fn();
vi.mock("../../../lib/api/recoveryKey", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api/recoveryKey")>()),
  recoveryKeyApi: {
    status: vi.fn(),
    reveal: (b: unknown) => reveal(b),
    confirm: (s: string) => confirm(s),
  },
}));
const twoFactor = vi.fn();
vi.mock("../../../lib/api/twoFactor", () => ({
  twoFactorApi: { getTwoFactorStatus: () => twoFactor() },
}));
vi.mock("../../../lib/api/passkeys", () => ({
  passkeyApi: { list: () => Promise.resolve([]), reauthOptions: vi.fn() },
}));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: vi.fn() }));

import RecoveryKeyFlow from "../RecoveryKeyFlow";

const KEY = "A1A1 ".repeat(15) + "BEEF";
const refused = (code: string, httpStatus = 403): Error =>
  Object.assign(new Error(code), { response: { status: httpStatus, data: { code } } });
const settle = () => act(async () => {});

const toKey = async (): Promise<void> => {
  reveal.mockResolvedValue({ key: KEY, fingerprint: "f", instanceName: "T", filename: "k.txt" });
  fireEvent.change(screen.getByLabelText("settings:recoveryKey.reauth.password"), {
    target: { value: "pw" },
  });
  fireEvent.click(screen.getByRole("button", { name: "settings:recoveryKey.reauth.submit" }));
  await settle();
};
const typeLastFour = (value: string): void => {
  fireEvent.change(screen.getByLabelText("settings:recoveryKey.confirm.label"), {
    target: { value },
  });
};

describe("RecoveryKeyFlow", () => {
  beforeEach(() => {
    reveal.mockReset();
    confirm.mockReset();
    twoFactor.mockResolvedValue({ enabled: false });
  });
  afterEach(() => cleanup());

  describe("copy on plain http (no secure context)", () => {
    const original = document.execCommand;
    afterEach(() => {
      document.execCommand = original;
      window.getSelection()?.removeAllRanges();
    });

    it("copies through the legacy path instead of failing on plain http", async () => {
      document.execCommand = vi.fn(() => true);
      render(<RecoveryKeyFlow onConfirmed={vi.fn()} />);
      await settle();
      await toKey();
      fireEvent.click(screen.getByRole("button", { name: "settings:recoveryKey.show.copy" }));
      await settle();
      expect(screen.getByText("settings:recoveryKey.show.copied")).toBeTruthy();
    });

    it("a failed copy selects the key on screen and says to copy it by hand", async () => {
      document.execCommand = vi.fn(() => false);
      render(<RecoveryKeyFlow onConfirmed={vi.fn()} />);
      await settle();
      await toKey();
      fireEvent.click(screen.getByRole("button", { name: "settings:recoveryKey.show.copy" }));
      await settle();
      expect(screen.getByText("settings:recoveryKey.show.copyFailed")).toBeTruthy();
      expect(window.getSelection()?.toString().replace(/\s+/g, " ")).toBe(KEY.replace(/\s+/g, " "));
    });
  });

  it("a wrong password shows the reason and no key", async () => {
    reveal.mockRejectedValue(refused("REAUTH_PASSWORD_INCORRECT"));
    render(<RecoveryKeyFlow onConfirmed={vi.fn()} />);
    await settle();
    fireEvent.change(screen.getByLabelText("settings:recoveryKey.reauth.password"), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings:recoveryKey.reauth.submit" }));
    await settle();
    expect(
      screen.getByText("settings:recoveryKey.reauth.refused.REAUTH_PASSWORD_INCORRECT")
    ).toBeTruthy();
    expect(screen.queryByTestId("recovery-key")).toBeNull();
  });

  it("asks for the authenticator code when the account has two-factor", async () => {
    twoFactor.mockResolvedValue({ enabled: true });
    reveal.mockResolvedValue({ key: KEY, fingerprint: "f", instanceName: "T", filename: "k.txt" });
    render(<RecoveryKeyFlow onConfirmed={vi.fn()} />);
    await settle();
    fireEvent.change(screen.getByLabelText("settings:recoveryKey.reauth.password"), {
      target: { value: "pw" },
    });
    fireEvent.change(screen.getByLabelText("settings:recoveryKey.reauth.code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings:recoveryKey.reauth.submit" }));
    await settle();
    expect(reveal).toHaveBeenCalledWith({ password: "pw", code: "123456" });
  });

  it("rate limiting is said as such", async () => {
    reveal.mockRejectedValue(refused("RATE_LIMITED", 429));
    render(<RecoveryKeyFlow onConfirmed={vi.fn()} />);
    await settle();
    fireEvent.change(screen.getByLabelText("settings:recoveryKey.reauth.password"), {
      target: { value: "pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings:recoveryKey.reauth.submit" }));
    await settle();
    expect(screen.getByText("settings:recoveryKey.reauth.refused.RATE_LIMITED")).toBeTruthy();
  });

  it("wrong last four characters say so and let the admin look at the key again", async () => {
    const onConfirmed = vi.fn();
    render(<RecoveryKeyFlow onConfirmed={onConfirmed} />);
    await settle();
    await toKey();
    expect(screen.getByTestId("recovery-key").textContent).toBe(KEY);
    fireEvent.click(screen.getByRole("button", { name: "settings:recoveryKey.show.next" }));
    confirm.mockRejectedValue(refused("RECOVERY_KEY_CONFIRM_MISMATCH", 422));
    typeLastFour("ffff");
    fireEvent.click(screen.getByRole("button", { name: "settings:recoveryKey.confirm.submit" }));
    await settle();
    expect(screen.getByText("settings:recoveryKey.confirm.mismatch")).toBeTruthy();
    expect(onConfirmed).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "settings:recoveryKey.confirm.back" }));
    expect(screen.getByTestId("recovery-key").textContent).toBe(KEY);
  });

  it("the right four characters confirm — and only those four are sent", async () => {
    const onConfirmed = vi.fn();
    confirm.mockResolvedValue({ required: false, confirmed: true });
    render(<RecoveryKeyFlow onConfirmed={onConfirmed} />);
    await settle();
    await toKey();
    fireEvent.click(screen.getByRole("button", { name: "settings:recoveryKey.show.next" }));
    typeLastFour("BEEF");
    fireEvent.click(screen.getByRole("button", { name: "settings:recoveryKey.confirm.submit" }));
    await settle();
    expect(confirm).toHaveBeenCalledWith("BEEF");
    expect(onConfirmed).toHaveBeenCalledWith({ required: false, confirmed: true });
  });

  it("an expired reveal sends the admin back to re-authenticate", async () => {
    render(<RecoveryKeyFlow onConfirmed={vi.fn()} />);
    await settle();
    await toKey();
    fireEvent.click(screen.getByRole("button", { name: "settings:recoveryKey.show.next" }));
    confirm.mockRejectedValue(refused("RECOVERY_KEY_NOT_REVEALED", 409));
    typeLastFour("BEEF");
    fireEvent.click(screen.getByRole("button", { name: "settings:recoveryKey.confirm.submit" }));
    await settle();
    expect(screen.getByText("settings:recoveryKey.confirm.expired")).toBeTruthy();
    expect(screen.queryByTestId("recovery-key")).toBeNull();
  });
});
