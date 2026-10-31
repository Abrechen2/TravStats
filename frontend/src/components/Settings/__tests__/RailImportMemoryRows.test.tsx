import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    useSuggestionSwitchesStore.setState({ railImportLocalTransit: "skip", railImportBus: "skip" });
  });
  afterEach(cleanup);

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
    expect(screen.queryByText("settings:import.railMemory.bus.title")).toBeNull();
    cleanup();
    enabled.domains = ["flight", "rail", "bus"];
    view();
    expect(screen.getByText("settings:import.railMemory.bus.title")).toBeInTheDocument();
  });

  it("says 'saved' only after the server confirmed", async () => {
    view();
    fireEvent.click(
      screen.getByRole("radio", { name: "settings:import.railMemory.localTransit.rail" })
    );
    expect(screen.queryByRole("status")).toBeNull();
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ railImport: { localTransit: "rail" } })
    );
    expect(await screen.findByRole("status")).toHaveTextContent("settings:import.railMemory.saved");
  });

  it("never says 'saved' when the write fails, and rolls the choice back", async () => {
    updateSettings.mockReset().mockRejectedValue(new Error("down"));
    view();
    fireEvent.click(
      screen.getByRole("radio", { name: "settings:import.railMemory.localTransit.rail" })
    );
    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    await waitFor(() =>
      expect(useSuggestionSwitchesStore.getState().railImportLocalTransit).toBe("skip")
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});
