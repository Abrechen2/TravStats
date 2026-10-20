import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FerryFormModal } from "../FerryFormModal";
import type { FerryJourney } from "../../../types/ferry";
const mocks = vi.hoisted(() => ({ save: vi.fn(), trips: vi.fn(), t: (s: string) => s }));
vi.mock("../../../lib/api/ferry", () => ({ ferryApi: { save: mocks.save } }));
vi.mock("../../../lib/api", () => ({ tripsApi: { getAll: mocks.trips } }));
vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../../Modal", () => ({
  default: ({
    children,
    footer,
  }: {
    children: React.ReactNode;
    footer: (close: () => void) => React.ReactNode;
  }) => (
    <div>
      {children}
      {footer(() => {})}
    </div>
  ),
}));
vi.mock("../FerryStationField", () => ({
  EMPTY_TERMINAL: { name: "", address: "", lat: null, lon: null, country: null },
  FerryStationField: () => <div />,
}));
const ride = {
  id: "ferry-id",
  depStationName: "Bari",
  arrStationName: "Dubrovnik",
  depLat: 41.13,
  depLon: 16.86,
  arrLat: 42.65,
  arrLon: 18.09,
  depCountry: "IT",
  arrCountry: "HR",
  depTimezone: "Europe/Rome",
  arrTimezone: "Europe/Zagreb",
  departureTime: "2026-10-20T18:00:00.000Z",
  arrivalTime: "2026-10-21T05:00:00.000Z",
  companions: ["Alex"],
  currency: "EUR",
  vehicleType: "motorhome",
  vehicleLengthM: 7.4,
  vehicleWidthM: 2.3,
  vehicleHeightM: 3.1,
  passengerCount: 2,
  cabinType: "Cabin",
  status: "scheduled",
  notes: "",
  tripId: null,
} as FerryJourney;
beforeEach(() => {
  mocks.trips.mockResolvedValue([]);
  mocks.save.mockReset();
});
describe("Ferry editor", () => {
  it("does not turn an unchanged sea estimate into a ticket distance", async () => {
    const routed = {
      ...ride,
      distanceKm: 201.4,
      distanceSource: "sea_route" as const,
      geometrySource: "sea_route" as const,
    };
    mocks.save.mockResolvedValue(routed);
    render(<FerryFormModal journey={routed} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("ferry:notes"), { target: { value: "Changed note" } });
    fireEvent.click(screen.getByRole("button", { name: "ferry:save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][1]).not.toHaveProperty("distanceKm");
  });
  it("saves vehicle and cabin details while leaving unchanged clocks and ports untouched", async () => {
    mocks.save.mockResolvedValue(ride);
    const onSaved = vi.fn();
    render(<FerryFormModal journey={ride} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("ferry:notes"), { target: { value: "Ticket checked" } });
    fireEvent.click(screen.getByRole("button", { name: "ferry:save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const input = mocks.save.mock.calls[0][1];
    expect(input).toMatchObject({
      vehicleLengthM: 7.4,
      vehicleWidthM: 2.3,
      vehicleHeightM: 3.1,
      passengerCount: 2,
      cabinType: "Cabin",
      companions: ["Alex"],
      notes: "Ticket checked",
    });
    expect(input).not.toHaveProperty("departureLocal");
    expect(input).not.toHaveProperty("departureStation");
  });
  it("keeps the form open and explains a failed save", async () => {
    mocks.save.mockRejectedValue(new Error("offline"));
    const onSaved = vi.fn();
    render(<FerryFormModal journey={ride} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "ferry:save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ferry:saveError");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
