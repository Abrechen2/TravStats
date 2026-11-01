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
import { useAuthStore } from "../../../store/authStore";
import { generalSettingsWereSaved, useSettingsStore } from "../../../store/settingsStore";
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
  render(<UnitsSection units={units} baseCurrency="EUR" />);
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
    fireEvent.click(radio("settings:rows.distance.name", 1));
    await settle(400);
    expect(setUnits).toHaveBeenCalledWith({ distanceUnit: "miles" });
    expect(screen.getByRole("alert")).toHaveTextContent("settings:blocks.save.failed");
    // The pick is still the picked one, and the saved-state mark never appeared.
    expect(radio("settings:rows.distance.name", 1)).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText("settings:blocks.save.saved")).not.toBeInTheDocument();
  });

  it("Verwerfen restores the last SAVED unit; Erneut versuchen writes it again", async () => {
    save.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValue(undefined);
    fireEvent.click(radio("settings:rows.distance.name", 2));
    await settle(400);
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await settle(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.getByText("settings:blocks.save.saved")).toBeInTheDocument();

    save.mockReset();
    save.mockRejectedValue(new Error("Network Error"));
    fireEvent.click(radio("settings:rows.weight.name", 1));
    await settle(400);
    expect(radio("settings:rows.weight.name", 1)).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.discard" }));
    expect(radio("settings:rows.weight.name", 0)).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("puts the refused unit back in the store, so no later save of the document carries it", async () => {
    save.mockRejectedValue(new Error("Network Error"));
    fireEvent.click(radio("settings:rows.distance.name", 1));
    await settle(400);
    expect(setUnits).toHaveBeenNthCalledWith(1, { distanceUnit: "miles" });
    expect(setUnits).toHaveBeenNthCalledWith(2, { distanceUnit: "kilometers" });
  });

  it("writes nothing while the settings never loaded, and says why", async () => {
    useRemoteSettingsStatus.setState({ failed: true });
    try {
      fireEvent.click(radio("settings:rows.distance.name", 1));
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
    fireEvent.click(radio("settings:rows.distance.name", 1));
    expect(save).not.toHaveBeenCalled();
    cleanup();
    expect(save).toHaveBeenCalledTimes(1);
    expect(setUnits).toHaveBeenCalledWith({ distanceUnit: "miles" });
  });

  it("a save that failed only on the birthdate keeps the unit that DID save, and reports nothing", async () => {
    const partial = Object.assign(new Error("birthdate refused"), { response: { status: 500 } });
    const original = generalSettingsWereSaved;
    // The store marks such an error; the real marker is exercised in settingsStore tests.
    const store = await import("../../../store/settingsStore");
    const mark = vi
      .spyOn(store, "generalSettingsWereSaved")
      .mockImplementation((e) => e === partial);
    try {
      save.mockRejectedValue(partial);
      fireEvent.click(radio("settings:rows.distance.name", 1));
      await settle(400);
      expect(setUnits).toHaveBeenCalledTimes(1);
      expect(setUnits).toHaveBeenCalledWith({ distanceUnit: "miles" });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      mark.mockRestore();
      void original;
    }
  });

  it("a refusal that arrives after the account changed does not touch the next account's store", async () => {
    let reject: (e: Error) => void = () => undefined;
    save.mockImplementation(() => new Promise<void>((_, r) => (reject = r)));
    act(() => useAuthStore.setState({ user: { id: "a" } as never }));
    fireEvent.click(radio("settings:rows.distance.name", 1));
    await settle(400);
    act(() => useAuthStore.setState({ user: { id: "b" } as never }));
    reject(new Error("Network Error"));
    await settle(0);
    expect(setUnits).toHaveBeenCalledTimes(1);
    act(() => useAuthStore.setState({ user: null }));
  });
});
