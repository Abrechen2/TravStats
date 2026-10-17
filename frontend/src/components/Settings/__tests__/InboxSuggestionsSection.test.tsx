import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserSettings } from "../../../lib/api/types";
import { settingsApi } from "../../../lib/api";
import InboxSuggestionsSection from "../InboxSuggestionsSection";
import { useSuggestionSwitchesStore } from "../../../store/suggestionSwitchesStore";

/** The settings card for the inbox suggestion switches (forgejo#306). */
describe("InboxSuggestionsSection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSuggestionSwitchesStore.setState({ trips: true, stays: false });
  });

  it("shows each switch as the store holds it", () => {
    render(<InboxSuggestionsSection />);
    expect(
      screen.getByRole("switch", { name: /settings:inboxSuggestions\.trips\.label/ })
    ).toBeChecked();
    expect(
      screen.getByRole("switch", { name: /settings:inboxSuggestions\.stays\.label/ })
    ).not.toBeChecked();
  });

  it("turning trip suggestions off saves it and updates the store", async () => {
    const update = vi.spyOn(settingsApi, "update").mockResolvedValue({} as UserSettings);
    render(<InboxSuggestionsSection />);
    await userEvent.click(
      screen.getByRole("switch", { name: /settings:inboxSuggestions\.trips\.label/ })
    );
    expect(useSuggestionSwitchesStore.getState().trips).toBe(false);
    expect(update).toHaveBeenCalledWith({ tripSuggestions: { enabled: false } });
  });
});
