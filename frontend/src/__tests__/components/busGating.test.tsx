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
 * Bus sits behind the instance beta switch (`busDomain`) on top of the
 * user's domain choice (spec 2026-10-07-bus-domain-design). Where the domain is
 * switched ON, the flag alone decides; everywhere else, both.
 */
describe("bus gating", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
  });

  describe("module switch", () => {
    it("offers bus on a beta instance, before the user has it on", () => {
      render(<ModuleSection />);
      expect(screen.getByText("domain.bus")).toBeInTheDocument();
    });

    it.each([
      ["off", false],
      ["unknown (not loaded yet)", null],
    ])("hides bus while the beta flag is %s", (_label, flag) => {
      useSettingsStore.setState({ betaFeaturesEnabled: flag });
      render(<ModuleSection />);
      expect(screen.queryByText("domain.bus")).toBeNull();
      expect(screen.getByText("domain.flight")).toBeInTheDocument();
    });

    it("keeps an enabled bus listed after the flag goes off, so it can be switched off", () => {
      useSettingsStore.setState({ enabledDomains: ["flight", "bus"], betaFeaturesEnabled: false });
      render(<ModuleSection />);
      expect(screen.getByText("domain.bus")).toBeInTheDocument();
    });
  });

  describe("setup domain picker", () => {
    it("offers bus only on a beta instance", () => {
      const { unmount } = render(<DomainPickerStep value={["flight"]} onChange={vi.fn()} />);
      expect(screen.getByTestId("domain-card-bus")).toBeInTheDocument();
      unmount();
      useSettingsStore.setState({ betaFeaturesEnabled: null });
      render(<DomainPickerStep value={["flight"]} onChange={vi.fn()} />);
      expect(screen.queryByTestId("domain-card-bus")).toBeNull();
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

    it("draws the bus tab with the flag on and the domain on", () => {
      useSettingsStore.setState({ enabledDomains: ["flight", "bus"] });
      renderTabs();
      expect(screen.getByRole("link", { name: /domain\.bus/ })).toHaveAttribute("href", "/bus");
    });

    it("draws no bus tab while the flag is off, even with the domain on", () => {
      useSettingsStore.setState({
        enabledDomains: ["flight", "cruise", "bus"],
        betaFeaturesEnabled: false,
      });
      renderTabs();
      expect(screen.queryByRole("link", { name: /domain\.bus/ })).toBeNull();
      expect(screen.getByRole("link", { name: /domain\.cruise/ })).toBeInTheDocument();
    });
  });
});
