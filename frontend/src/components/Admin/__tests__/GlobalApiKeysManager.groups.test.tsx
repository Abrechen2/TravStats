import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../lib/api", () => ({
  adminApi: { testApiKey: vi.fn(), getInstanceSettings: vi.fn(() => new Promise(() => {})) },
  settingsApi: { testApiKey: vi.fn(), getApiKeyQuotas: vi.fn().mockResolvedValue({}) },
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../ImmichGlobalSettings", () => ({ default: () => null }));
vi.mock("../../Settings/OperatorLogosCard", () => ({ default: () => null }));
vi.mock("../../Settings/GeocoderSettingsCard", () => ({
  default: () => <div data-testid="geocoder-card" />,
}));

import GlobalApiKeysManager from "../GlobalApiKeysManager";
import { isLlmConfigured } from "../llmConfigured";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";

const renderManager = (llmConfigured?: boolean) =>
  render(
    <MemoryRouter>
      <GlobalApiKeysManager
        globalApiKeys={{ allowUserFlightApiKeys: true }}
        parserSettings={{ allowUserApiKeys: true, llmConfigured }}
        saving={false}
        onSave={() => {}}
        onGlobalApiKeysChange={() => {}}
        onParserSettingsChange={() => {}}
      />
    </MemoryRouter>
  );

/** forgejo#321 prototype: Externe Dienste gains Karten & Ortssuche and the KI-Parser row. */
describe("GlobalApiKeysManager — Karten & Ortssuche and the KI-Parser", () => {
  afterEach(() => {
    cleanup();
    useSettingsLevelStore.setState({ level: null });
  });

  it("lists Photon and Nominatim, with their addresses only at the expert level", () => {
    useSettingsLevelStore.setState({ level: "standard" });
    renderManager();
    const maps = document.querySelector('[data-service-group="maps"]') as HTMLElement;
    expect(maps.querySelector('[data-service="photon"]')).toHaveTextContent(
      "settings:services.badge.setUp"
    );
    expect(maps.querySelector('[data-service="nominatim"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="geocoder-card"]')).toBeNull();
    cleanup();
    useSettingsLevelStore.setState({ level: "expert" });
    renderManager();
    expect(document.querySelector('[data-testid="geocoder-card"]')).not.toBeNull();
  });

  it("says whether a language model is set up, and points to Import & Parser", () => {
    renderManager(true);
    const row = document.querySelector('[data-service="llmParser"]') as HTMLElement;
    expect(row).toHaveTextContent("settings:services.badge.setUp");
    expect(row.querySelector("a")).toHaveAttribute("href", "/admin/parsers");
    cleanup();
    renderManager(false);
    expect(document.querySelector('[data-service="llmParser"]')).toHaveTextContent(
      "settings:services.badge.none"
    );
  });
});

describe("isLlmConfigured", () => {
  const base = {
    allowUserApiKeys: false,
    fxCdnFallbackEnabled: false,
    ollamaUrl: null,
    ollamaModel: null,
  };
  it.each([
    [{}, false],
    [{ ollamaUrl: "http://o", ollamaModel: "m" }, true],
    [{ ollamaUrl: "http://o", ollamaModel: "m", llmEnabled: false }, false],
    [{ llmOpenaiApiKey: "k" }, false],
    [{ llmOpenaiApiKey: "k", llmOpenaiOptIn: true }, true],
    [{ openaiCompatBaseUrl: "http://lan", openaiCompatIsCloud: false }, true],
    [{ openaiCompatBaseUrl: "https://cloud", openaiCompatIsCloud: true }, false],
  ])("reads %j as %s", (extra, expected) => {
    expect(isLlmConfigured({ ...base, ...extra })).toBe(expected);
  });
});
