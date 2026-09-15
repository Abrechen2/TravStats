import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pairing = vi.hoisted(() => ({ start: vi.fn(), status: vi.fn() }));
const tokens = vi.hoisted(() => ({ list: vi.fn(), revoke: vi.fn() }));

vi.mock("../../../lib/api/pairing", () => ({ pairingApi: pairing }));
vi.mock("../../../lib/api/tokens", () => ({ apiTokensApi: tokens }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value, title }: { value: string; title?: string }) => (
    <svg data-testid="qr" data-value={value}>
      {title ? <title>{title}</title> : null}
    </svg>
  ),
}));

import DevicesSection, { pairingCodeChunks } from "../DevicesSection";

const CODE = "clm_0123456789abcdef0123456789abcdef";

async function openPairingPanel(): Promise<void> {
  render(<DevicesSection />);
  fireEvent.click(await screen.findByRole("button", { name: "settings:devices.connectButton" }));
  await screen.findByTestId("pairing-code");
}

describe("DevicesSection pairing code", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    pairing.start.mockReset();
    pairing.status.mockReset();
    tokens.list.mockReset();
    tokens.revoke.mockReset();
    tokens.list.mockResolvedValue([]);
    pairing.status.mockResolvedValue({ claimed: false });
    pairing.start.mockResolvedValue({
      code: CODE,
      publicUrl: "https://travstats.example",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The regression this file exists for: the code used to live ONLY inside the
  // QR payload, so the app's manual pairing path — and anyone who cannot see
  // the screen — had no source to read it from (forgejo#112).
  it("shows the code as text, not only inside the QR", async () => {
    await openPairingPanel();
    expect(screen.getByTestId("pairing-code")).toHaveTextContent(CODE);
  });

  // The blocks of four are cosmetic; the claim endpoint validates
  // /^clm_[0-9a-f]{32}$/ and only trims the ends, so a code selected with the
  // mouse must still come out verbatim.
  it("groups the code for reading without putting whitespace in it", async () => {
    await openPairingPanel();
    expect(screen.getByTestId("pairing-code").textContent).toBe(CODE);
    expect(pairingCodeChunks(CODE)).toEqual([
      "clm_",
      "0123",
      "4567",
      "89ab",
      "cdef",
      "0123",
      "4567",
      "89ab",
      "cdef",
    ]);
  });

  it("copies the bare code, not the grouped rendering", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const secure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await openPairingPanel();
    fireEvent.click(screen.getByRole("button", { name: "settings:devices.codeCopy" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CODE));
    await screen.findByRole("button", { name: "settings:devices.codeCopied" });

    if (secure) Object.defineProperty(window, "isSecureContext", secure);
  });

  // The panel is routinely opened on a plain-http LAN address, where
  // navigator.clipboard does not exist. The button must not throw, and the
  // code must stay readable — that is the whole point of showing it.
  it("still shows the code when the clipboard is unavailable", async () => {
    const secure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });

    await openPairingPanel();
    fireEvent.click(screen.getByRole("button", { name: "settings:devices.codeCopy" }));

    expect(screen.getByTestId("pairing-code")).toHaveTextContent(CODE);
    expect(screen.queryByRole("button", { name: "settings:devices.codeCopied" })).toBeNull();

    if (secure) Object.defineProperty(window, "isSecureContext", secure);
  });

  // An unnamed <svg> is invisible to assistive tech; with the code inside it,
  // that left nothing at all on the panel.
  it("gives the QR an accessible name", async () => {
    await openPairingPanel();
    expect(screen.getByTestId("qr")).toHaveTextContent("settings:devices.qrAlt");
  });
});
