import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
// The global setup mocks the store; this test needs the real one.
vi.unmock("../../../store/settingsStore");

import TripsSection from "../TripsSection";
import { settingsApi } from "../../../lib/api";
import { useSettingsStore } from "../../../store/settingsStore";
import { useSuggestionSwitchesStore } from "../../../store/suggestionSwitchesStore";
import { resetWriteQueue } from "../../ui/settings/writeQueue";
import { AREA_MENU, findAreaPage } from "../../../pages/Settings/area/areaModel";

/**
 * Owner 2026-08-23: trips get their own settings section, and the
 * automatic-trip switch moves there from the import hub. On the rebuilt rows a
 * refused save must not take the pick away or reach the store.
 */
describe("TripsSection", () => {
  beforeEach(() => {
    useSettingsStore.setState({ autoCreateTrips: true });
    useSuggestionSwitchesStore.setState({ tripDefaultColor: null });
  });
  afterEach(() => {
    cleanup();
    act(() => resetWriteQueue());
    vi.restoreAllMocks();
  });

  it("lives on its own general page, in the menu's ungated first block", () => {
    const page = findAreaPage("trips");
    expect(page?.id).toBe("trips");
    expect(page?.domain).toBeUndefined();
    expect(AREA_MENU.flatMap((g) => g.pages)).toContain("trips");
  });

  it("renders the automatic-trip switch checked when the setting is on", () => {
    render(<TripsSection />);
    expect(screen.getByRole("switch", { name: /settingsRows:trips\.autoreise\.t/ })).toBeChecked();
  });

  it("clicking the switch writes it and flips the store only once the server confirmed", async () => {
    const update = vi.spyOn(settingsApi, "update").mockResolvedValue({} as never);
    render(<TripsSection />);
    await userEvent.click(screen.getByRole("switch", { name: /settingsRows:trips\.autoreise\.t/ }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ autoCreateTrips: false }));
    await waitFor(() => expect(useSettingsStore.getState().autoCreateTrips).toBe(false));
  });

  it("a refused save keeps the pick on screen and the store on the saved value", async () => {
    vi.spyOn(settingsApi, "update").mockRejectedValue(new Error("Network Error"));
    render(<TripsSection />);
    await userEvent.click(screen.getByRole("switch", { name: /settingsRows:trips\.autoreise\.t/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("settings:blocks.save.failed");
    expect(
      screen.getByRole("switch", { name: /settingsRows:trips\.autoreise\.t/ })
    ).not.toBeChecked();
    expect(useSettingsStore.getState().autoCreateTrips).toBe(true);
  });

  it("writes the picked colour as the trip default, and automatic as null", async () => {
    const update = vi.spyOn(settingsApi, "update").mockResolvedValue({} as never);
    render(<TripsSection />);
    const select = screen.getByLabelText("settingsRows:trips.reisefarbe.t");
    const colour = Array.from((select as HTMLSelectElement).options).find(
      (o) => o.value !== "auto"
    )!.value;
    await userEvent.selectOptions(select, colour);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ tripDefaults: { color: colour } }));
    await waitFor(() =>
      expect(useSuggestionSwitchesStore.getState().tripDefaultColor).toBe(colour)
    );
    await userEvent.selectOptions(select, "auto");
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({ tripDefaults: { color: null } }));
  });
});
