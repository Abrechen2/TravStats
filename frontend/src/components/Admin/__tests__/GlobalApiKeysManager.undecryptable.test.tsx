import { describe, it, expect, vi } from "vitest";
// The services page asks the parser whether a model is there (forgejo#321);
// not the subject here.
vi.mock("../../../hooks/useHasLlm", () => ({ useHasLlm: () => null, resetHasLlmCache: () => {} }));
import { render, screen, within } from "@testing-library/react";

/**
 * beta.22 UAT: the stored global keys could not be decrypted, and the admin
 * view said only "nicht eingerichtet" while users were told the keys were
 * active for everyone. The admin must see WHY the stored key is not in use.
 */
vi.mock("../../../lib/api", () => ({
  adminApi: { testApiKey: vi.fn() },
  settingsApi: { testApiKey: vi.fn(), getApiKeyQuotas: vi.fn().mockResolvedValue({}) },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../AeroapiBudgetCard", () => ({ default: () => null }));
vi.mock("../ImmichGlobalSettings", () => ({ default: () => null }));
vi.mock("../../Settings/OperatorLogosCard", () => ({ default: () => null }));
// The rail group is drawn on every instance since rail left beta (2.7.0-rc.20);
// its card loads its own settings and has its own test (RailProvidersCard.test.tsx).
vi.mock("../../Settings/RailProvidersCard", () => ({ default: () => null }));

import { MemoryRouter } from "react-router-dom";
import GlobalApiKeysManager from "../GlobalApiKeysManager";

describe("GlobalApiKeysManager — a stored key that cannot be decrypted", () => {
  it("names the reason on that provider and on no other", () => {
    render(
      <MemoryRouter>
        <GlobalApiKeysManager
          globalApiKeys={{
            allowUserFlightApiKeys: true,
            undecryptableKeys: ["globalAirlabsApiKey"],
          }}
          parserSettings={{ allowUserApiKeys: true }}
          saving={false}
          onSave={() => {}}
          onGlobalApiKeysChange={() => {}}
          onParserSettingsChange={() => {}}
        />
      </MemoryRouter>
    );
    const airlabs = document.querySelector('[data-service="airlabs"]') as HTMLElement;
    expect(within(airlabs).getByText("admin:globalApiKeys.undecryptable")).toBeInTheDocument();
    expect(within(airlabs).getByText("settings:services.badge.none")).toBeInTheDocument();
    expect(screen.getAllByText("admin:globalApiKeys.undecryptable")).toHaveLength(1);
  });
});
