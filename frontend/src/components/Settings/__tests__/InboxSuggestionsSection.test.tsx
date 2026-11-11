import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { UserSettings } from "../../../lib/api/types";
import { settingsApi } from "../../../lib/api";
import InboxSuggestionsSection from "../InboxSuggestionsSection";
import { useSuggestionSwitchesStore } from "../../../store/suggestionSwitchesStore";
import { resetWriteQueue } from "../../ui/settings/writeQueue";

/**
 * "Vorschläge im Eingang" (forgejo#306) on the rebuilt rows: the trip switch
 * writes at once, shows the save state and keeps the pick when the server
 * refuses. The stay switches have their own tests (`StaySuggestionRows`).
 */
vi.mock("../OpenSuggestionsRow", () => ({ default: () => null })); // its own tests

/** Rendered inside act, so the readiness reads settle before the first assertion. */
const renderIt = async (): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        <InboxSuggestionsSection />
      </MemoryRouter>
    );
  });
};

const tripsSwitch = () => screen.getByRole("switch", { name: /settingsRows:trips\.rvor\.t/ });

describe("InboxSuggestionsSection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSuggestionSwitchesStore.setState({ trips: true });
  });
  afterEach(() => {
    cleanup();
    act(() => resetWriteQueue());
  });

  it("shows each switch as the store holds it", async () => {
    await renderIt();
    expect(tripsSwitch()).toBeChecked();
  });

  it("turning trip suggestions off saves it and only then updates the store", async () => {
    const update = vi.spyOn(settingsApi, "update").mockResolvedValue({} as UserSettings);
    await renderIt();
    await userEvent.click(tripsSwitch());
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ tripSuggestions: { enabled: false } })
    );
    await waitFor(() => expect(useSuggestionSwitchesStore.getState().trips).toBe(false));
  });

  it("a refused save keeps the pick, leaves the store on the saved value and says so", async () => {
    vi.spyOn(settingsApi, "update").mockRejectedValue(new Error("Network Error"));
    await renderIt();
    await userEvent.click(tripsSwitch());
    expect(await screen.findByRole("alert")).toHaveTextContent("settings:blocks.save.failed");
    expect(tripsSwitch()).not.toBeChecked();
    expect(useSuggestionSwitchesStore.getState().trips).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.discard" }));
    expect(tripsSwitch()).toBeChecked();
  });

  it("no longer offers the stay switches: they moved to TravTrack → Erkennung & Vorschläge", async () => {
    await renderIt();
    for (const row of ["avor", "immichbeleg", "kiort"]) {
      expect(screen.queryByRole("switch", { name: new RegExp(`trips\\.${row}\\.t`) })).toBeNull();
    }
  });
});
