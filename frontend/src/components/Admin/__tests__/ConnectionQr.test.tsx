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

describe("ConnectionQr validity statement", () => {
  it("says the code does not expire and is tied to the saved key and address (the server enforces no time limit, only the pinned key)", async () => {
    const de = (await import("../../../i18n/resources/de/admin.json")).default as unknown;
    const en = (await import("../../../i18n/resources/en/admin.json")).default as unknown;
    const find = (o: unknown): string | undefined => {
      if (!o || typeof o !== "object") return undefined;
      const r = o as Record<string, unknown>;
      if (typeof r.qrHint === "string") return r.qrHint;
      for (const v of Object.values(r)) {
        const hit = find(v);
        if (hit) return hit;
      }
      return undefined;
    };
    expect(find(de)).toMatch(/läuft nicht ab/);
    expect(find(de)).toMatch(/Schlüssel/);
    expect(find(en)).toMatch(/does not expire/);
  });
});
