import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const bulk = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/api/flightLookup", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/api/flightLookup")>(
    "../../../../lib/api/flightLookup"
  );
  return { ...actual, flightLookupApi: { bulk } };
});
vi.mock("../../../../lib/api/flights", () => ({ flightsApi: { update } }));

import FlightRefreshModal from "../FlightRefreshModal";
import { planRefresh } from "../flightRefreshModel";
import type { Flight } from "../../../../types";

const flight = (id: string, over: Partial<Flight> = {}): Flight =>
  ({
    id,
    flightNumber: `LH${id}`,
    departureTime: "2024-05-01T10:00:00.000Z",
    depTimezone: "Europe/Berlin",
    depTzSource: "airport",
    ...over,
  }) as unknown as Flight;

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("planRefresh (forgejo#407)", () => {
  const found = (flights: object[]) => ({
    status: "found" as const,
    flights,
    providerFailures: [],
  });

  it("fills only the fields that are empty on the flight", () => {
    const plan = planRefresh(
      { aircraft: "A320", aircraftRegistration: "", aircraftModeS: undefined },
      found([{ aircraft: "A321", aircraftRegistration: "D-AIZA", aircraftModeS: "3C6444" }])
    );
    expect(plan).toEqual({
      kind: "fill",
      patch: { aircraftRegistration: "D-AIZA", aircraftModeS: "3C6444" },
    });
  });

  it("guesses nothing from two hits and adds nothing the flight already has", () => {
    expect(planRefresh({}, found([{ aircraft: "A1" }, { aircraft: "A2" }]))).toEqual({
      kind: "ambiguous",
    });
    expect(planRefresh({ aircraft: "A320" }, found([{ aircraft: "A321" }]))).toEqual({
      kind: "nothingNew",
    });
  });
});

describe("FlightRefreshModal (forgejo#407)", () => {
  const labelOf = (id: string) => `Flug ${id}`;

  it("asks the provider on each flight's own day and fills only after the user presses apply", async () => {
    bulk.mockResolvedValue([
      {
        index: 0,
        flightNumber: "LH1",
        success: true,
        flights: [{ aircraftRegistration: "D-AIZA" }],
      },
      {
        index: 1,
        flightNumber: "LH2",
        success: false,
        error: "LOOKUP_PROVIDER_FAILED",
        providerFailures: [{ provider: "aerodatabox", outcome: "auth" }],
      },
    ]);
    update.mockResolvedValue({});
    const onApplied = vi.fn();
    const user = userEvent.setup();
    render(
      <FlightRefreshModal
        flights={[flight("1"), flight("2")]}
        labelOf={labelOf}
        onClose={vi.fn()}
        onApplied={onApplied}
      />
    );
    await user.click(screen.getByRole("button", { name: /refresh\.start/ }));
    const rowsEl = await screen.findAllByTestId("flight-refresh-row");
    expect(rowsEl[0]).toHaveTextContent("flights:refresh.willFill");
    expect(rowsEl[1]).toHaveTextContent("flights:lookup.reason.providers");
    expect(rowsEl[1]).toHaveTextContent("errors:providerFailure.auth");
    expect(bulk).toHaveBeenCalledWith([
      { flightNumber: "LH1", date: "2024-05-01" },
      { flightNumber: "LH2", date: "2024-05-01" },
    ]);
    expect(update).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /refresh\.apply/ }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("1", { aircraftRegistration: "D-AIZA" })
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalled();
  });

  it("says when saving one flight failed and keeps the others", async () => {
    bulk.mockResolvedValue([
      { index: 0, flightNumber: "LH1", success: true, flights: [{ aircraft: "A320" }] },
      { index: 1, flightNumber: "LH2", success: true, flights: [{ aircraft: "A321" }] },
    ]);
    update.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({});
    const user = userEvent.setup();
    render(
      <FlightRefreshModal
        flights={[flight("1"), flight("2")]}
        labelOf={labelOf}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: /refresh\.start/ }));
    await screen.findAllByTestId("flight-refresh-row");
    await user.click(screen.getByRole("button", { name: /refresh\.apply/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("flights:refresh.applyFailed");
    expect(update).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("flights:refresh.applied");
  });
});
