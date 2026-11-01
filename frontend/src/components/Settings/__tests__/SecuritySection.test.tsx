import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// vi.hoisted: vi.mock factories are hoisted above the const, so a plain
// top-level object would not exist yet when the factory runs.
const api = vi.hoisted(() => ({
  getTwoFactorStatus: vi.fn(),
  setupTwoFactor: vi.fn(),
  activateTwoFactor: vi.fn(),
  disableTwoFactor: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({ twoFactorApi: api }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("qrcode.react", () => ({ QRCodeSVG: () => <svg data-testid="qr" /> }));
// Passkeys are their own feature with their own suite; this one is about TOTP.
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../PasskeySection", () => ({ default: () => <div data-testid="passkeys" /> }));

import SecuritySection from "../SecuritySection";

describe("SecuritySection", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.getTwoFactorStatus.mockResolvedValue({ enabled: false, recoveryCodesLeft: 0 });
  });

  it("offers to switch it on when it is off", async () => {
    render(<SecuritySection />);
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "settings:rows.twoFactor.name" })
      ).toBeInTheDocument()
    );
  });

  it("shows a QR code and the secret after starting setup", async () => {
    api.setupTwoFactor.mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://x" });
    render(<SecuritySection />);

    fireEvent.click(await screen.findByRole("switch", { name: "settings:rows.twoFactor.name" }));

    await waitFor(() => expect(screen.getByTestId("qr")).toBeInTheDocument());
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
  });

  it("shows the recovery codes exactly once, after activation", async () => {
    api.setupTwoFactor.mockResolvedValue({ secret: "S", otpauthUrl: "otpauth://x" });
    api.activateTwoFactor.mockResolvedValue({ recoveryCodes: ["aaaaa-11111", "bbbbb-22222"] });
    render(<SecuritySection />);

    fireEvent.click(await screen.findByRole("switch", { name: "settings:rows.twoFactor.name" }));
    fireEvent.change(await screen.findByLabelText("settings:security.codeLabel"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings:security.activate" }));

    await waitFor(() => expect(screen.getByText("aaaaa-11111")).toBeInTheDocument());
    expect(screen.getByText("bbbbb-22222")).toBeInTheDocument();
  });

  it("says so, and offers a retry, when the two-factor status cannot be read (never guesses off)", async () => {
    api.getTwoFactorStatus.mockRejectedValueOnce(new Error("Network Error"));
    api.getTwoFactorStatus.mockResolvedValueOnce({ enabled: true, recoveryCodesLeft: 7 });
    render(<SecuritySection />);
    expect(await screen.findByText("settings:security.statusFailed")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "settings:rows.twoFactor.name" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    const sw = await screen.findByRole("switch", { name: "settings:rows.twoFactor.name" });
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("says it could not start the setup when the server refuses", async () => {
    api.setupTwoFactor.mockRejectedValue(new Error("500"));
    render(<SecuritySection />);
    fireEvent.click(await screen.findByRole("switch", { name: "settings:rows.twoFactor.name" }));
    expect(await screen.findByText("settings:security.setupFailed")).toBeInTheDocument();
  });

  it("locks the backup codes behind the second factor, with the reason", async () => {
    render(<SecuritySection />);
    expect(await screen.findByText("settings:security.needsTwoFactor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings:security.regenerate" })).toBeDisabled();
  });

  // A wrong first code must leave the account off, and must say so — silently
  // returning to the "off" state would read as if setup had never started.
  it("keeps setup open and complains when the first code is wrong", async () => {
    api.setupTwoFactor.mockResolvedValue({ secret: "S", otpauthUrl: "otpauth://x" });
    api.activateTwoFactor.mockRejectedValue(new Error("nope"));
    render(<SecuritySection />);

    fireEvent.click(await screen.findByRole("switch", { name: "settings:rows.twoFactor.name" }));
    fireEvent.change(await screen.findByLabelText("settings:security.codeLabel"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings:security.activate" }));

    await waitFor(() =>
      expect(screen.getByText("settings:security.wrongCode")).toBeInTheDocument()
    );
    expect(screen.getByTestId("qr")).toBeInTheDocument();
  });

  it("a wrong password on switching off says so and keeps the factor on", async () => {
    api.getTwoFactorStatus.mockResolvedValue({ enabled: true, recoveryCodesLeft: 7 });
    api.disableTwoFactor.mockRejectedValue(new Error("403"));
    render(<SecuritySection />);
    fireEvent.click(await screen.findByRole("switch", { name: "settings:rows.twoFactor.name" }));
    fireEvent.change(await screen.findByLabelText("settings:security.passwordLabel"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings:security.confirmDisable" }));
    expect(await screen.findByText("settings:security.wrongPassword")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "settings:rows.twoFactor.name" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("switches it off against the password and returns to the off state", async () => {
    api.getTwoFactorStatus.mockResolvedValue({ enabled: true, recoveryCodesLeft: 7 });
    api.disableTwoFactor.mockResolvedValue(undefined);
    render(<SecuritySection />);

    fireEvent.click(await screen.findByRole("switch", { name: "settings:rows.twoFactor.name" }));
    fireEvent.change(await screen.findByLabelText("settings:security.passwordLabel"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings:security.confirmDisable" }));

    await waitFor(() => expect(api.disableTwoFactor).toHaveBeenCalledWith("password123"));
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "settings:rows.twoFactor.name" })
      ).toBeInTheDocument()
    );
  });

  it("issues a fresh sheet of recovery codes against the password", async () => {
    api.getTwoFactorStatus.mockResolvedValue({ enabled: true, recoveryCodesLeft: 2 });
    api.regenerateRecoveryCodes.mockResolvedValue({ recoveryCodes: ["ccccc-33333"] });
    render(<SecuritySection />);

    fireEvent.click(await screen.findByRole("button", { name: "settings:security.regenerate" }));
    fireEvent.change(await screen.findByLabelText("settings:security.passwordLabel"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings:security.confirmRegenerate" }));
    // The old sheet is voided, so the confirmation block comes first.
    fireEvent.click(
      await screen.findByRole("button", { name: "settings:security.regenerateDialog.confirm" })
    );

    await waitFor(() => expect(screen.getByText("ccccc-33333")).toBeInTheDocument());
  });

  // Round 4 moved "change password" here from the profile header.
  it("offers the password change as a row of its own", async () => {
    const onChangePassword = vi.fn();
    render(<SecuritySection onChangePassword={onChangePassword} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "settings:security.passwordChange" })
    );
    expect(onChangePassword).toHaveBeenCalledTimes(1);
  });
});
