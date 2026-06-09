import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DomainTabStrip } from "../DomainTabStrip";

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
      };
      return labels[key] ?? key;
    },
    i18n: { language: "en", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

describe("DomainTabStrip", () => {
  it("renders the four tabs with counts", () => {
    render(
      <DomainTabStrip
        active="all"
        counts={{ flight: 127, cruise: 2, poi: 0 }}
        enabled={{ flight: true, cruise: true, poi: true }}
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
        counts={{ flight: 0, cruise: 2, poi: 0 }}
        enabled={{ flight: true, cruise: true, poi: true }}
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
        counts={{ flight: 0, cruise: 0, poi: 0 }}
        enabled={{ flight: true, cruise: true, poi: true }}
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
        counts={{ flight: 0, cruise: 0, poi: 0 }}
        enabled={{ flight: true, cruise: true, poi: false }}
        onSelect={onSelect}
      />
    );
    const poi = screen.getByRole("tab", { name: /poi/i });
    expect(poi.getAttribute("data-disabled")).toBe("true");
    fireEvent.click(poi);
    expect(onSelect).toHaveBeenCalledWith("poi");
  });
});
