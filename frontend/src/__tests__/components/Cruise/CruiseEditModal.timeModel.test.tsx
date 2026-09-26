import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CruiseEditModal } from "../../../components/Cruise/CruiseEditModal";
import { cruiseApi, companionsApi, tripsApi } from "../../../lib/api";
import type { Cruise, CruiseStop } from "../../../types";

vi.mock("../../../lib/api", () => ({
  cruiseApi: { create: vi.fn(), update: vi.fn() },
  portsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
  shipsApi: {
    search: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    cruiseLines: vi.fn().mockResolvedValue([]),
  },
  companionsApi: { list: vi.fn() },
  tripsApi: { getAll: vi.fn() },
}));
vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => [] };
});

const portCall = (patch: Partial<CruiseStop>): CruiseStop => ({
  id: "s1",
  cruiseId: "c1",
  portId: 42,
  port: {
    id: 42,
    name: "Bergen",
    city: "Bergen",
    country: "NO",
    unlocode: "NOBGO",
    lat: 60.39,
    lon: 5.32,
    timezone: "Europe/Oslo",
    region: null,
    isUserAdded: false,
  },
  dayNumber: 2,
  date: "2027-06-02T00:00:00.000Z",
  isAtSea: false,
  arrivalTime: "2027-06-02T08:00:00.000Z",
  departureTime: null,
  excursionNote: null,
  unresolvedPortName: null,
  ...patch,
});

const cruise = (stops: CruiseStop[]): Cruise =>
  ({
    id: "c1",
    userId: "u1",
    shipId: null,
    ship: null,
    shipNameOverride: null,
    cruiseLine: "Hurtigruten",
    routeName: null,
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: "2027-06-01T00:00:00.000Z",
    endDate: "2027-06-08T00:00:00.000Z",
    status: "scheduled",
    color: null,
    cabinNumber: null,
    cabinType: null,
    deck: null,
    bookingReference: null,
    price: null,
    currency: "EUR",
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    stops,
    createdAt: "2027-01-01T00:00:00.000Z",
    updatedAt: "2027-01-01T00:00:00.000Z",
  }) as Cruise;

/** The cruise editor under the time model (ADR 0002, D2/D3), as a German reader sees it. */
describe("CruiseEditModal — time model", () => {
  beforeEach(() => {
    vi.mocked(companionsApi.list).mockReset().mockResolvedValue([]);
    vi.mocked(tripsApi.getAll).mockReset().mockResolvedValue([]);
    vi.mocked(cruiseApi.update).mockReset();
  });

  it("sends the days as dates and a port call as {local, zone}", async () => {
    vi.mocked(cruiseApi.update).mockResolvedValue(cruise([]));
    render(
      <CruiseEditModal
        mode="edit"
        cruise={cruise([portCall({})])}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(cruiseApi.update).toHaveBeenCalled());
    const body = vi.mocked(cruiseApi.update).mock.calls[0][1];
    expect(body.startDate).toBe("2027-06-01");
    expect(body.stops?.[0]).toMatchObject({
      date: "2027-06-02",
      arrivalTime: { local: "2027-06-02T08:00", zone: "Europe/Oslo" },
    });
  });

  it("a time on a stop without a port is refused in German instead of saved as UTC", async () => {
    const unresolved = portCall({ portId: null, port: null, unresolvedPortName: "Flåm" });
    render(
      <CruiseEditModal
        mode="edit"
        cruise={cruise([unresolved])}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText(/keine Zeitzone bekannt/)).toBeInTheDocument();
    expect(cruiseApi.update).not.toHaveBeenCalled();
  });

  it("shows the server's gap refusal and the stale-bundle refusal in German", async () => {
    vi.mocked(cruiseApi.update).mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 422, data: { error: "x", code: "LOCAL_TIME_NONEXISTENT" } },
    });
    render(
      <CruiseEditModal
        mode="edit"
        cruise={cruise([portCall({})])}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText(/Zeitumstellung/)).toBeInTheDocument();

    vi.mocked(cruiseApi.update).mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 422, data: { error: "x", code: "TIME_SHAPE_REQUIRED" } },
    });
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText(/lade die Seite neu/)).toBeInTheDocument();
  });
});
