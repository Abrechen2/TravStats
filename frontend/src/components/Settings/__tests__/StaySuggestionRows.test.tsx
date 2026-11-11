import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { UserSettings } from "../../../lib/api/types";
import { settingsApi } from "../../../lib/api";
import { externalServicesApi } from "../../../lib/api/externalServices";
import { locationProviderApi } from "../../../lib/api/locationProvider";
import StaySuggestionRow, { type StayRowId } from "../StaySuggestionRows";
import { useSuggestionSwitchesStore } from "../../../store/suggestionSwitchesStore";
import { resetWriteQueue } from "../../ui/settings/writeQueue";

/**
 * The stay switches (forgejo#306/#305), moved from Reisen to TravTrack →
 * Erkennung & Vorschläge in settings v3 S4: each writes at once with its own
 * key, and the refinements say what they wait for.
 */
let hasLlm: boolean | "disabled" | null = true;
vi.mock("../../../hooks/useHasLlm", () => ({ useHasLlm: () => hasLlm }));

const IDS: StayRowId[] = ["avor", "immichbeleg", "kiort"];
const renderRows = async (ids: StayRowId[] = IDS): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        {ids.map((id) => (
          <StaySuggestionRow key={id} id={id} />
        ))}
      </MemoryRouter>
    );
  });
};
const sw = (id: StayRowId) =>
  screen.getByRole("switch", { name: new RegExp(`settingsRows:trips\\.${id}\\.t`) });

describe("StaySuggestionRow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    hasLlm = true;
    useSuggestionSwitchesStore.setState({
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
    await renderRows();
    expect(sw("avor")).not.toBeChecked();
    expect(sw("immichbeleg")).toBeChecked();
    expect(sw("kiort")).not.toBeChecked();
  });

  it("saves 'Aufenthalte vorschlagen' with its own key and updates the store only then", async () => {
    const update = vi.spyOn(settingsApi, "update").mockResolvedValue({} as UserSettings);
    await renderRows(["avor"]);
    await userEvent.click(sw("avor"));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ staySuggestions: { enabled: true } })
    );
    await waitFor(() => expect(useSuggestionSwitchesStore.getState().stays).toBe(true));
  });

  it("keeps the pick and says so when the server refuses the stay switch", async () => {
    vi.spyOn(settingsApi, "update").mockRejectedValue(new Error("Network Error"));
    await renderRows(["avor"]);
    await userEvent.click(sw("avor"));
    expect(await screen.findByRole("alert")).toHaveTextContent("settings:blocks.save.failed");
    expect(sw("avor")).toBeChecked();
    expect(useSuggestionSwitchesStore.getState().stays).toBe(false);
  });

  it("points an account without a location source at TravTrack → Aufzeichnung", async () => {
    vi.spyOn(locationProviderApi, "get").mockResolvedValue({ kind: "none" } as never);
    await renderRows(["avor"]);
    expect(await screen.findByText("settings:blocks.dep.noLocSource.reason")).toBeTruthy();
  });

  describe("the refinements (forgejo#305)", () => {
    it("are locked, with the reason and a way to turn stays on, while stay suggestions are off", async () => {
      await renderRows(["immichbeleg", "kiort"]);
      expect(sw("immichbeleg")).toBeDisabled();
      expect(sw("kiort")).toBeDisabled();
      expect(screen.getAllByText("settings:blocks.dep.stayOff.reason")).toHaveLength(2);
    });

    it("save their own key and leave the other switches alone", async () => {
      useSuggestionSwitchesStore.setState({ stays: true });
      const update = vi.spyOn(settingsApi, "update").mockResolvedValue({} as UserSettings);
      await renderRows(["immichbeleg", "kiort"]);
      await userEvent.click(sw("kiort"));
      await waitFor(() =>
        expect(update).toHaveBeenCalledWith({ staySuggestions: { llmPlaceClassification: true } })
      );
      await userEvent.click(sw("immichbeleg"));
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
      await renderRows(["immichbeleg", "kiort"]);
      expect(await screen.findByText("settings:blocks.dep.noImmich.reason")).toBeTruthy();
      expect(screen.getByText("settings:blocks.dep.aiNotAllowed.reason")).toBeTruthy();
      expect(sw("immichbeleg")).toBeDisabled();
      expect(sw("kiort")).toBeDisabled();
    });

    it("claim no dependency while the connection is unknown (the question failed)", async () => {
      useSuggestionSwitchesStore.setState({ stays: true });
      vi.spyOn(externalServicesApi, "accountOverview").mockRejectedValue(new Error("down"));
      await renderRows(["immichbeleg"]);
      await waitFor(() => expect(externalServicesApi.accountOverview).toHaveBeenCalled());
      expect(screen.queryByText("settings:blocks.dep.noImmich.reason")).toBeNull();
      expect(sw("immichbeleg")).not.toBeDisabled();
    });

    it("read both from the settings response", () => {
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
