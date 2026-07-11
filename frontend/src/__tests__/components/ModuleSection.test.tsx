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

describe("ModuleSection", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
  });

  it("renders a row for every known domain", () => {
    render(<ModuleSection />);
    expect(screen.getByText("domain.flight")).toBeInTheDocument();
    expect(screen.getByText("domain.cruise")).toBeInTheDocument();
    expect(screen.getByText("domain.lodging")).toBeInTheDocument();
    expect(screen.getByText("domain.poi")).toBeInTheDocument();
  });

  it("disables unavailable domains", () => {
    render(<ModuleSection />);
    const poiToggle = screen.getByRole("switch", { name: /domain\.poi/ });
    expect(poiToggle).toBeDisabled();
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
