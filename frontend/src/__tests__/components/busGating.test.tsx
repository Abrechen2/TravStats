import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    settingsApi: { ...actual.settingsApi, update: vi.fn().mockResolvedValue(undefined) },
  };
});
vi.unmock("../../store/settingsStore");

import ModuleSection from "../../components/Settings/ModuleSection";
import DomainPickerStep from "../../components/Setup/DomainPickerStep";
import LogbookTabs from "../../components/table/LogbookTabs";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * Bus left beta on 2026-10-26 (owner): the instance's beta switch no longer
 * decides anything about it. The module switch and the setup picker offer it
 * whatever the flag says, and the logbook tab follows the user's domain alone.
 */
describe("bus gating", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: false });
  });

  describe("module switch", () => {
    it.each([
      ["on", true],
      ["off", false],
      ["unknown (not loaded yet)", null],
    ])("offers bus while the beta flag is %s", (_label, flag) => {
      useSettingsStore.setState({ betaFeaturesEnabled: flag });
      render(<ModuleSection />);
      expect(screen.getByText("domain.bus")).toBeInTheDocument();
    });
  });

  describe("setup domain picker", () => {
    it("offers bus with the beta flag off", () => {
      render(<DomainPickerStep value={["flight"]} onChange={vi.fn()} />);
      expect(screen.getByTestId("domain-card-bus")).toBeInTheDocument();
    });
  });

  describe("logbook tabs", () => {
    const renderTabs = (): void => {
      render(
        <MemoryRouter initialEntries={["/flights"]}>
          <LogbookTabs />
        </MemoryRouter>
      );
    };

    it("draws the bus tab with the flag off and the domain on", () => {
      useSettingsStore.setState({ enabledDomains: ["flight", "bus"] });
      renderTabs();
      expect(screen.getByRole("link", { name: /domain\.bus/ })).toHaveAttribute("href", "/bus");
    });

    it("draws no bus tab while the user has the domain off", () => {
      useSettingsStore.setState({
        enabledDomains: ["flight", "cruise"],
        betaFeaturesEnabled: true,
      });
      renderTabs();
      expect(screen.queryByRole("link", { name: /domain\.bus/ })).toBeNull();
      expect(screen.getByRole("link", { name: /domain\.cruise/ })).toBeInTheDocument();
    });
  });
});
