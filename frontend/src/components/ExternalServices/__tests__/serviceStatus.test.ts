import { describe, expect, it } from "vitest";
import { accountStatus, adminStatus, budgetPercent } from "../serviceStatus";
import { service } from "./fixtures";

describe("service status has dimensions, not one word", () => {
  it("shows an enabled service without its credential as 'missing', never as active", () => {
    expect(adminStatus(service({ id: "x", configured: false }))).toBe("missing");
  });

  it("shows an admin 'off' as off even when a key is stored and the last test failed", () => {
    const s = service({
      id: "x",
      enabled: false,
      lastTest: { at: "2026-10-30T10:00:00Z", ok: false, reason: "auth" },
    });
    expect(adminStatus(s)).toBe("off");
  });

  it("shows a failed last test of an enabled, configured service as an error", () => {
    const s = service({
      id: "x",
      lastTest: { at: "2026-10-30T10:00:00Z", ok: false, reason: "auth" },
    });
    expect(adminStatus(s)).toBe("error");
  });

  it("gives no budget percentage when the limit is unknown, and clamps an overrun", () => {
    expect(budgetPercent(null)).toBeNull();
    expect(budgetPercent({ kind: "budget", used: 1 })).toBeNull();
    expect(budgetPercent({ kind: "budget", used: 25, limit: 10 })).toBe(100);
  });

  it("reads an account's off state before its source", () => {
    const base = {
      id: "x",
      recommended: null,
      configured: true,
      lastTest: null,
      fields: [],
    };
    expect(
      accountStatus({ ...base, effectiveSource: "account", accountDisabled: true }, "key")
    ).toBe("off");
    expect(
      accountStatus({ ...base, effectiveSource: "instance", accountDisabled: false }, "key")
    ).toBe("viaInstance");
    expect(
      accountStatus({ ...base, effectiveSource: "off", accountDisabled: false }, "connection")
    ).toBe("off");
  });
});
