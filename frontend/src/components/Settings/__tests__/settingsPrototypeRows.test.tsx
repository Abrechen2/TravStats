import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { resetWriteQueue } from "../../ui/settings/writeQueue";
import { TRIP_COLORS } from "../../../lib/tripColors";

const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 450));
  });
};
const CRUISE = { defaultLine: "", defaultCabinType: null, showCruiseArcs: true };

/**
 * The settings prototype rows of forgejo#321: each is a server setting that
 * saves at once, rolls back and says so when the save fails, and starts at
 * the behaviour from before it existed.
 */
describe("settings prototype rows", () => {
  beforeEach(() => {
    update.mockReset().mockResolvedValue({});
    toast.mockReset();
    useSuggestionSwitchesStore.setState({
      tripDefaultColor: null,
      cruiseSeaDaysCounted: true,
      liveTracking: true,
    });
    useSettingsLevelStore.setState({ level: "standard" });
  });
  afterEach(() => {
    cleanup();
    act(() => resetWriteQueue());
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
    expect(useSuggestionSwitchesStore.getState().tripDefaultColor).toBe(TRIP_COLORS[2]); // Null is an answer: the next account's "automatic" must not keep this one's colour.
    useSuggestionSwitchesStore.getState().noteRemote({ tripDefaults: { color: null } });
    expect(useSuggestionSwitchesStore.getState().tripDefaultColor).toBeNull();
  });

  it("trip colour: offers Automatisch and the palette, and saves the pick", async () => {
    render(<TripsSection />);
    const select = screen.getByLabelText("settingsRows:trips.reisefarbe.t") as HTMLSelectElement;
    expect(select.value).toBe("auto");
    expect(select.options).toHaveLength(TRIP_COLORS.length + 1);
    await userEvent.selectOptions(select, TRIP_COLORS[3]);
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ tripDefaults: { color: TRIP_COLORS[3] } })
    );
    await userEvent.selectOptions(select, "auto");
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({ tripDefaults: { color: null } }));
  });

  it("trip colour: a failed save keeps the pick on screen, says so, and the store keeps what the server holds", async () => {
    update.mockRejectedValueOnce(new Error("500"));
    render(<TripsSection />);
    const select = screen.getByLabelText("settingsRows:trips.reisefarbe.t") as HTMLSelectElement;
    await userEvent.selectOptions(select, TRIP_COLORS[5]);
    expect(await screen.findByRole("alert", undefined, { timeout: 3000 })).toHaveTextContent(
      "settings:blocks.save.failed"
    );
    expect(select.value).toBe(TRIP_COLORS[5]);
    expect(useSuggestionSwitchesStore.getState().tripDefaultColor).toBeNull();
  });

  it("sea days: a switch, on by default, that saves its own key", async () => {
    render(<CruisePreferencesSection cruise={{ ...CRUISE }} />);
    const sw = screen.getByRole("switch", { name: /settings:rows\.seaDays\.name$/ });
    expect(sw).toBeChecked();
    await userEvent.click(sw);
    await settle();
    expect(update).toHaveBeenCalledWith({ cruiseSeaDays: { counted: false } });
    expect(useSuggestionSwitchesStore.getState().cruiseSeaDaysCounted).toBe(false);
  });

  it("live tracking: on by default; a refused save keeps the choice on the row and retries there (no toast, no rollback)", async () => {
    update.mockRejectedValueOnce(new Error("offline"));
    render(<FeaturesSection />);
    const sw = screen.getByRole("switch", { name: /settings:rows\.liveTracking\.name$/ });
    expect(sw).toBeChecked();
    await userEvent.click(sw);
    await settle();
    expect(update).toHaveBeenCalledWith({ liveTracking: { enabled: false } });
    expect(sw).not.toBeChecked();
    expect(useSuggestionSwitchesStore.getState().liveTracking).toBe(true);
    expect(screen.getByText(/settings:blocks\.save\.failed/)).toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await waitFor(() => expect(useSuggestionSwitchesStore.getState().liveTracking).toBe(false));
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("sea days: a refused save keeps the choice, and Verwerfen puts the saved value back", async () => {
    update.mockRejectedValueOnce(new Error("offline"));
    render(<CruisePreferencesSection cruise={{ ...CRUISE }} />);
    const sw = screen.getByRole("switch", { name: /settings:rows\.seaDays\.name$/ });
    await userEvent.click(sw);
    await settle();
    expect(sw).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.discard" }));
    expect(sw).toBeChecked();
    expect(useSuggestionSwitchesStore.getState().cruiseSeaDaysCounted).toBe(true);
  });

  it("seat statistics: no longer a switch here (design 2026-11-01)", () => {
    render(<FeaturesSection />);
    expect(screen.queryByRole("switch", { name: /seatStatistics$/ })).not.toBeInTheDocument();
  });
});
