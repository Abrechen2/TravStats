import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  getApiKeys: vi.fn().mockResolvedValue({}),
  testApiKey: vi.fn(),
  getInstanceServices: vi.fn(),
}));
vi.mock("../../../lib/api", () => ({ settingsApi: api, adminApi: { testApiKey: vi.fn() } }));
vi.mock("../../../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: () => false }));
const domains = vi.hoisted(() => ({ on: ["flight", "rail"] as string[] }));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: (d: string) => domains.on.includes(d) }),
}));
vi.mock("../../../hooks/useHasLlm", () => ({ useHasLlm: () => true }));
vi.mock("../ImmichConnectionCard", () => ({ default: () => null }));
vi.mock("../PhotoJourneyNightlyScanCard", () => ({ default: () => null }));
vi.mock("../StravaConnectionCard", () => ({ default: () => null }));
vi.mock("../OpenDataCard", () => ({ default: () => null }));
vi.mock("../ApiKeysSection", () => ({ default: () => null }));

import { MemoryRouter } from "react-router-dom";
import ServicesSection from "../ServicesSection";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";

const page = { user: { isAdmin: false }, apiKeysStatus: {} } as unknown as Parameters<
  typeof ServicesSection
>[0]["page"];

const row = (id: string) =>
  document.querySelector(`[data-service-group="rail"] [data-service="${id}"]`) as HTMLElement;

/**
 * Owner item 1 (forgejo#321): the rail services were drawn with no status for
 * an ordinary account, because only an admin could read their switches. The
 * account-visible read gives each row its badge — and a failed read says so.
 */
describe("ServicesSection — the instance's keyless services", () => {
  beforeEach(() => {
    domains.on = ["flight", "rail"];
    api.getInstanceServices.mockReset();
    useSettingsLevelStore.setState({ level: "standard" });
  });
  afterEach(() => {
    cleanup();
    useSettingsLevelStore.setState({ level: null });
  });

  it("badges each rail service on or off as the instance answers", async () => {
    api.getInstanceServices.mockResolvedValue({
      transitous: true,
      dbRest: false,
      openRailRouting: true,
    });
    render(
      <MemoryRouter>
        <ServicesSection page={page} />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(row("transitous")).toHaveTextContent("settings:services.badge.admin")
    );
    expect(row("dbRest")).toHaveTextContent("settings:services.badge.none");
    expect(row("openRailRouting")).toHaveTextContent("settings:services.badge.admin");
  });

  it("says the status could not be read instead of drawing rows without one", async () => {
    api.getInstanceServices.mockRejectedValue(new Error("429"));
    render(
      <MemoryRouter>
        <ServicesSection page={page} />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(document.querySelector('[data-testid="instance-services-failed"]')).not.toBeNull()
    );
    expect(row("transitous")).not.toHaveTextContent("settings:services.badge");
  });

  it("does not ask while the rail domain is off", () => {
    domains.on = ["flight"];
    render(
      <MemoryRouter>
        <ServicesSection page={page} />
      </MemoryRouter>
    );
    expect(api.getInstanceServices).not.toHaveBeenCalled();
  });
});
