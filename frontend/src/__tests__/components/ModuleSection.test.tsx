import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock the settings API so the real store's setEnabledDomains does not
// fire a real HTTP call via settingsApi.update(...).
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    settingsApi: {
      ...actual.settingsApi,
      update: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// Real store, not the global mock
vi.unmock("../../store/settingsStore");

import ModuleSection from "../../components/Settings/ModuleSection";
import { useSettingsStore } from "../../store/settingsStore";
import { DOMAINS } from "../../shared/domains";

describe("ModuleSection", () => {
  beforeEach(() => {
    // The flag is set only so the assertions below can vary it; since
    // 2026-09-05 no row here depends on it.
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
  });

  it("renders a row for every known domain", () => {
    render(<ModuleSection />);
    expect(screen.getByText("domain.flight")).toBeInTheDocument();
    expect(screen.getByText("domain.cruise")).toBeInTheDocument();
    expect(screen.getByText("domain.lodging")).toBeInTheDocument();
    expect(screen.getByText("domain.poi")).toBeInTheDocument();
  });

  it("disables unavailable domains", () => {
    // No domain is `available: false` any more — poi was the last one and the
    // Places domain replaced it. The disabled branch (`disabled={!d.available}`)
    // is still live and is what a future stubbed domain will lean on, so
    // availability is forced here instead of dropping the test.
    const restore = DOMAINS.poi.available;
    DOMAINS.poi.available = false;
    try {
      render(<ModuleSection />);
      expect(screen.getByRole("switch", { name: /domain\.poi/ })).toBeDisabled();
    } finally {
      DOMAINS.poi.available = restore;
    }
  });

  it("does not disable the now-available poi domain", () => {
    render(<ModuleSection />);
    expect(screen.getByRole("switch", { name: /domain\.poi/ })).not.toBeDisabled();
  });

  // Until 2026-09-05 the poi row was hidden while the instance beta flag was
  // off or unknown. The gate's own condition was met and it came off; pinned
  // so it does not quietly return.
  it.each([
    ["off", false],
    ["unknown (not loaded yet)", null],
  ])("shows the poi module when the beta flag is %s", (_label, flag) => {
    useSettingsStore.setState({ betaFeaturesEnabled: flag });
    render(<ModuleSection />);
    expect(screen.getByText("domain.poi")).toBeInTheDocument();
  });

  it("does not disable the now-available lodging domain", () => {
    render(<ModuleSection />);
    const lodgingToggle = screen.getByRole("switch", { name: /domain\.lodging/ });
    expect(lodgingToggle).not.toBeDisabled();
  });

  it("toggling an available domain updates the store", () => {
    render(<ModuleSection />);
    const flightToggle = screen.getByRole("switch", { name: /domain\.flight/ });
    fireEvent.click(flightToggle);
    expect(useSettingsStore.getState().enabledDomains).toEqual([]);
  });
});
