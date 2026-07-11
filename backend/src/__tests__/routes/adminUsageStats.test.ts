jest.mock("../../services/usageStats", () => ({
  getConsent: jest.fn(),
  setConsent: jest.fn(),
  getInstallId: jest.fn(),
  getOrCreateInstallId: jest.fn(),
  getStatsBaseUrl: jest.fn(),
  usageStatsTick: jest.fn(),
  sendErasure: jest.fn(),
}));

import type { Response, NextFunction } from "express";
import { usageStatsConsentSchema, applyConsentChange } from "../../routes/admin/usageStats";
import type { AuthRequest } from "../../middleware/auth";
import {
  setConsent,
  getInstallId,
  getOrCreateInstallId,
  getStatsBaseUrl,
  usageStatsTick,
  sendErasure,
} from "../../services/usageStats";

beforeEach(() => {
  jest.clearAllMocks();
  (getStatsBaseUrl as jest.Mock).mockReturnValue("https://stats.test");
  (getInstallId as jest.Mock).mockResolvedValue("abc123");
  (getOrCreateInstallId as jest.Mock).mockResolvedValue("abc123");
  (usageStatsTick as jest.Mock).mockResolvedValue(undefined);
  (sendErasure as jest.Mock).mockResolvedValue(true);
});

describe("usageStatsConsentSchema", () => {
  it("accepts granted and denied", () => {
    expect(usageStatsConsentSchema.parse({ consent: "granted" }).consent).toBe("granted");
    expect(usageStatsConsentSchema.parse({ consent: "denied" }).consent).toBe("denied");
  });

  it("rejects unset — the API never sets it back to unset", () => {
    expect(() => usageStatsConsentSchema.parse({ consent: "unset" })).toThrow();
  });

  it("rejects an arbitrary string", () => {
    expect(() => usageStatsConsentSchema.parse({ consent: "yes" })).toThrow();
  });
});

describe("applyConsentChange", () => {
  it("persists then fires an immediate ping on grant", async () => {
    await applyConsentChange("granted");
    expect(setConsent).toHaveBeenCalledWith("granted");
    expect(usageStatsTick).toHaveBeenCalledTimes(1);
    expect(sendErasure).not.toHaveBeenCalled();
  });

  it("erases the server row BEFORE persisting the denial", async () => {
    const order: string[] = [];
    (sendErasure as jest.Mock).mockImplementation(async () => {
      order.push("erase");
      return true;
    });
    (setConsent as jest.Mock).mockImplementation(async () => {
      order.push("persist");
    });
    await applyConsentChange("denied");
    expect(order).toEqual(["erase", "persist"]);
    expect(sendErasure).toHaveBeenCalledWith("abc123", "https://stats.test");
  });

  it("still persists the denial when erasure fails", async () => {
    (sendErasure as jest.Mock).mockRejectedValue(new Error("offline"));
    await expect(applyConsentChange("denied")).resolves.toBeUndefined();
    expect(setConsent).toHaveBeenCalledWith("denied");
  });

  it("skips erasure when there is no install id yet", async () => {
    (getInstallId as jest.Mock).mockResolvedValue(null);
    await applyConsentChange("denied");
    expect(sendErasure).not.toHaveBeenCalled();
    expect(setConsent).toHaveBeenCalledWith("denied");
  });

  it("skips network work entirely when the endpoint is disabled", async () => {
    (getStatsBaseUrl as jest.Mock).mockReturnValue("");
    await applyConsentChange("denied");
    expect(sendErasure).not.toHaveBeenCalled();
    await applyConsentChange("granted");
    expect(usageStatsTick).not.toHaveBeenCalled();
  });

  it("does not block the caller on the immediate ping after granting", async () => {
    let resolveTick: () => void = () => {};
    (usageStatsTick as jest.Mock).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveTick = resolve;
        }),
    );
    // Must resolve even though the tick is still pending.
    await applyConsentChange("granted");
    expect(setConsent).toHaveBeenCalledWith("granted");
    resolveTick();
  });

  it("swallows a rejected immediate ping without failing the grant", async () => {
    (usageStatsTick as jest.Mock).mockRejectedValue(new Error("endpoint down"));
    await expect(applyConsentChange("granted")).resolves.toBeUndefined();
    expect(setConsent).toHaveBeenCalledWith("granted");
  });

  it("still persists the denial when reading the install id throws", async () => {
    (getInstallId as jest.Mock).mockRejectedValue(new Error("db blip"));
    await expect(applyConsentChange("denied")).resolves.toBeUndefined();
    expect(setConsent).toHaveBeenCalledWith("denied");
    expect(sendErasure).not.toHaveBeenCalled();
  });
});

describe("PUT /usage-stats handler", () => {
  async function callPutHandler(body: {
    consent: "granted" | "denied";
  }): Promise<{ json: unknown; next: jest.Mock }> {
    const { default: router } = await import("../../routes/admin/usageStats");

    const req = { body } as unknown as AuthRequest;
    const jsonResponse = jest.fn();
    const res = { json: jsonResponse } as unknown as Response;
    const next: NextFunction = jest.fn();

    const putHandler = router.stack.find(
      (layer: { route?: { methods?: Record<string, boolean> } }) =>
        layer.route?.methods?.put
    )?.route?.stack[0]?.handle as
      | ((req: AuthRequest, res: Response, next: NextFunction) => Promise<void>)
      | undefined;

    if (!putHandler) {
      throw new Error("PUT /usage-stats handler not found");
    }

    await putHandler(req, res, next);
    return { json: jsonResponse.mock.calls[0]?.[0], next: next as jest.Mock };
  }

  it("mints the install id eagerly on grant, instead of leaving it null", async () => {
    (getOrCreateInstallId as jest.Mock).mockResolvedValue("fresh-id");
    (setConsent as jest.Mock).mockResolvedValue(undefined);
    (usageStatsTick as jest.Mock).mockResolvedValue(undefined);

    const { json, next } = await callPutHandler({ consent: "granted" });

    expect(getOrCreateInstallId).toHaveBeenCalledTimes(1);
    expect(getInstallId).not.toHaveBeenCalled();
    expect(json).toEqual({ consent: "granted", installId: "fresh-id", endpointConfigured: true });
    expect(next).not.toHaveBeenCalled();
  });

  it("uses getInstallId (never mints) on denial", async () => {
    // applyConsentChange itself also reads getInstallId once (for the erasure
    // check), so this asserts "at least once" rather than an exact count.
    (getInstallId as jest.Mock).mockResolvedValue("abc123");
    (setConsent as jest.Mock).mockResolvedValue(undefined);

    const { json, next } = await callPutHandler({ consent: "denied" });

    expect(getInstallId).toHaveBeenCalled();
    expect(getOrCreateInstallId).not.toHaveBeenCalled();
    expect(json).toEqual({ consent: "denied", installId: "abc123", endpointConfigured: true });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns installId null when getOrCreateInstallId fails on response read-back after a grant", async () => {
    // The consent change itself already persisted via applyConsentChange — only
    // the response read-back fails here. Must not turn a successful request into
    // a 500.
    (getOrCreateInstallId as jest.Mock).mockRejectedValue(new Error("transient database error"));
    (setConsent as jest.Mock).mockResolvedValue(undefined);
    (usageStatsTick as jest.Mock).mockResolvedValue(undefined);

    const { json, next } = await callPutHandler({ consent: "granted" });

    expect(json).toEqual({ consent: "granted", installId: null, endpointConfigured: true });
    // Must not call next(error) — that would be a 500
    expect(next).not.toHaveBeenCalled();
  });
});
