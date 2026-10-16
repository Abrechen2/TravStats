import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { germanUseTranslation } from "../../../../__tests__/helpers/germanT";
import FlightUpdateCard from "../FlightUpdateCard";
import { pendingUpdatesApi } from "../../../../lib/api/pendingUpdates";
import type { PendingUpdate } from "../../../../lib/api/types";
import { update } from "./fixtures";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => germanUseTranslation(),
}));
vi.mock("../../../../lib/api/pendingUpdates", () => ({
  pendingUpdatesApi: { apply: vi.fn(), update: vi.fn(), reject: vi.fn() },
}));

/** A provider proposal that reports actual times and a cancellation. */
const cancelled: PendingUpdate = {
  ...update,
  originalData: { actualDeparture: null, status: "scheduled", gate: null },
  proposedData: {
    actualDeparture: "2026-09-17T18:05:00.000Z",
    actualArrival: "2026-09-17T21:10:00.000Z",
    status: "cancelled",
    gate: null,
  },
  changes: [
    { field: "actualDeparture", type: "changed", oldValue: null, newValue: "x" },
    { field: "status", type: "changed", oldValue: "scheduled", newValue: "cancelled" },
  ],
};

function mount(target: PendingUpdate) {
  const act = vi.fn(async (operation: () => Promise<unknown>) => {
    await operation();
    return true;
  });
  const view = render(
    <MemoryRouter>
      <FlightUpdateCard update={target} busy={false} act={act} />
    </MemoryRouter>
  );
  return { ...view, act };
}

describe("FlightUpdateCard payload", () => {
  it("sends a minute-precision time as a full ISO instant and keeps the rest of the proposal", async () => {
    const { container } = mount(cancelled);
    const time = container.querySelector<HTMLInputElement>('input[type="datetime-local"]');
    expect(time).not.toBeNull();
    // A datetime-local input omits ":00" seconds from its value.
    fireEvent.change(time!, { target: { value: "2026-09-17T18:20" } });
    fireEvent.click(screen.getByRole("button", { name: "Änderungen in Flug übernehmen" }));

    await waitFor(() => expect(pendingUpdatesApi.apply).toHaveBeenCalledWith("update1"));
    expect(pendingUpdatesApi.update).toHaveBeenCalledWith("update1", {
      ...cancelled.proposedData,
      actualDeparture: "2026-09-17T18:20:00.000Z",
    });
  });
});
