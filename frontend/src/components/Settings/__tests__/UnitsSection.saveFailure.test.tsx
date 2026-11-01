/**
 * The reference page of the settings rebuild (package 2): the units card runs
 * on the new row and write queue, and a refused save has to reach the user as
 * itself — their pick stays, the row says it was not saved, and "Verwerfen"
 * brings back the unit the server last confirmed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));

import { useRemoteSettingsStatus } from "../../../store/remoteSettingsStatus";
import { useSettingsStore } from "../../../store/settingsStore";
import { resetWriteQueue } from "../../ui/settings/writeQueue";
import UnitsSection from "../UnitsSection";

const units = { distanceUnit: "kilometers" as const, weightUnit: "kg" as const, currency: "EUR" };
const save = vi.fn();
const setUnits = vi.fn();

const radio = (group: string, index: number): Element =>
  Array.from(screen.getByRole("radiogroup", { name: group }).querySelectorAll('[role="radio"]'))[
    index
  ];

const settle = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(useSettingsStore.getState(), { setUnits, saveRemoteSettings: save });
  render(<UnitsSection units={units} baseCurrency="EUR" onSetBaseCurrency={() => undefined} />);
});
afterEach(() => {
  cleanup();
  act(() => resetWriteQueue());
  vi.useRealTimers();
  save.mockReset();
  setUnits.mockReset();
});

describe("the distance unit when the server refuses the save", () => {
  it("keeps the picked unit, says it was not saved and does not pretend", async () => {
    save.mockRejectedValue(Object.assign(new Error("403"), { response: { status: 500 } }));
    fireEvent.click(radio("settings:units.distance", 1));
    await settle(400);
    expect(setUnits).toHaveBeenCalledWith({ distanceUnit: "miles" });
    expect(screen.getByRole("alert")).toHaveTextContent("settings:blocks.save.failed");
    // The pick is still the picked one, and the saved-state mark never appeared.
    expect(radio("settings:units.distance", 1)).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText("settings:blocks.save.saved")).not.toBeInTheDocument();
  });

  it("Verwerfen restores the last SAVED unit; Erneut versuchen writes it again", async () => {
    save.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValue(undefined);
    fireEvent.click(radio("settings:units.distance", 2));
    await settle(400);
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await settle(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.getByText("settings:blocks.save.saved")).toBeInTheDocument();

    save.mockReset();
    save.mockRejectedValue(new Error("Network Error"));
    fireEvent.click(radio("settings:units.weight", 1));
    await settle(400);
    expect(radio("settings:units.weight", 1)).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.discard" }));
    expect(radio("settings:units.weight", 0)).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("puts the refused unit back in the store, so no later save of the document carries it", async () => {
    save.mockRejectedValue(new Error("Network Error"));
    fireEvent.click(radio("settings:units.distance", 1));
    await settle(400);
    expect(setUnits).toHaveBeenNthCalledWith(1, { distanceUnit: "miles" });
    expect(setUnits).toHaveBeenNthCalledWith(2, { distanceUnit: "kilometers" });
  });

  it("writes nothing while the settings never loaded, and says why", async () => {
    useRemoteSettingsStatus.setState({ failed: true });
    try {
      fireEvent.click(radio("settings:units.distance", 1));
      await settle(400);
      expect(save).not.toHaveBeenCalled();
      expect(setUnits).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent("settings:blocks.save.failed");
    } finally {
      useRemoteSettingsStatus.setState({ failed: false });
    }
  });

  it("leaving the page sends a pick that is still waiting for its debounce", () => {
    save.mockResolvedValue(undefined);
    fireEvent.click(radio("settings:units.distance", 1));
    expect(save).not.toHaveBeenCalled();
    cleanup();
    expect(save).toHaveBeenCalledTimes(1);
    expect(setUnits).toHaveBeenCalledWith({ distanceUnit: "miles" });
  });
});
