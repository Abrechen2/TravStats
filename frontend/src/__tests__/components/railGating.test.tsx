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
 * Rail left beta in 2.7.0-rc.20 (owner, 2026-10-22): like flights and cruises
 * it follows the user's domain choice alone, whatever the instance's beta
 * switch says — off, on, or not loaded yet.
 */
describe("rail gating — out of beta", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: false });
  });

  describe("module switch", () => {
    it.each([
      ["off", false],
      ["unknown (not loaded yet)", null],
      ["on", true],
    ])("offers rail while the beta flag is %s", (_label, flag) => {
      useSettingsStore.setState({ betaFeaturesEnabled: flag });
      render(<ModuleSection />);
      expect(screen.getByText("domain.rail")).toBeInTheDocument();
    });
  });

  describe("setup domain picker", () => {
    it("offers rail with the beta flag off", () => {
      render(<DomainPickerStep value={["flight"]} onChange={vi.fn()} />);
      expect(screen.getByTestId("domain-card-rail")).toBeInTheDocument();
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

    it("draws the rail tab with the beta flag off once the domain is on", () => {
      useSettingsStore.setState({ enabledDomains: ["flight", "rail"], betaFeaturesEnabled: false });
      renderTabs();
      expect(screen.getByRole("link", { name: /domain\.rail/ })).toHaveAttribute("href", "/rail");
    });

    it("draws no rail tab while the user has the domain off", () => {
      useSettingsStore.setState({
        enabledDomains: ["flight", "cruise"],
        betaFeaturesEnabled: true,
      });
      renderTabs();
      expect(screen.queryByRole("link", { name: /domain\.rail/ })).toBeNull();
      expect(screen.getByRole("link", { name: /domain\.cruise/ })).toBeInTheDocument();
    });
  });
});
