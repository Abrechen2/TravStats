import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FerryFormModal } from "../FerryFormModal";
import type { FerryJourney } from "../../../types/ferry";
import { useToastStore } from "../../../store/toastStore";
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  trips: vi.fn(),
  t: (s: string) => s,
  seaRoute: "unchanged" as string,
}));
vi.mock("../../../lib/api/ferry", () => ({
  ferryApi: {
    saveReported: (...args: unknown[]) =>
      Promise.resolve(mocks.save(...args)).then((ride) => ({ ride, seaRoute: mocks.seaRoute })),
  },
}));
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
  mocks.seaRoute = "unchanged";
  useToastStore.setState({ toasts: [] });
});
describe("Ferry editor", () => {
  it("does not send an unchanged sea estimate back as a typed distance", async () => {
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
    // null = "no typed distance": the server keeps the stored sea-route length.
    expect(mocks.save.mock.calls[0][1].distanceKm).toBeNull();
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
  it("does not save a computed distance back as one the user typed", async () => {
    // An edit used to prefill the great-circle figure and send it back, which the
    // backend stores as distanceSource "user" — freezing a distance nobody typed.
    mocks.save.mockResolvedValue(ride);
    const computed = { ...ride, distanceKm: 512, distanceSource: "great_circle" } as FerryJourney;
    render(<FerryFormModal journey={computed} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText("ferry:distanceKm")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("ferry:notes"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "ferry:save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][1].distanceKm).toBeNull();
  });
  it("keeps a distance the user typed", async () => {
    mocks.save.mockResolvedValue(ride);
    const typed = { ...ride, distanceKm: 333, distanceSource: "user" } as FerryJourney;
    render(<FerryFormModal journey={typed} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("ferry:notes"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "ferry:save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][1].distanceKm).toBe(333);
  });
  it("keeps the form open and explains a failed save", async () => {
    mocks.save.mockRejectedValue(new Error("offline"));
    const onSaved = vi.fn();
    render(<FerryFormModal journey={ride} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "ferry:save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ferry:saveError");
    expect(onSaved).not.toHaveBeenCalled();
  });
  // `Number("39,90")` is NaN, which JSON sends as null: a German price, length
  // or distance was silently cleared on save.
  it.each([
    ["39,90", 39.9],
    ["1.500,00", 1500],
    ["39.90", 39.9],
  ])("sends a price typed as %s as %s", async (raw, expected) => {
    mocks.save.mockResolvedValue(ride);
    render(<FerryFormModal journey={ride} onClose={vi.fn()} onSaved={vi.fn()} />);
    const price = screen.getByLabelText("ferry:price");
    expect(price).toHaveAttribute("inputmode", "decimal");
    fireEvent.change(price, { target: { value: raw } });
    fireEvent.change(screen.getByLabelText("ferry:vehicleLengthM"), { target: { value: "7,45" } });
    fireEvent.click(screen.getByRole("button", { name: "ferry:save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][1]).toMatchObject({ price: expected, vehicleLengthM: 7.45 });
  });
  it.each(["abc", "39,9,0", "-1"])(
    "refuses a price typed as %s instead of clearing it",
    async (raw) => {
      render(<FerryFormModal journey={ride} onClose={vi.fn()} onSaved={vi.fn()} />);
      fireEvent.change(screen.getByLabelText("ferry:price"), { target: { value: raw } });
      fireEvent.click(screen.getByRole("button", { name: "ferry:save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("ferry:invalidNumber");
      expect(mocks.save).not.toHaveBeenCalled();
    }
  );
  it("says so when the crossing was saved but its sea route failed (Codex review)", async () => {
    mocks.save.mockResolvedValue(ride);
    mocks.seaRoute = "failed";
    const onSaved = vi.fn();
    render(<FerryFormModal journey={ride} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("ferry:notes"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "ferry:save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(ride));
    expect(useToastStore.getState().toasts.map((x) => [x.type, x.message])).toEqual([
      ["warning", "ferry:routing.autoFailed"],
    ]);
  });

  it("stays quiet when there was simply no sea way", async () => {
    mocks.save.mockResolvedValue(ride);
    mocks.seaRoute = "straight";
    const onSaved = vi.fn();
    render(<FerryFormModal journey={ride} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("ferry:notes"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "ferry:save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
