import { describe, it, expect, vi } from "vitest";
// The AeroAPI budget footer (forgejo#409) fetches /admin/aeroapi; it has its own test.
vi.mock("../AeroapiBudgetCard", () => ({ default: () => null }));
vi.mock("../../../hooks/useHasLlm", () => ({ useHasLlm: () => null, resetHasLlmCache: () => {} }));
vi.mock("../ImmichGlobalSettings", () => ({ default: () => null }));
vi.mock("../../Settings/OperatorLogosCard", () => ({ default: () => null }));
vi.mock("../../Settings/RailProvidersCard", () => ({ default: () => null }));
const adminApi = vi.hoisted(() => ({
  getGlobalApiKeys: vi.fn().mockResolvedValue({}),
  updateGlobalApiKeys: vi.fn(),
  testApiKey: vi.fn(),
}));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  adminApi,
}));
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GlobalApiKeysManager, { type GlobalApiKeys } from "../GlobalApiKeysManager";

/**
 * forgejo#408: adsb.lol and ADS-B Exchange are opt-in. adsb.lol is keyless, so
 * the admin needs a switch (default off) next to its optional key; ADS-B
 * Exchange is a key card like the other flight providers.
 */
const baseKeys: GlobalApiKeys = { allowUserFlightApiKeys: true };

function renderManager(keys: GlobalApiKeys, onChange = vi.fn()) {
  render(
    <MemoryRouter>
      <GlobalApiKeysManager
        globalApiKeys={keys}
        parserSettings={{ allowUserApiKeys: true }}
        saving={false}
        onSave={vi.fn()}
        onGlobalApiKeysChange={onChange}
        onParserSettingsChange={vi.fn()}
      />
    </MemoryRouter>
  );
  return onChange;
}

describe("Administration → Externe Dienste — ADS-B providers", () => {
  it("lists adsb.lol and ADS-B Exchange in the flight group", () => {
    renderManager(baseKeys);
    const group = document.querySelector('[data-service-group="flight"]');
    expect(group).toHaveTextContent("adsb.lol");
    expect(group).toHaveTextContent("ADS-B Exchange");
  });

  it("switching adsb.lol on is sent as adsbLolEnabled, and it is off by default", () => {
    const onChange = renderManager(baseKeys);
    const group = document.querySelector('[data-service-group="flight"]') as HTMLElement;
    // Open the row so its body is in the DOM.
    fireEvent.click(screen.getAllByText("adsb.lol")[0].closest("button") ?? group);
    const toggle = document.getElementById("adsblol-enabled") as HTMLInputElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle!.checked).toBe(false);
    fireEvent.click(toggle!);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ adsbLolEnabled: true }));
  });
});
