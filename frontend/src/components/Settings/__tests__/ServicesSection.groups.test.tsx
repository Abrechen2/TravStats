import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";

vi.mock("../../../lib/api", () => ({
  settingsApi: { getApiKeys: vi.fn().mockResolvedValue({}), testApiKey: vi.fn() },
  adminApi: { testApiKey: vi.fn() },
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: () => false }));
const domains = vi.hoisted(() => ({ on: ["flight"] as string[] }));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: (d: string) => domains.on.includes(d) }),
}));
vi.mock("../ImmichConnectionCard", () => ({ default: () => null }));
vi.mock("../PhotoJourneyNightlyScanCard", () => ({ default: () => null }));
vi.mock("../StravaConnectionCard", () => ({ default: () => null }));
vi.mock("../OpenDataCard", () => ({ default: () => null }));
vi.mock("../ApiKeysSection", () => ({ default: () => <div data-testid="own-flight-keys" /> }));

import { MemoryRouter } from "react-router-dom";
import ServicesSection from "../ServicesSection";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";

const persisted = vi.hoisted(() => vi.fn());
vi.mock("../../../store/persistSetting", () => ({ persistSetting: persisted }));

const page = (isAdmin: boolean) =>
  ({
    user: { isAdmin },
    apiKeysStatus: { airlabs: { hasKey: false, isShared: true, hasAccess: true } },
  }) as unknown as Parameters<typeof ServicesSection>[0]["page"];

const renderSection = (isAdmin = false) =>
  render(
    <MemoryRouter>
      <ServicesSection page={page(isAdmin)} />
    </MemoryRouter>
  );

const group = (id: string) =>
  document.querySelector(`[data-service-group="${id}"]`) as HTMLElement | null;

/**
 * forgejo#321 prototype: Dienste lists every service the account relies on —
 * KI-Parser, Bahn, Karten & Ortssuche included — and says who provides it.
 * Only services that exist in the code; none of these has a personal key.
 */
describe("ServicesSection — the groups of the prototype", () => {
  beforeEach(() => {
    domains.on = ["flight"];
    useSettingsLevelStore.setState({ level: "standard" });
  });
  afterEach(() => {
    cleanup();
    useSettingsLevelStore.setState({ level: null });
  });

  it("lists the KI-Parser and the map services, which the instance runs for everyone", () => {
    renderSection();
    expect(group("cross")!.querySelector('[data-service="llmParser"]')).toHaveTextContent(
      "settings:services.instanceOnly"
    );
    const maps = group("maps")!;
    for (const id of ["photon", "nominatim"]) {
      const row = maps.querySelector(`[data-service="${id}"]`) as HTMLElement;
      expect(row).toHaveTextContent("settings:services.badge.admin");
      // No personal setting exists for them, so no action is offered.
      expect(row.querySelector("[data-service-action]")).toBeNull();
    }
  });

  it("shows the rail services only while the rail domain is on", () => {
    renderSection();
    expect(group("rail")).toBeNull();
    cleanup();
    domains.on = ["flight", "rail"];
    renderSection();
    const ids = Array.from(group("rail")!.querySelectorAll("[data-service]")).map((el) =>
      el.getAttribute("data-service")
    );
    expect(ids).toEqual(["transitous", "dbRest", "openRailRouting"]);
  });

  it("points an admin to administration for the instance's services", () => {
    domains.on = ["flight", "rail"];
    renderSection(true);
    expect(group("rail")!.querySelector("a")).toHaveAttribute(
      "href",
      "/admin/externalServices?section=externalServices&match=Transitous"
    );
  });

  it("offers the own key on a row the admin provides, switching to the expert form", () => {
    renderSection();
    fireEvent.click(within(group("flight")!).getAllByRole("button")[0]);
    const row = group("flight")!.querySelector('[data-service="airlabs"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "settings:services.action.useOwn" }));
    expect(useSettingsLevelStore.getState().level).toBe("expert");
  });
});
