import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
const update = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/settings")>();
  return { ...actual, settingsApi: { ...actual.settingsApi, update } };
});
const toast = vi.hoisted(() => vi.fn());
vi.mock("../../../store/toastStore", () => ({
  useToastStore: { getState: () => ({ addToast: toast }) },
}));
vi.unmock("../../../store/settingsStore");

import TripsSection from "../TripsSection";
import CruisePreferencesSection from "../CruisePreferencesSection";
import FeaturesSection from "../FeaturesSection";
import { useSuggestionSwitchesStore } from "../../../store/suggestionSwitchesStore";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";
import { STATS_HIDDEN_SECTIONS_PREFIX } from "../../../hooks/useSectionVisibility";
import { TRIP_COLORS } from "../../../lib/tripColors";

const CRUISE = { defaultLine: "", defaultCabinType: null, showCruiseArcs: true };
const SEAT_KEY = `${STATS_HIDDEN_SECTIONS_PREFIX}flight`;

/**
 * The settings prototype rows of forgejo#321: each is a server setting that
 * saves at once, rolls back and says so when the save fails, and starts at
 * the behaviour from before it existed.
 */
describe("settings prototype rows", () => {
  beforeEach(() => {
    update.mockReset().mockResolvedValue({});
    toast.mockReset();
    localStorage.removeItem(SEAT_KEY);
    useSuggestionSwitchesStore.setState({
      tripDefaultColor: null,
      cruiseSeaDaysCounted: true,
      liveTracking: true,
    });
    useSettingsLevelStore.setState({ level: "standard" });
  });
  afterEach(() => {
    cleanup();
    useSettingsLevelStore.setState({ level: null });
  });

  it("reads all three from what GET /settings said", () => {
    useSuggestionSwitchesStore.getState().noteRemote({
      tripDefaults: { color: TRIP_COLORS[2] },
      cruiseSeaDays: { counted: false },
      liveTracking: { enabled: false },
    });
    const s = useSuggestionSwitchesStore.getState();
    expect(s.tripDefaultColor).toBe(TRIP_COLORS[2]);
    expect(s.cruiseSeaDaysCounted).toBe(false);
    expect(s.liveTracking).toBe(false);
    // A missing or malformed answer keeps what the store holds.
    useSuggestionSwitchesStore.getState().noteRemote({ tripDefaults: { color: 7 } });
    expect(useSuggestionSwitchesStore.getState().tripDefaultColor).toBe(TRIP_COLORS[2]);
  });

  it("trip colour: offers Automatisch and the palette, and saves the pick", async () => {
    render(<TripsSection />);
    const select = screen.getByLabelText("settings:trips.defaultColor.label") as HTMLSelectElement;
    expect(select.value).toBe("auto");
    expect(select.options).toHaveLength(TRIP_COLORS.length + 1);
    await userEvent.selectOptions(select, TRIP_COLORS[3]);
    expect(update).toHaveBeenCalledWith({ tripDefaults: { color: TRIP_COLORS[3] } });
    await userEvent.selectOptions(select, "auto");
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({ tripDefaults: { color: null } }));
  });

  it("trip colour: a failed save goes back to what the server holds and says so", async () => {
    update.mockRejectedValueOnce(new Error("500"));
    render(<TripsSection />);
    const select = screen.getByLabelText("settings:trips.defaultColor.label") as HTMLSelectElement;
    await userEvent.selectOptions(select, TRIP_COLORS[5]);
    await waitFor(() => expect(select.value).toBe("auto"));
    expect(toast).toHaveBeenCalledWith("error", expect.any(String));
  });

  it("sea days: a switch, on by default, that saves its own key", async () => {
    render(<CruisePreferencesSection cruise={{ ...CRUISE }} onSetCruise={vi.fn()} />);
    const sw = screen.getByRole("switch", { name: /settings:cruisePreferences\.countSeaDays$/ });
    expect(sw).toBeChecked();
    await userEvent.click(sw);
    expect(update).toHaveBeenCalledWith({ cruiseSeaDays: { counted: false } });
    expect(useSuggestionSwitchesStore.getState().cruiseSeaDaysCounted).toBe(false);
  });

  it("live tracking: on by default, off is saved, a failure rolls back", async () => {
    update.mockRejectedValueOnce(new Error("offline"));
    render(<FeaturesSection />);
    const sw = screen.getByRole("switch", { name: /settings:features\.liveTracking$/ });
    expect(sw).toBeChecked();
    await userEvent.click(sw);
    expect(update).toHaveBeenCalledWith({ liveTracking: { enabled: false } });
    await waitFor(() => expect(sw).toBeChecked());
    expect(toast).toHaveBeenCalledWith("error", expect.any(String));
  });

  it("seat statistics: expert only, and it is the statistics tab's own section switch", async () => {
    render(<FeaturesSection />);
    expect(screen.queryByRole("switch", { name: /seatStatistics$/ })).toBeNull();
    cleanup();
    useSettingsLevelStore.setState({ level: "expert" });
    render(<FeaturesSection />);
    const sw = screen.getByRole("switch", { name: /settings:features\.seatStatistics$/ });
    expect(sw).toBeChecked();
    await userEvent.click(sw);
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(SEAT_KEY) ?? "[]")).toEqual(["seats"])
    );
    expect(sw).not.toBeChecked();
    await userEvent.click(sw);
    await waitFor(() => expect(JSON.parse(localStorage.getItem(SEAT_KEY) ?? "[]")).toEqual([]));
  });
});
