import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k),
  }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
const getAll = vi.fn();
vi.mock("../../../lib/api/pendingUpdates", () => ({
  pendingUpdatesApi: { getAll: () => getAll() },
}));

import AutoUpdateSection from "../AutoUpdateSection";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";
import { resetWriteQueue, DEBOUNCE_MS } from "../../ui/settings/writeQueue";

const SETTINGS = {
  enabled: true,
  requireApproval: true,
  checkInterval: 15,
  onlyDuringFlight: true,
  expiryHours: 24,
};

function renderSection(
  onSave = vi.fn().mockResolvedValue(undefined),
  flight: boolean | null = null
) {
  render(
    <MemoryRouter>
      <AutoUpdateSection
        autoUpdateSettings={SETTINGS}
        loadState="loaded"
        onRetryLoad={vi.fn()}
        onSave={onSave}
        flightDataAvailable={flight}
      />
    </MemoryRouter>
  );
  return onSave;
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
  });
};

describe("AutoUpdateSection", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getAll.mockReset().mockResolvedValue({ updates: [], count: 2 });
    useSettingsLevelStore.setState({ level: "expert" });
  });
  afterEach(() => {
    cleanup();
    resetWriteQueue();
    vi.useRealTimers();
    act(() => useSettingsLevelStore.setState({ level: null }));
  });

  it("writes only the field a switch changed", async () => {
    const onSave = renderSection();
    fireEvent.click(screen.getByRole("switch", { name: "settings:rows.approveUpdates.name" }));
    await flush();
    expect(onSave).toHaveBeenCalledWith({ requireApproval: false });
  });

  it("a refused write keeps the choice, says so and retries per row (no toast, no snap-back)", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("x"), { response: { status: 500 } }))
      .mockResolvedValue(undefined);
    renderSection(onSave);
    const sw = (): HTMLElement =>
      screen.getByRole("switch", { name: "settings:rows.approveUpdates.name" });
    fireEvent.click(sw());
    await flush();
    expect(sw()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/settings:blocks.save.failed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await flush();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith({ requireApproval: false });
    expect(screen.queryByText(/settings:blocks.save.failed/)).toBeNull();
  });

  it("an out-of-range expiry is explained and never sent", async () => {
    const onSave = renderSection();
    fireEvent.change(screen.getByLabelText("settings:rows.updateExpiry.name"), {
      target: { value: "500" },
    });
    await flush();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/settings:blocks.number.range/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("settings:rows.updateExpiry.name"), {
      target: { value: "30" },
    });
    await flush();
    expect(onSave).toHaveBeenCalledWith({ expiryHours: 30 });
  });

  it("names the missing flight data service, with the jump to Dienste", async () => {
    renderSection(undefined, false);
    await act(async () => {});
    expect(screen.getByText("settings:rows.liveUpdates.noFlightData")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /settings:rows.liveUpdates.toServices/ })
    ).toBeInTheDocument();
  });

  it("shows how many updates are open, and leaves the count out when it cannot be read", async () => {
    renderSection();
    expect(await screen.findByText(/settings:rows.openUpdates.count/)).toBeInTheDocument();
    cleanup();
    getAll.mockRejectedValue(new Error("down"));
    renderSection();
    await act(async () => {});
    expect(screen.queryByText(/settings:rows.openUpdates.count/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /settings:autoUpdate.viewPending/ })
    ).toBeInTheDocument();
  });

  it("hides the expiry at the standard level", async () => {
    useSettingsLevelStore.setState({ level: "standard" });
    renderSection();
    await act(async () => {});
    expect(screen.queryByLabelText("settings:rows.updateExpiry.name")).toBeNull();
  });
});
