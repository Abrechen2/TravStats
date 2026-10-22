import { describe, it, expect, vi } from "vitest";
// The services page asks the parser whether a model is there (forgejo#321);
// not the subject here.
vi.mock("../../../hooks/useHasLlm", () => ({ useHasLlm: () => null, resetHasLlmCache: () => {} }));
import { render, waitFor } from "@testing-library/react";

/**
 * beta.23 UAT: the admin "Bahn" group said "0 für alle aktiv" although
 * Transitous and db-rest were both switched on. Keyless services have no key
 * to count, so the group counted nothing; a service that is on IS active for
 * everyone on this instance.
 */
const adminApi = vi.hoisted(() => ({
  testApiKey: vi.fn(),
  getInstanceSettings: vi.fn(),
  updateInstanceSettings: vi.fn(),
}));
vi.mock("../../../lib/api", () => ({
  adminApi,
  settingsApi: { testApiKey: vi.fn(), getApiKeyQuotas: vi.fn().mockResolvedValue({}) },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && "shared" in opts ? `${key}:${String(opts.shared)}/${String(opts.own)}` : key,
    i18n: { language: "en" },
  }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../hooks/useDomainVisible", () => ({ useDomainOffered: () => true }));
vi.mock("../ImmichGlobalSettings", () => ({ default: () => null }));
vi.mock("../../Settings/OperatorLogosCard", () => ({ default: () => null }));

import { MemoryRouter } from "react-router-dom";
import GlobalApiKeysManager from "../GlobalApiKeysManager";

const renderManager = () =>
  render(
    <MemoryRouter>
      <GlobalApiKeysManager
        globalApiKeys={{ allowUserFlightApiKeys: true }}
        parserSettings={{ allowUserApiKeys: true }}
        saving={false}
        onSave={() => {}}
        onGlobalApiKeysChange={() => {}}
        onParserSettingsChange={() => {}}
      />
    </MemoryRouter>
  );

const railSummary = (): string =>
  document.querySelector('[data-service-group="rail"] [data-service-summary]')?.textContent ?? "";

describe("GlobalApiKeysManager — keyless services that are on", () => {
  it("counts switched-on rail lookups as active for everyone", async () => {
    adminApi.getInstanceSettings.mockResolvedValue({
      settings: { railTransitousEnabled: true, railDbRestEnabled: true, railRoutingUrl: null },
    });
    renderManager();
    await waitFor(() => expect(railSummary()).toMatch(/summaryAdmin:2\//));
  });

  it("counts nothing while both lookups are off", async () => {
    adminApi.getInstanceSettings.mockResolvedValue({
      settings: { railTransitousEnabled: false, railDbRestEnabled: false, railRoutingUrl: null },
    });
    renderManager();
    await waitFor(() =>
      expect(document.querySelector('[data-service="transitous"]')).toHaveTextContent(
        "settings:services.badge.none"
      )
    );
    expect(railSummary()).toMatch(/summaryAdmin:0\//);
  });
});
