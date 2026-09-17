import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

/**
 * T5 (2026-09-17 tester feedback): MapContainer3D's outer wrapper carried
 * `rounded-lg shadow-sm` for every consumer, though the map is full-bleed
 * under DashboardLayout — a rounded corner with nothing outside it to
 * separate from just reads as a clipped map.
 */

vi.mock("../DeckGLMap", () => ({
  DeckGLMap: () => null,
}));

vi.mock("../GlobeView", () => ({
  default: () => null,
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: [], isEnabled: () => false }),
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

// Imported after the mocks above so the module graph picks them up.
import MapContainer3D from "../MapContainer3D";

describe("MapContainer3D: no rounded corners or shadow on the full-bleed wrapper", () => {
  it("does not carry rounded-lg or shadow-sm on the outer element", () => {
    const { container } = render(
      <MapContainer3D flights={[]} visMode="routes" showInternalCruises={false} />
    );

    const wrapper = container.querySelector("[data-map-theme]");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).not.toMatch(/\brounded-lg\b/);
    expect(wrapper?.className).not.toMatch(/\bshadow-sm\b/);
  });
});
