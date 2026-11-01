import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { UserSettings } from "../../../lib/api/types";
import { settingsApi } from "../../../lib/api";
import { externalServicesApi } from "../../../lib/api/externalServices";
import { locationProviderApi } from "../../../lib/api/locationProvider";
import InboxSuggestionsSection from "../InboxSuggestionsSection";
import { useSuggestionSwitchesStore } from "../../../store/suggestionSwitchesStore";
import { resetWriteQueue } from "../../ui/settings/writeQueue";

/**
 * "Vorschläge im Eingang" (forgejo#306/#305) on the rebuilt rows: each switch
 * writes at once with its own key, shows the save state, keeps the pick when
 * the server refuses, and the refinements say what they wait for.
 */
let hasLlm: boolean | "disabled" | null = true;
vi.mock("../../../hooks/useHasLlm", () => ({ useHasLlm: () => hasLlm }));

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

const immich = () => screen.getByRole("switch", { name: /settingsRows:trips\.immichbeleg\.t/ });
const llm = () => screen.getByRole("switch", { name: /settingsRows:trips\.kiort\.t/ });
const tripsSwitch = () => screen.getByRole("switch", { name: /settingsRows:trips\.rvor\.t/ });

describe("InboxSuggestionsSection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    hasLlm = true;
    useSuggestionSwitchesStore.setState({
      trips: true,
      stays: false,
      stayImmichEvidence: true,
      stayLlmPlaceClassification: false,
    });
    vi.spyOn(externalServicesApi, "accountOverview").mockResolvedValue({
      connections: [{ id: "immich", effectiveSource: "account" }],
    } as never);
    vi.spyOn(locationProviderApi, "get").mockResolvedValue({ kind: "travtrack" } as never);
  });
  afterEach(() => {
    cleanup();
    act(() => resetWriteQueue());
  });

  it("shows each switch as the store holds it", async () => {
    await renderIt();
    expect(tripsSwitch()).toBeChecked();
    expect(screen.getByRole("switch", { name: /settingsRows:trips\.avor\.t/ })).not.toBeChecked();
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

  describe("stay refinements (forgejo#305)", () => {
    it("are locked, with the reason and a way to turn stays on, while stay suggestions are off", async () => {
      await renderIt();
      expect(immich()).toBeDisabled();
      expect(immich()).toHaveAttribute("aria-disabled", "true");
      expect(llm()).toBeDisabled();
      expect(screen.getAllByText("settings:blocks.dep.stayOff.reason")).toHaveLength(2);
    });

    it("save their own key and leave the other switches alone", async () => {
      useSuggestionSwitchesStore.setState({ stays: true });
      const update = vi.spyOn(settingsApi, "update").mockResolvedValue({} as UserSettings);
      await renderIt();
      expect(immich()).toBeChecked();
      expect(llm()).not.toBeChecked();

      await userEvent.click(llm());
      await waitFor(() =>
        expect(update).toHaveBeenCalledWith({ staySuggestions: { llmPlaceClassification: true } })
      );
      await userEvent.click(immich());
      await waitFor(() =>
        expect(update).toHaveBeenCalledWith({ staySuggestions: { immichEvidence: false } })
      );
      await waitFor(() =>
        expect(useSuggestionSwitchesStore.getState()).toMatchObject({
          stays: true,
          stayImmichEvidence: false,
          stayLlmPlaceClassification: true,
        })
      );
    });

    it("name the missing Immich and the missing model, and lock the row", async () => {
      useSuggestionSwitchesStore.setState({ stays: true });
      hasLlm = false;
      vi.spyOn(externalServicesApi, "accountOverview").mockResolvedValue({
        connections: [{ id: "immich", effectiveSource: "none" }],
      } as never);
      await renderIt();
      expect(await screen.findByText("settings:blocks.dep.noImmich.reason")).toBeTruthy();
      expect(screen.getByText("settings:blocks.dep.aiNotAllowed.reason")).toBeTruthy();
      expect(immich()).toBeDisabled();
      expect(llm()).toBeDisabled();
    });

    it("claim no dependency while the connection is unknown (the question failed)", async () => {
      useSuggestionSwitchesStore.setState({ stays: true });
      vi.spyOn(externalServicesApi, "accountOverview").mockRejectedValue(new Error("down"));
      await renderIt();
      await waitFor(() => expect(externalServicesApi.accountOverview).toHaveBeenCalled());
      expect(screen.queryByText("settings:blocks.dep.noImmich.reason")).toBeNull();
      expect(immich()).not.toBeDisabled();
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
