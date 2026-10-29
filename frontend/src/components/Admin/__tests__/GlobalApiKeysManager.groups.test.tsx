import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../lib/api", () => ({
  adminApi: { testApiKey: vi.fn(), getInstanceSettings: vi.fn(() => new Promise(() => {})) },
  settingsApi: { testApiKey: vi.fn(), getApiKeyQuotas: vi.fn().mockResolvedValue({}) },
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../AeroapiBudgetCard", () => ({ default: () => null }));
vi.mock("../ImmichGlobalSettings", () => ({ default: () => null }));
vi.mock("../../Settings/OperatorLogosCard", () => ({ default: () => null }));
const llm = vi.hoisted(() => ({ value: null as boolean | "disabled" | null }));
vi.mock("../../../hooks/useHasLlm", () => ({ useHasLlm: () => llm.value }));
vi.mock("../../Settings/GeocoderSettingsCard", () => ({
  default: () => <div data-testid="geocoder-card" />,
}));

import GlobalApiKeysManager from "../GlobalApiKeysManager";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";

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

  // Codex review: the row reads the parser's own answer, so a custom endpoint
  // without a model or a remote Ollama without consent reads as not set up.
  it("badges the KI-Parser by the parser's own answer, and points to Import & Parser", () => {
    llm.value = true;
    renderManager();
    const row = document.querySelector('[data-service="llmParser"]') as HTMLElement;
    expect(row).toHaveTextContent("settings:services.badge.setUp");
    expect(row.querySelector("a")).toHaveAttribute("href", "/admin/parsers");
    for (const answer of [false, "disabled"] as const) {
      cleanup();
      llm.value = answer;
      renderManager();
      expect(document.querySelector('[data-service="llmParser"]')).toHaveTextContent(
        "settings:services.badge.none"
      );
    }
    cleanup();
    llm.value = null;
    renderManager();
    expect(document.querySelector('[data-service="llmParser"]')).not.toHaveTextContent(
      "settings:services.badge"
    );
  });
});
