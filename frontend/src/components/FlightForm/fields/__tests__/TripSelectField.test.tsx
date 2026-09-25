import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { useState } from "react";
import TripSelectField from "../TripSelectField";
import { tripsApi } from "../../../../lib/api/trips";
import type { Trip } from "../../../../types";

vi.mock("../../../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn() },
}));

const trips = [
  {
    id: "trip-summer",
    name: "Sommer",
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2026-07-14T00:00:00.000Z",
  },
  {
    id: "trip-autumn",
    name: "Herbst",
    startDate: "2026-10-03T00:00:00.000Z",
    endDate: null,
  },
] as unknown as Trip[];

// A form holding tripId, as useFlightForm does; the date can be moved.
function Harness({ date }: { date?: string }): JSX.Element {
  const [tripId, setTripId] = useState("");
  return (
    <>
      <TripSelectField value={tripId} onChange={setTripId} preselectForDate={date} />
      <output data-testid="trip">{tripId}</output>
    </>
  );
}

function select(): HTMLSelectElement {
  return screen.getByRole("combobox") as HTMLSelectElement;
}

describe("TripSelectField — preselection by departure day", () => {
  beforeEach(() => {
    vi.mocked(tripsApi.getAll).mockReset().mockResolvedValue(trips);
  });

  it("a new flight gets the trip its departure day falls in", async () => {
    render(<Harness date="2026-07-01" />);
    await waitFor(() => expect(screen.getByTestId("trip")).toHaveTextContent("trip-summer"));
    expect(select().value).toBe("trip-summer");
  });

  it("follows the departure day until the user picks", async () => {
    const { rerender } = render(<Harness date="2026-07-05" />);
    await waitFor(() => expect(select().value).toBe("trip-summer"));

    rerender(<Harness date="2026-10-10" />);
    await waitFor(() => expect(select().value).toBe("trip-autumn"));

    fireEvent.change(select(), { target: { value: "" } });
    rerender(<Harness date="2026-07-05" />);
    await waitFor(() => expect(tripsApi.getAll).toHaveBeenCalled());
    expect(select().value).toBe("");
  });

  it("selects nothing when no trip covers the day", async () => {
    render(<Harness date="2026-08-01" />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Sommer" })).toBeInTheDocument());
    expect(select().value).toBe("");
  });

  it("without a date — the edit modal — it never preselects", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Sommer" })).toBeInTheDocument());
    expect(select().value).toBe("");
  });
});
