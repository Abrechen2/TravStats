import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    settingsApi: { ...actual.settingsApi, update: vi.fn().mockResolvedValue(undefined) },
  };
});
vi.unmock("../../../store/settingsStore");

const mockBeta = vi.hoisted(() => vi.fn(() => false));
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ isFeatureVisible: (key: string) => key === "roadtrips" && mockBeta() }),
}));

import ModuleSection from "../ModuleSection";
import { useSettingsStore } from "../../../store/settingsStore";

/**
 * "Bereiche & Farben" (forgejo#321): the module switch and the domain colour
 * were two sections listing the same domains twice; they are one row per
 * domain now. The roadtrip assertion is the one `DomainColorSection.test`
 * carried, moved here with the colour picker it tested.
 */
describe("ModuleSection — one row per domain, switch and colour", () => {
  beforeEach(() => {
    mockBeta.mockReturnValue(false);
    useSettingsStore.setState({ enabledDomains: ["flight"] });
  });

  it("offers no roadtrip colour while the roadtrips beta is closed, and offers it once open", () => {
    const { unmount } = render(<ModuleSection />);
    expect(screen.queryByLabelText(/roadtrip/i)).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/flight/i).length).toBeGreaterThan(0);
    unmount();

    mockBeta.mockReturnValue(true);
    render(<ModuleSection />);
    expect(screen.getAllByLabelText(/roadtrip/i).length).toBeGreaterThan(0);
  });

  it("draws the switch and the colour of a domain in the same row", () => {
    render(<ModuleSection />);
    const toggle = screen.getByRole("switch", { name: /domain\.cruise/ });
    const row = toggle.closest(".ts-setting-row") as HTMLElement;
    expect(within(row).getByLabelText(/domain\.cruise.*settings:domains\.color/)).toHaveAttribute(
      "type",
      "color"
    );
  });

  it("keeps a switched-off domain listed, with its colour still choosable", () => {
    render(<ModuleSection />);
    expect(screen.getByRole("switch", { name: /domain\.cruise/ })).not.toBeChecked();
    expect(screen.getByLabelText(/domain\.cruise.*settings:domains\.color/)).not.toBeDisabled();
  });

  it("is one section, titled 'Bereiche & Farben'", () => {
    render(<ModuleSection />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "settings:domains.title",
    ]);
  });
});

describe("ModuleSection — a switched-off domain (forgejo#321 prototype)", () => {
  beforeEach(() => {
    mockBeta.mockReturnValue(false);
    useSettingsStore.setState({ enabledDomains: ["flight"] });
  });

  it("dims the whole row, not only the colour, and leaves it operable", () => {
    render(<ModuleSection />);
    const off = document.querySelector('[data-domain-row="cruise"]') as HTMLElement;
    const on = document.querySelector('[data-domain-row="flight"]') as HTMLElement;
    expect(off.style.opacity).toBe("0.5");
    expect(on.style.opacity).toBe("1");
    expect(within(off).getByRole("switch")).not.toBeDisabled();
  });
});
