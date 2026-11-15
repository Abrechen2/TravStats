import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  remove: vi.fn(),
  removeOld: vi.fn(),
}));
vi.mock("../../../lib/api/tokens", () => ({ apiTokensApi: api }));
vi.mock("../../../lib/api/pairing", () => ({ pairingApi: { start: vi.fn(), status: vi.fn() } }));
vi.mock("../PushStateRow", () => ({ default: () => null }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
const demo = vi.hoisted(() => ({ value: false }));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo.value }));

import ApiTokensSection from "../ApiTokensSection";
import DevicesSection from "../DevicesSection";

const base = {
  prefix: "ts_pat_",
  scope: "read",
  lastUsedAt: null,
  lastUsedIp: null,
  expiresAt: null,
  createdAt: "2026-09-01T00:00:00Z",
  platform: "ios",
};
const ACTIVE = { ...base, id: "a", label: "Live key", revokedAt: null, deviceId: null };
const REVOKED = {
  ...base,
  id: "r",
  label: "Old key",
  revokedAt: "2026-09-02T00:00:00Z",
  deviceId: null,
};
const EXPIRED = {
  ...base,
  id: "e",
  label: "Expired key",
  revokedAt: null,
  expiresAt: "2020-01-01T00:00:00Z",
  deviceId: null,
};
const PHONE_OLD = { ...REVOKED, id: "p", label: "Old phone", deviceId: "dev-1" };
const PHONE_LIVE = { ...ACTIVE, id: "pl", label: "Live phone", deviceId: "dev-2" };

const axiosError = (status: number, data: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  });

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  demo.value = false;
});

describe("ApiTokensSection removal of old keys", () => {
  beforeEach(() => api.list.mockResolvedValue([ACTIVE, REVOKED, EXPIRED]));

  it("offers Entfernen on revoked and expired keys only, and removes one after confirming", async () => {
    api.remove.mockResolvedValue(undefined);
    render(<ApiTokensSection />);
    await screen.findByText("Old key");
    const buttons = screen.getAllByRole("button", { name: "settings:apiTokens.removeButton" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    fireEvent.click(
      await screen.findByRole("button", { name: "settings:apiTokens.removeDialog.confirm" })
    );
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("r"));
  });

  it("removes all old keys through one call, after confirming", async () => {
    api.removeOld.mockResolvedValue(2);
    render(<ApiTokensSection />);
    await screen.findByText("Old key");
    fireEvent.click(screen.getByRole("button", { name: "settings:apiTokens.removeAllButton" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "settings:apiTokens.removeAllDialog.confirm" })
    );
    await waitFor(() => expect(api.removeOld).toHaveBeenCalledTimes(1));
  });

  it("shows the server's TOKEN_STILL_ACTIVE refusal as copy, not as the code", async () => {
    api.remove.mockRejectedValue(
      axiosError(409, { error: "TOKEN_STILL_ACTIVE", code: "TOKEN_STILL_ACTIVE" })
    );
    render(<ApiTokensSection />);
    await screen.findByText("Old key");
    fireEvent.click(screen.getAllByRole("button", { name: "settings:apiTokens.removeButton" })[0]);
    fireEvent.click(
      await screen.findByRole("button", { name: "settings:apiTokens.removeDialog.confirm" })
    );
    expect(await screen.findByText("settings:apiTokens.errors.removeActive")).toBeInTheDocument();
    expect(screen.queryByText("TOKEN_STILL_ACTIVE")).toBeNull();
  });

  it("says so when removing fails, instead of looking as if it worked", async () => {
    api.remove.mockRejectedValue(axiosError(500, { error: "boom" }));
    render(<ApiTokensSection />);
    await screen.findByText("Old key");
    fireEvent.click(screen.getAllByRole("button", { name: "settings:apiTokens.removeButton" })[0]);
    fireEvent.click(
      await screen.findByRole("button", { name: "settings:apiTokens.removeDialog.confirm" })
    );
    expect(await screen.findByText("settings:apiTokens.errors.remove")).toBeInTheDocument();
  });

  it("says so when the bulk removal fails", async () => {
    api.removeOld.mockRejectedValue(axiosError(500, { error: "boom" }));
    render(<ApiTokensSection />);
    await screen.findByText("Old key");
    fireEvent.click(screen.getByRole("button", { name: "settings:apiTokens.removeAllButton" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "settings:apiTokens.removeAllDialog.confirm" })
    );
    expect(await screen.findByText("settings:apiTokens.errors.removeAll")).toBeInTheDocument();
  });

  it("shows no bulk action when every key is active", async () => {
    api.list.mockResolvedValue([ACTIVE]);
    render(<ApiTokensSection />);
    await screen.findByText("Live key");
    expect(screen.queryByRole("button", { name: "settings:apiTokens.removeAllButton" })).toBeNull();
  });

  it("offers no removal to the demo account", async () => {
    demo.value = true;
    render(<ApiTokensSection />);
    await screen.findByText("Old key");
    expect(screen.queryByRole("button", { name: "settings:apiTokens.removeButton" })).toBeNull();
    expect(screen.queryByRole("button", { name: "settings:apiTokens.removeAllButton" })).toBeNull();
  });
});

describe("DevicesSection removal of old phones", () => {
  beforeEach(() => api.list.mockResolvedValue([PHONE_LIVE, PHONE_OLD, ACTIVE]));

  it("offers Entfernen on an unpaired phone only, and removes it after confirming", async () => {
    api.remove.mockResolvedValue(undefined);
    render(<DevicesSection />);
    await screen.findByText("Old phone");
    const buttons = screen.getAllByRole("button", { name: "settings:devices.removeButton" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    fireEvent.click(
      await screen.findByRole("button", { name: "settings:devices.removeDialog.confirm" })
    );
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("p"));
  });

  it("removes all old phones in one call", async () => {
    api.removeOld.mockResolvedValue(1);
    render(<DevicesSection />);
    await screen.findByText("Old phone");
    fireEvent.click(screen.getByRole("button", { name: "settings:devices.removeAllButton" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "settings:devices.removeAllDialog.confirm" })
    );
    await waitFor(() => expect(api.removeOld).toHaveBeenCalledTimes(1));
  });

  it("tells the user when removing a phone fails", async () => {
    api.remove.mockRejectedValue(axiosError(409, { error: "TOKEN_STILL_ACTIVE" }));
    render(<DevicesSection />);
    await screen.findByText("Old phone");
    fireEvent.click(screen.getByRole("button", { name: "settings:devices.removeButton" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "settings:devices.removeDialog.confirm" })
    );
    expect(await screen.findByText("settings:devices.errors.removeActive")).toBeInTheDocument();
  });

  it("offers no removal to the demo account", async () => {
    demo.value = true;
    render(<DevicesSection />);
    await screen.findByText("Old phone");
    expect(screen.queryByRole("button", { name: "settings:devices.removeButton" })).toBeNull();
    expect(screen.queryByRole("button", { name: "settings:devices.removeAllButton" })).toBeNull();
  });
});
