import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserSettings } from "../../../lib/api/types";
import { settingsApi } from "../../../lib/api";
import TripRecordingSection from "../TripRecordingSection";
import { useSuggestionSwitchesStore } from "../../../store/suggestionSwitchesStore";

/** The account switch for the app's trip positions (forgejo#316). */
describe("TripRecordingSection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSuggestionSwitchesStore.setState({ tripRecording: true });
  });

  it("reads the switch from what GET /settings said", () => {
    useSuggestionSwitchesStore.getState().noteRemote({ tripRecording: { enabled: false } });
    render(<TripRecordingSection />);
    expect(screen.getByRole("switch", { name: /settings:tripRecording\.label/ })).not.toBeChecked();
  });

  it("turning it off saves it and says what it means", async () => {
    const update = vi.spyOn(settingsApi, "update").mockResolvedValue({} as UserSettings);
    render(<TripRecordingSection />);
    expect(screen.getByText(/settings:tripRecording\.description/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: /settings:tripRecording\.label/ }));
    expect(useSuggestionSwitchesStore.getState().tripRecording).toBe(false);
    expect(update).toHaveBeenCalledWith({ tripRecording: { enabled: false } });
  });
});
