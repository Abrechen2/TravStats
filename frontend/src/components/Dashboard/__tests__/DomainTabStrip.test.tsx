import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DomainTabStrip } from "../DomainTabStrip";
import { useSettingsStore } from "../../../store/settingsStore";

// Real Zustand store instead of the global static mock — the POI tab is gated
// behind the instance-level beta flag, which lives in this store.
vi.unmock("../../../store/settingsStore");

// Override the global key-passthrough mock with human-readable labels for this component.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        "dashboard:tabStrip.label": "Domain switcher",
        "dashboard:tabStrip.tabs.all": "All",
        "dashboard:tabStrip.tabs.flight": "Flights",
        "dashboard:tabStrip.tabs.cruise": "Cruises",
        "dashboard:tabStrip.tabs.poi": "POIs",
        "dashboard:tabStrip.tabs.lodging": "Lodging",
      };
      return labels[key] ?? key;
    },
    i18n: { language: "en", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

describe("DomainTabStrip", () => {
  // The POI tab only exists on a beta-flagged instance; the pre-existing cases
  // below are about tab behaviour, so run them with the gate open.
  beforeEach(() => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });
  });

  it("renders the five tabs with counts", () => {
    render(
      <DomainTabStrip
        active="all"
        counts={{ flight: 127, cruise: 2, poi: 0, lodging: 0 }}
        enabled={{ flight: true, cruise: true, poi: true, lodging: true }}
        onSelect={() => {}}
      />
    );
    expect(screen.getByRole("tab", { name: /all/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /127/ })).toBeTruthy();
    // cruise tab shows count "2" — match via the cruise label + count
    expect(screen.getByRole("tab", { name: /cruises/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /cruises/i }).textContent).toContain("2");
  });

  it("marks the active tab with aria-selected", () => {
    render(
      <DomainTabStrip
        active="cruise"
        counts={{ flight: 0, cruise: 2, poi: 0, lodging: 0 }}
        enabled={{ flight: true, cruise: true, poi: true, lodging: true }}
        onSelect={() => {}}
      />
    );
    const tab = screen.getByRole("tab", { name: /cruise/i });
    expect(tab.getAttribute("aria-selected")).toBe("true");
  });

  it("calls onSelect with the clicked tab", () => {
    const onSelect = vi.fn();
    render(
      <DomainTabStrip
        active="all"
        counts={{ flight: 0, cruise: 0, poi: 0, lodging: 0 }}
        enabled={{ flight: true, cruise: true, poi: true, lodging: true }}
        onSelect={onSelect}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: /flights/i }));
    expect(onSelect).toHaveBeenCalledWith("flight");
  });

  it("dims but still allows clicking a disabled-domain tab (so user can see the 'coming soon' screen)", () => {
    const onSelect = vi.fn();
    render(
      <DomainTabStrip
        active="all"
        counts={{ flight: 0, cruise: 0, poi: 0, lodging: 0 }}
        enabled={{ flight: true, cruise: true, poi: false, lodging: true }}
        onSelect={onSelect}
      />
    );
    const poi = screen.getByRole("tab", { name: /poi/i });
    expect(poi.getAttribute("data-disabled")).toBe("true");
    fireEvent.click(poi);
    expect(onSelect).toHaveBeenCalledWith("poi");
  });

  describe("beta gate: poiDashboardTab", () => {
    const renderStrip = (): void => {
      render(
        <DomainTabStrip
          active="all"
          counts={{ flight: 1, cruise: 1, poi: 0, lodging: 0 }}
          enabled={{ flight: true, cruise: true, poi: true, lodging: true }}
          onSelect={() => {}}
        />
      );
    };

    it("hides the POI tab when the beta flag is OFF", () => {
      useSettingsStore.setState({ betaFeaturesEnabled: false });
      renderStrip();
      expect(screen.queryByRole("tab", { name: /poi/i })).toBeNull();
      // the non-gated tabs are untouched
      expect(screen.getByRole("tab", { name: /flights/i })).toBeTruthy();
      expect(screen.getByRole("tab", { name: /cruises/i })).toBeTruthy();
    });

    it("hides the POI tab while the flag is still unknown (not loaded yet)", () => {
      useSettingsStore.setState({ betaFeaturesEnabled: null });
      renderStrip();
      expect(screen.queryByRole("tab", { name: /poi/i })).toBeNull();
    });

    it("shows the POI tab when the beta flag is ON", () => {
      useSettingsStore.setState({ betaFeaturesEnabled: true });
      renderStrip();
      expect(screen.getByRole("tab", { name: /poi/i })).toBeTruthy();
    });
  });
});
