import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const enabled = vi.hoisted(() => ({ domains: ["flight", "rail"] as string[] }));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: (d: string) => enabled.domains.includes(d) }),
}));

const updateSettings = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api", () => ({
  settingsApi: { update: (...a: unknown[]) => updateSettings(...a) },
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
}));

import { resetWriteQueue } from "../../ui/settings/writeQueue";
import { RailImportMemoryRows } from "../RailImportMemoryRows";
import { useSuggestionSwitchesStore } from "../../../store/suggestionSwitchesStore";

const view = () =>
  render(
    <MemoryRouter>
      <RailImportMemoryRows />
    </MemoryRouter>
  );

describe("RailImportMemoryRows — the remembered rail-import choices in Settings › Daten › Import", () => {
  beforeEach(() => {
    updateSettings.mockReset().mockResolvedValue({});
    enabled.domains = ["flight", "rail"];
    useSuggestionSwitchesStore.setState({
      railImportLocalTransit: "skip",
      railImportBus: "skip",
      railImportSaves: { localTransit: 0, bus: 0 },
    });
  });
  afterEach(() => {
    cleanup();
    act(() => resetWriteQueue());
  });

  it("shows the stored choice and a link back to the import", () => {
    useSuggestionSwitchesStore.setState({ railImportLocalTransit: "rail" });
    view();
    expect(
      screen.getByRole("radio", { name: "settings:import.railMemory.localTransit.rail" })
    ).toBeChecked();
    expect(screen.getByRole("link", { name: /railMemory.openImport/ })).toHaveAttribute(
      "href",
      "/rail"
    );
  });

  it("offers the bus choice only with the bus domain on", () => {
    view();
    expect(screen.queryByText("settingsRows:data.busleg.t")).toBeNull();
    cleanup();
    enabled.domains = ["flight", "rail", "bus"];
    view();
    expect(screen.getByText("settingsRows:data.busleg.t")).toBeInTheDocument();
  });

  it("says 'Gespeichert' only after the server confirmed, and the stores take the value then", async () => {
    view();
    fireEvent.click(
      screen.getByRole("radio", { name: "settings:import.railMemory.localTransit.rail" })
    );
    expect(screen.queryByText("settings:blocks.save.saved")).toBeNull();
    expect(useSuggestionSwitchesStore.getState().railImportLocalTransit).toBe("skip");
    await waitFor(
      () => expect(updateSettings).toHaveBeenCalledWith({ railImport: { localTransit: "rail" } }),
      { timeout: 3000 }
    );
    expect(await screen.findByText("settings:blocks.save.saved")).toBeInTheDocument();
    expect(useSuggestionSwitchesStore.getState().railImportLocalTransit).toBe("rail");
    // The import dialog's "remembered" line waits for this count to advance.
    expect(useSuggestionSwitchesStore.getState().railImportSaves.localTransit).toBe(1);
  });

  it("a failed write keeps the pick on screen, never says 'Gespeichert', and leaves the store on the saved value", async () => {
    updateSettings.mockReset().mockRejectedValue(new Error("down"));
    view();
    fireEvent.click(
      screen.getByRole("radio", { name: "settings:import.railMemory.localTransit.rail" })
    );
    expect(await screen.findByRole("alert", undefined, { timeout: 3000 })).toHaveTextContent(
      "settings:blocks.save.failed"
    );
    expect(
      screen.getByRole("radio", { name: "settings:import.railMemory.localTransit.rail" })
    ).toBeChecked();
    expect(useSuggestionSwitchesStore.getState().railImportLocalTransit).toBe("skip");
    expect(screen.queryByText("settings:blocks.save.saved")).toBeNull();
    expect(useSuggestionSwitchesStore.getState().railImportSaves.localTransit).toBe(0);
  });

  it("keeps one default's 'Gespeichert' from standing in for the other's failed save", async () => {
    enabled.domains = ["flight", "rail", "bus"];
    updateSettings
      .mockReset()
      .mockImplementation(async (patch: { railImport: { bus?: string } }) => {
        if (patch.railImport.bus) throw new Error("down");
        return {};
      });
    view();
    fireEvent.click(
      screen.getByRole("radio", { name: "settings:import.railMemory.localTransit.rail" })
    );
    expect(
      await screen.findAllByText("settings:blocks.save.saved", undefined, { timeout: 3000 })
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: "settings:import.railMemory.bus.bus" }));
    expect(await screen.findByRole("alert", undefined, { timeout: 3000 })).toHaveTextContent(
      "settings:blocks.save.failed"
    );
    expect(useSuggestionSwitchesStore.getState().railImportBus).toBe("skip");
    expect(useSuggestionSwitchesStore.getState().railImportSaves).toEqual({
      localTransit: 1,
      bus: 0,
    });
  });
});
