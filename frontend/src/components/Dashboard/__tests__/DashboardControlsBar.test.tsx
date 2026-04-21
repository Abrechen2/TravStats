import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardControlsBar } from "../DashboardControlsBar";

// Project global test setup returns raw keys from t(); override locally for human-readable labels.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string): string => {
      const map: Record<string, string> = {
        "dashboard:controls.mode": "Modus",
        "dashboard:controls.filter": "Filter",
        "dashboard:controls.addPerTab.flight": "Flug hinzufügen",
        "dashboard:controls.addPerTab.cruise": "Kreuzfahrt hinzufügen",
        "dashboard:controls.addPerTab.poi": "POI hinzufügen",
        "dashboard:modes.overview": "Übersicht",
        "dashboard:modes.heatmap": "Heatmap",
        "dashboard:modes.journey": "Reise",
        "dashboard:modes.globe": "Globus",
        "dashboard:modes.routes": "Routen",
        "dashboard:modes.trips": "Trips",
        "dashboard:modes.markers": "Marker",
        "dashboard:modes.itinerary": "Itinerar",
        "dashboard:modes.sea-routes": "Seerouten",
        "dashboard:modes.stats-map": "Flughafen-Frequenz",
        "dashboard:modes.port-frequency": "Hafen-Frequenz",
        "dashboard:addPicker.button": "Hinzufügen",
        "dashboard:addPicker.flight": "Flug",
        "dashboard:addPicker.cruise": "Kreuzfahrt",
        "dashboard:addPicker.poi": "POI",
      };
      return map[key] ?? key;
    },
  }),
}));

describe("DashboardControlsBar", () => {
  it("renders the modes for the active tab", () => {
    render(
      <DashboardControlsBar
        tab="cruise"
        mode="sea-routes"
        enabledDomains={{ flight: true, cruise: true, poi: false }}
        onModeChange={() => {}}
        onFilterOpen={() => {}}
        onAdd={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /modus/i }));
    expect(screen.getByRole("menuitem", { name: /itinerar/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /hafen-frequenz/i })).toBeTruthy();
  });

  it("calls onModeChange when a mode is picked", () => {
    const onModeChange = vi.fn();
    render(
      <DashboardControlsBar
        tab="flight"
        mode="routes"
        enabledDomains={{ flight: true, cruise: true, poi: false }}
        onModeChange={onModeChange}
        onFilterOpen={() => {}}
        onAdd={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /modus/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /heatmap/i }));
    expect(onModeChange).toHaveBeenCalledWith("heatmap");
  });

  it("shows the domain-specific primary add button on a domain tab", () => {
    const onAdd = vi.fn();
    render(
      <DashboardControlsBar
        tab="flight"
        mode="routes"
        enabledDomains={{ flight: true, cruise: true, poi: false }}
        onModeChange={() => {}}
        onFilterOpen={() => {}}
        onAdd={onAdd}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /flug hinzufügen/i }));
    expect(onAdd).toHaveBeenCalled();
  });

  it("shows the AddDomainPicker on the All tab", () => {
    render(
      <DashboardControlsBar
        tab="all"
        mode="overview"
        enabledDomains={{ flight: true, cruise: true, poi: false }}
        onModeChange={() => {}}
        onFilterOpen={() => {}}
        onAdd={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /hinzufügen/i }));
    expect(screen.getByRole("menuitem", { name: /flug/i })).toBeTruthy();
  });

  it("calls onFilterOpen when filter button is clicked", () => {
    const onFilterOpen = vi.fn();
    render(
      <DashboardControlsBar
        tab="all"
        mode="overview"
        enabledDomains={{ flight: true, cruise: true, poi: false }}
        onModeChange={() => {}}
        onFilterOpen={onFilterOpen}
        onAdd={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    expect(onFilterOpen).toHaveBeenCalled();
  });
});
