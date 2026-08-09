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

import SecuritySection from "../SecuritySection";

describe("SecuritySection", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.getTwoFactorStatus.mockResolvedValue({ enabled: false, recoveryCodesLeft: 0 });
  });

  it("offers to switch it on when it is off", async () => {
    render(<SecuritySection />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "settings:security.enable" })).toBeInTheDocument()
    );
  });

  it("shows a QR code and the secret after starting setup", async () => {
    api.setupTwoFactor.mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://x" });
    render(<SecuritySection />);

    fireEvent.click(await screen.findByRole("button", { name: "settings:security.enable" }));

    await waitFor(() => expect(screen.getByTestId("qr")).toBeInTheDocument());
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
  });

  it("shows the recovery codes exactly once, after activation", async () => {
    api.setupTwoFactor.mockResolvedValue({ secret: "S", otpauthUrl: "otpauth://x" });
    api.activateTwoFactor.mockResolvedValue({ recoveryCodes: ["aaaaa-11111", "bbbbb-22222"] });
    render(<SecuritySection />);

    fireEvent.click(await screen.findByRole("button", { name: "settings:security.enable" }));
    fireEvent.change(await screen.findByLabelText("settings:security.codeLabel"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings:security.activate" }));

    await waitFor(() => expect(screen.getByText("aaaaa-11111")).toBeInTheDocument());
    expect(screen.getByText("bbbbb-22222")).toBeInTheDocument();
  });

  it("warns that API tokens are not covered", async () => {
    api.getTwoFactorStatus.mockResolvedValue({ enabled: true, recoveryCodesLeft: 7 });
    render(<SecuritySection />);
    await waitFor(() =>
      expect(screen.getByText(/settings:security.tokenWarning/)).toBeInTheDocument()
    );
  });

  // A wrong first code must leave the account off, and must say so — silently
  // returning to the "off" state would read as if setup had never started.
  it("keeps setup open and complains when the first code is wrong", async () => {
    api.setupTwoFactor.mockResolvedValue({ secret: "S", otpauthUrl: "otpauth://x" });
    api.activateTwoFactor.mockRejectedValue(new Error("nope"));
    render(<SecuritySection />);

    fireEvent.click(await screen.findByRole("button", { name: "settings:security.enable" }));
    fireEvent.change(await screen.findByLabelText("settings:security.codeLabel"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings:security.activate" }));

    await waitFor(() =>
      expect(screen.getByText("settings:security.wrongCode")).toBeInTheDocument()
    );
    expect(screen.getByTestId("qr")).toBeInTheDocument();
  });

  it("switches it off against the password and returns to the off state", async () => {
    api.getTwoFactorStatus.mockResolvedValue({ enabled: true, recoveryCodesLeft: 7 });
    api.disableTwoFactor.mockResolvedValue(undefined);
    render(<SecuritySection />);

    fireEvent.click(await screen.findByRole("button", { name: "settings:security.disable" }));
    fireEvent.change(await screen.findByLabelText("settings:security.passwordLabel"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings:security.confirmDisable" }));

    await waitFor(() => expect(api.disableTwoFactor).toHaveBeenCalledWith("password123"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "settings:security.enable" })).toBeInTheDocument()
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

    await waitFor(() => expect(screen.getByText("ccccc-33333")).toBeInTheDocument());
  });
});
