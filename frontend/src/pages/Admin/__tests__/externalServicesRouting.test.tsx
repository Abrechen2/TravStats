import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Alex, Discord 2026-09-26: "Externe Dienste" in the administration had no
 * "Routing-Anbieter" section, while the personal settings page carried the
 * instance's routing card. The provider and the instance key are instance
 * configuration; the key resolves user → instance → environment
 * (`apiKeyResolver.getApiKey`), so the instance half belongs here.
 */
const tours = vi.hoisted(() => ({ visible: true }));
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: () => tours.visible }));
vi.mock("../../../components/Admin/GlobalApiKeysManager", () => ({
  default: () => <div data-testid="global-api-keys" />,
}));
vi.mock("../../../components/Admin/ImmichGlobalSettings", () => ({
  default: () => <div data-testid="immich-global" />,
}));
const adminApi = vi.hoisted(() => ({
  getGlobalApiKeys: vi.fn(),
  updateGlobalApiKeys: vi.fn(),
  testApiKey: vi.fn(),
}));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  adminApi,
}));

import AdminSectionSwitch, { type AdminSectionSwitchProps } from "../AdminSectionSwitch";

const props = {
  section: "externalServices",
  globalApiKeys: null,
  parserSettings: null,
  savingGlobalApiKeys: false,
  savingParsers: false,
  onSaveGlobalApiKeys: vi.fn(),
  onGlobalApiKeysChange: vi.fn(),
  onParserApiKeySettingsChange: vi.fn(),
} as unknown as AdminSectionSwitchProps;

const renderSection = () =>
  render(
    <MemoryRouter>
      <AdminSectionSwitch {...props} />
    </MemoryRouter>
  );

describe("Administration → Externe Dienste — the routing provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminApi.getGlobalApiKeys.mockResolvedValue({
      routingProvider: "openrouteservice",
      routingCustomUrl: null,
      globalOpenrouteserviceApiKey: "abcd****wxyz",
    });
  });

  it("holds the instance's provider choice and its masked key", async () => {
    tours.visible = true;
    renderSection();
    expect(await screen.findByText("settings:routing.title")).toBeInTheDocument();
    expect(screen.getByTestId("global-api-keys")).toBeInTheDocument();
    expect(adminApi.getGlobalApiKeys).toHaveBeenCalled();
  });

  it("stays out while tours and roadtrips, its only consumers, are behind the switch", () => {
    tours.visible = false;
    renderSection();
    expect(screen.queryByText("settings:routing.title")).toBeNull();
    expect(adminApi.getGlobalApiKeys).not.toHaveBeenCalled();
  });
});
