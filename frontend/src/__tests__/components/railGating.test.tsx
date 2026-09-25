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
 * Rail sits behind the instance beta switch (`railDomain`) on top of the
 * user's domain choice (spec 2026-09-25-rail-domain). Where the domain is
 * switched ON, the flag alone decides; everywhere else, both.
 */
describe("rail gating", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
  });

  describe("module switch", () => {
    it("offers rail on a beta instance, before the user has it on", () => {
      render(<ModuleSection />);
      expect(screen.getByText("domain.rail")).toBeInTheDocument();
    });

    it.each([
      ["off", false],
      ["unknown (not loaded yet)", null],
    ])("hides rail while the beta flag is %s", (_label, flag) => {
      useSettingsStore.setState({ betaFeaturesEnabled: flag });
      render(<ModuleSection />);
      expect(screen.queryByText("domain.rail")).toBeNull();
      expect(screen.getByText("domain.flight")).toBeInTheDocument();
    });

    it("keeps an enabled rail listed after the flag goes off, so it can be switched off", () => {
      useSettingsStore.setState({ enabledDomains: ["flight", "rail"], betaFeaturesEnabled: false });
      render(<ModuleSection />);
      expect(screen.getByText("domain.rail")).toBeInTheDocument();
    });
  });

  describe("setup domain picker", () => {
    it("offers rail only on a beta instance", () => {
      const { unmount } = render(<DomainPickerStep value={["flight"]} onChange={vi.fn()} />);
      expect(screen.getByTestId("domain-card-rail")).toBeInTheDocument();
      unmount();
      useSettingsStore.setState({ betaFeaturesEnabled: null });
      render(<DomainPickerStep value={["flight"]} onChange={vi.fn()} />);
      expect(screen.queryByTestId("domain-card-rail")).toBeNull();
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

    it("draws the rail tab with the flag on and the domain on", () => {
      useSettingsStore.setState({ enabledDomains: ["flight", "rail"] });
      renderTabs();
      expect(screen.getByRole("link", { name: /domain\.rail/ })).toHaveAttribute("href", "/rail");
    });

    it("draws no rail tab while the flag is off, even with the domain on", () => {
      useSettingsStore.setState({
        enabledDomains: ["flight", "cruise", "rail"],
        betaFeaturesEnabled: false,
      });
      renderTabs();
      expect(screen.queryByRole("link", { name: /domain\.rail/ })).toBeNull();
      expect(screen.getByRole("link", { name: /domain\.cruise/ })).toBeInTheDocument();
    });
  });
});
