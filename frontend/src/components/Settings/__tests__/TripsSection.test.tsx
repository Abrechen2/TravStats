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
import {
  GENERAL_CONTENT_ORDER,
  groupOfSection,
  isGeneralGroup,
} from "../../../pages/Settings/settingsModel";

/**
 * Owner 2026-08-23: trips get their own settings section, and the
 * automatic-trip switch moves there from the import hub. Trips are no domain,
 * so the section sits among the always-visible general groups.
 */
describe("TripsSection", () => {
  beforeEach(() => {
    useSettingsStore.setState({ autoCreateTrips: true });
  });

  it("lives in its own general group, drawn on the Allgemein page", () => {
    const group = groupOfSection("trips");
    expect(group?.id).toBe("trips");
    expect(group?.domain).toBeUndefined();
    expect(isGeneralGroup("trips")).toBe(true);
    expect(GENERAL_CONTENT_ORDER).toContain("trips");
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
