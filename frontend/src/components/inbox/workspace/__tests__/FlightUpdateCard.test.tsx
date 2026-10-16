import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/**
 * What the old updates tab showed and the workspace card did not (inbox
 * consolidation, 2026-10-16): who proposed it in words, how long it waits,
 * whether it is a guess from reference flights, what it does to the
 * statistics, and the full diff.
 */
describe("FlightUpdateCard evidence", () => {
  afterEach(() => vi.useRealTimers());

  it("names a paired phone as the source instead of printing device_gps (forgejo#194)", () => {
    mount({ ...update, apiSource: "device_gps" });
    expect(screen.getByText(/Telefon \(GPS\)/)).toBeInTheDocument();
    expect(screen.queryByText(/device_gps/)).not.toBeInTheDocument();
  });

  it("names the historical enrichment and FlightAware in words", () => {
    const { unmount } = mount({ ...update, apiSource: "historical_aggregation" });
    expect(screen.getByText(/Historische Anreicherung/)).toBeInTheDocument();
    unmount();
    mount({ ...update, apiSource: "aeroapi" });
    expect(screen.getByText(/FlightAware AeroAPI/)).toBeInTheDocument();
  });

  it("says a historical enrichment is an unverified guess, with its basis", () => {
    mount({
      ...update,
      metadata: {
        isHistoricalEnrichment: true,
        enrichmentMode: "slim",
        confidence: 80,
        sourceFlightsCount: 12,
      },
    });
    expect(screen.getByRole("note")).toHaveTextContent("Basis");
    expect(screen.getByRole("note")).toHaveTextContent(
      "nicht verifiziert · basiert auf 12 Referenzflügen (80% Konfidenz)"
    );
  });

  it("says how long the proposal still waits", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T00:00:00Z"));
    mount({ ...update, expiresAt: "2026-10-17T06:00:00Z" });
    expect(screen.getByText(/Läuft ab in 3 Tage/)).toBeInTheDocument();
  });

  it("shows the distance the change adds to the statistics", () => {
    mount({ ...update, statisticsImpact: { distance: { before: 100, after: 340, change: 240 } } });
    expect(screen.getByText(/Statistik-Auswirkungen: Distanz \+240 km/)).toBeInTheDocument();
  });

  it("keeps the full diff one click away", () => {
    const { container } = mount(update);
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(within(details!).getByText("Details anzeigen")).toBeInTheDocument();
    expect(within(details!).getByText("Detaillierte Änderungen")).toBeInTheDocument();
  });

  it("confirms an applied and a kept update in words", async () => {
    const { act } = mount(update);
    fireEvent.click(screen.getByRole("button", { name: "Änderungen in Flug übernehmen" }));
    await waitFor(() =>
      expect(act).toHaveBeenLastCalledWith(
        expect.any(Function),
        false,
        "Update erfolgreich angewendet"
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Bisherige Angaben behalten" }));
    await waitFor(() => expect(pendingUpdatesApi.reject).toHaveBeenCalledWith("update1"));
    expect(act).toHaveBeenLastCalledWith(expect.any(Function), false, "Update abgelehnt");
  });
});
