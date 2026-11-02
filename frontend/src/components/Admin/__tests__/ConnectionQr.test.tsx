import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("qrcode.react", () => ({
  QRCodeSVG: (p: { value: string; "data-testid"?: string }) => (
    <svg data-testid={p["data-testid"]} data-value={p.value} />
  ),
}));

import { ConnectionQr, serverQrPayload } from "../FederationConnectionFile";

const v = { origin: "https://a.example.org", publicKey: "PEMTEXT", fingerprint: "ab".repeat(32) };

describe("serverQrPayload", () => {
  it("carries exactly the connection file's values and no secret", () => {
    expect(JSON.parse(serverQrPayload(v))).toEqual({
      v: 1,
      k: "server",
      u: v.origin,
      key: v.publicKey,
      fp: v.fingerprint,
    });
  });
});

describe("ConnectionQr", () => {
  it("renders a QR for the payload", () => {
    render(<ConnectionQr {...v} stale={false} />);
    expect(screen.getByTestId("server-qr").getAttribute("data-value")).toBe(serverQrPayload(v));
  });
  it("shows no QR while the address field differs from the saved one", () => {
    render(<ConnectionQr {...v} stale />);
    expect(screen.queryByTestId("server-qr")).toBeNull();
  });
});
