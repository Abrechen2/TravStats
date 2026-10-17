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
    useSuggestionSwitchesStore.setState({
      trips: true,
      stays: false,
      stayImmichEvidence: true,
      stayLlmPlaceClassification: false,
    });
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

  describe("stay refinements (forgejo#305)", () => {
    const immich = () =>
      screen.getByRole("switch", { name: /settings:inboxSuggestions\.immichEvidence\.label/ });
    const llm = () =>
      screen.getByRole("switch", {
        name: /settings:inboxSuggestions\.llmPlaceClassification\.label/,
      });

    it("are disabled while stay suggestions are off", () => {
      render(<InboxSuggestionsSection />);
      expect(immich()).toBeDisabled();
      expect(llm()).toBeDisabled();
    });

    it("save their own key and leave the other switches alone", async () => {
      useSuggestionSwitchesStore.setState({ stays: true });
      const update = vi.spyOn(settingsApi, "update").mockResolvedValue({} as UserSettings);
      render(<InboxSuggestionsSection />);
      expect(immich()).toBeChecked();
      expect(llm()).not.toBeChecked();

      await userEvent.click(llm());
      expect(update).toHaveBeenCalledWith({ staySuggestions: { llmPlaceClassification: true } });
      await userEvent.click(immich());
      expect(update).toHaveBeenCalledWith({ staySuggestions: { immichEvidence: false } });
      expect(useSuggestionSwitchesStore.getState()).toMatchObject({
        stays: true,
        stayImmichEvidence: false,
        stayLlmPlaceClassification: true,
      });
    });

    it("reads both from the settings response", () => {
      useSuggestionSwitchesStore.getState().noteRemote({
        staySuggestions: { enabled: true, immichEvidence: false, llmPlaceClassification: true },
      });
      expect(useSuggestionSwitchesStore.getState()).toMatchObject({
        stays: true,
        stayImmichEvidence: false,
        stayLlmPlaceClassification: true,
      });
    });
  });
});
