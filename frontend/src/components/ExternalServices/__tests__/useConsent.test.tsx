import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UseConsentList from "../UseConsentList";
import {
  serviceUseApi,
  UseCancelledError,
  withUseConsent,
  type ServiceDisclosure,
} from "../../../lib/api/serviceUse";

/** The confirmation in front of every outbound use, and its revocation (owner 2026-11-25). */

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../lib/api/client", () => ({ api: { get: vi.fn(), delete: vi.fn() } }));

const disclosure = (host: string): ServiceDisclosure => ({
  serviceId: "mapMatching",
  host,
  provider: "valhalla",
  location: "lan",
  fields: ["points"],
  pointCount: 12,
  privacyZonesApplied: true,
});
const confirmFirst = (host: string) =>
  new AxiosError("409", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 409,
    data: { code: "CONFIRMATION_REQUIRED", disclosure: disclosure(host) },
    statusText: "Conflict",
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

describe("withUseConsent", () => {
  it("sends the confirmation the person gave, and nothing before it", async () => {
    const send = vi.fn().mockRejectedValueOnce(confirmFirst("a.lan")).mockResolvedValueOnce("ok");
    const ask = vi.fn().mockResolvedValue({ mode: "always", target: "valhalla@a.lan" });
    await expect(withUseConsent(send, ask)).resolves.toBe("ok");
    expect(send.mock.calls).toEqual([[undefined], [{ mode: "always", target: "valhalla@a.lan" }]]);
  });

  it("asks again when the target changed between the two requests", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(confirmFirst("a.lan"))
      .mockRejectedValueOnce(confirmFirst("b.lan"))
      .mockResolvedValueOnce("ok");
    const ask = vi
      .fn()
      .mockResolvedValueOnce({ mode: "once", target: "valhalla@a.lan" })
      .mockResolvedValueOnce({ mode: "once", target: "valhalla@b.lan" });
    await withUseConsent(send, ask);
    expect(ask.mock.calls.map(([d]) => d.host)).toEqual(["a.lan", "b.lan"]);
  });

  it("a cancelled dialog sends nothing further", async () => {
    const send = vi.fn().mockRejectedValueOnce(confirmFirst("a.lan"));
    await expect(withUseConsent(send, vi.fn().mockResolvedValue(null))).rejects.toBeInstanceOf(
      UseCancelledError
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("passes any other failure through as itself", async () => {
    const boom = new Error("network");
    await expect(withUseConsent(vi.fn().mockRejectedValue(boom), vi.fn())).rejects.toBe(boom);
  });
});

describe("UseConsentList", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists a standing permission and revokes it", async () => {
    const list = vi
      .spyOn(serviceUseApi, "list")
      .mockResolvedValueOnce([
        { serviceId: "mapMatching", at: "2026-11-25T08:00:00Z", target: "valhalla@a.lan" },
      ])
      .mockResolvedValueOnce([]);
    const revoke = vi.spyOn(serviceUseApi, "revoke").mockResolvedValue();
    render(<UseConsentList />);
    await userEvent.click(await screen.findByTestId("use-consent-revoke-mapMatching"));
    expect(revoke).toHaveBeenCalledWith("mapMatching");
    expect(await screen.findByText("externalServices:useConsent.listEmpty")).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("says when the list cannot be loaded", async () => {
    vi.spyOn(serviceUseApi, "list").mockRejectedValue(new Error("down"));
    render(<UseConsentList />);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("externalServices:useConsent.loadFailed")
    );
  });
});
