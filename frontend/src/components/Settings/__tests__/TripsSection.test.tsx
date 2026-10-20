import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
// The setter persists at once; answer that write here instead of the network.
vi.mock("@/lib/api/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/settings")>();
  return {
    ...actual,
    settingsApi: { ...actual.settingsApi, update: vi.fn().mockResolvedValue({}) },
  };
});
// The global setup mocks the store; this test needs the real setter.
vi.unmock("../../../store/settingsStore");

import TripsSection from "../TripsSection";
import { useSettingsStore } from "../../../store/settingsStore";
import { SETTINGS_MENU, SETTINGS_PAGES } from "../../../pages/Settings/settingsModel";
import { pageOfSection } from "../../../pages/Settings/surface";

/**
 * Owner 2026-08-23: trips get their own settings section, and the
 * automatic-trip switch moves there from the import hub. Trips are no domain,
 * so the section sits among the always-visible general pages.
 */
describe("TripsSection", () => {
  beforeEach(() => {
    useSettingsStore.setState({ autoCreateTrips: true });
  });

  it("lives on its own general page, in the menu's ungated first block", () => {
    const page = pageOfSection(SETTINGS_PAGES, "trips");
    expect(page?.id).toBe("trips");
    expect(page?.domain).toBeUndefined();
    expect(SETTINGS_MENU.find((g) => g.id === "general")?.pages).toContain("trips");
  });

  it("renders the automatic-trip switch checked when the setting is on", () => {
    render(<TripsSection />);
    const toggle = screen.getByLabelText(
      "settings:trips.autoCreateTrips.label"
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it("clicking the switch flips the store setting", async () => {
    const user = userEvent.setup();
    render(<TripsSection />);
    await user.click(screen.getByLabelText("settings:trips.autoCreateTrips.label"));
    expect(useSettingsStore.getState().autoCreateTrips).toBe(false);
  });
});
