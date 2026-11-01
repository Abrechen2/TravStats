import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));

import { useSettingsStore } from "../../../store/settingsStore";
import { resetWriteQueue } from "../../ui/settings/writeQueue";
import CruisePreferencesSection from "../CruisePreferencesSection";

const CRUISE = { defaultLine: "AIDA", defaultCabinType: "balcony", showCruiseArcs: true } as const;
const save = vi.fn();
const setCruise = vi.fn();

const settle = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(useSettingsStore.getState(), { setCruise, saveRemoteSettings: save });
  render(<CruisePreferencesSection cruise={{ ...CRUISE }} />);
});
afterEach(() => {
  cleanup();
  act(() => resetWriteQueue());
  vi.useRealTimers();
  save.mockReset();
  setCruise.mockReset();
});

describe("CruisePreferencesSection", () => {
  it("shows the stored cabin and clears the default back to null", async () => {
    save.mockResolvedValue(undefined);
    const select = screen.getByRole("combobox", { name: "settings:rows.cruiseCabin.name" });
    expect(select).toHaveValue("balcony");
    fireEvent.change(select, { target: { value: "none" } });
    await settle(400);
    expect(setCruise).toHaveBeenCalledWith({ defaultCabinType: null });
    fireEvent.change(select, { target: { value: "suite" } });
    await settle(400);
    expect(setCruise).toHaveBeenLastCalledWith({ defaultCabinType: "suite" });
  });

  it("offers no 'routes on the map' switch any more", () => {
    expect(screen.queryByRole("switch", { name: /showArcs/ })).not.toBeInTheDocument();
  });

  it("a refused cabin save keeps the pick, says so and puts only the cabin back in the store", async () => {
    save.mockRejectedValue(new Error("Network Error"));
    const select = screen.getByRole("combobox", { name: "settings:rows.cruiseCabin.name" });
    fireEvent.change(select, { target: { value: "suite" } });
    await settle(400);
    expect(select).toHaveValue("suite");
    expect(screen.getByRole("alert")).toHaveTextContent("settings:blocks.save.failed");
    expect(setCruise).toHaveBeenLastCalledWith({ defaultCabinType: "balcony" });
  });
});
