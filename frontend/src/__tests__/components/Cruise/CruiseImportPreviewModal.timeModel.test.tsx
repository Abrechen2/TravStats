import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { flightsApi } from "../../../lib/api/flights";
import { CruiseImportPreviewModal } from "../../../components/Cruise/CruiseImportPreviewModal";
import { cruiseApi } from "../../../lib/api/cruise";
import type { ParsedCruiseEntry } from "../../../lib/api/parse";
import type { Cruise } from "../../../types";

vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

// The import editor also renders ShipPicker/PortPicker, which reach into
// lib/api for their own search calls — stub those out so the modal can
// render without hitting the network.
vi.mock("../../../lib/api", () => ({
  shipsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
  portsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
  airportsApi: { search: vi.fn().mockResolvedValue([]), getByCode: vi.fn() },
  setupApi: { getAirportSeedingStatus: vi.fn().mockResolvedValue({ status: "idle" }) },
}));

vi.mock("../../../lib/api/cruise", () => ({
  cruiseApi: { create: vi.fn() },
}));

vi.mock("../../../lib/api/flights", () => ({
  flightsApi: { create: vi.fn() },
}));

vi.mock("../../../lib/api/trips", () => ({
  tripsApi: { create: vi.fn(), assignFlights: vi.fn() },
}));

const toasts = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: (...args: unknown[]) => void }) => unknown) =>
    selector({ addToast: toasts.addToast }),
}));

vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      const state = { display: { language: "en", timezone: "UTC" } };
      return typeof selector === "function" ? selector(state) : state;
    },
    { getState: () => ({ display: { language: "en", timezone: "UTC" } }) }
  ),
}));

// The currency picker asks the server which currencies were used recently. The
// hook fetches on mount, so it reached the network from every test that renders
// a price field (forgejo#110); an empty list is the failed request's own result.
vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => [] };
});

// Saving from the preview opens an import batch. This is a WRITE that escaped
// the test to the real network (forgejo#110) — the request failed, so the save
// path was never exercised past this call.
vi.mock("@/lib/api/importBatches", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/importBatches")>();
  return { ...actual, createImportBatch: vi.fn().mockResolvedValue({ id: "test-batch" }) };
});

const entry = (patch: Partial<ParsedCruiseEntry>): ParsedCruiseEntry => ({
  input: {
    cruiseLine: "AIDA",
    routeName: "Nordland",
    startDate: "2027-06-01T12:00:00.000Z",
    endDate: "2027-06-08T12:00:00.000Z",
    status: "scheduled",
    stops: [],
  },
  shipMatched: false,
  unmatchedPorts: [],
  ...patch,
});

const saveButton = () =>
  screen
    .getAllByRole("button")
    .find((b) => /speichern|übernehmen|import/i.test(b.textContent ?? ""))!;

/**
 * The import preview under the time model (ADR 0002, D2): the days go as
 * dates, and a time whose place brings no zone stops the save BEFORE any
 * write — the fly & cruise flights used to borrow the profile zone, then UTC.
 */
describe("CruiseImportPreviewModal — time model", () => {
  beforeEach(() => {
    vi.mocked(cruiseApi.create)
      .mockReset()
      .mockResolvedValue({ id: "c1" } as unknown as Cruise);
    vi.mocked(flightsApi.create).mockReset();
    toasts.addToast.mockReset();
  });

  it("sends the cruise days as bare dates", async () => {
    render(<CruiseImportPreviewModal entries={[entry({})]} onCancel={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(saveButton());
    await waitFor(() => expect(cruiseApi.create).toHaveBeenCalled());
    const body = vi.mocked(cruiseApi.create).mock.calls[0][0];
    expect(body.startDate).toBe("2027-06-01");
    expect(body.endDate).toBe("2027-06-08");
  });

  // The server keeps an unresolved port's time as a wall clock, precision
  // `unknown`; refusing it here made every such import unsavable.
  it("imports a stop time at an unresolved port as a bare wall clock", async () => {
    const withUnresolved = entry({
      input: {
        ...entry({}).input,
        stops: [
          {
            portId: null,
            dayNumber: 3,
            isAtSea: false,
            unresolvedPortName: "Flåm",
            arrivalTime: "2027-06-03T08:00:00.000Z",
          },
        ],
      },
      unmatchedPorts: [{ dayNumber: 3, portName: "Flåm" }],
    });
    render(
      <CruiseImportPreviewModal entries={[withUnresolved]} onCancel={vi.fn()} onSaved={vi.fn()} />
    );
    await userEvent.click(saveButton());
    await waitFor(() => expect(cruiseApi.create).toHaveBeenCalled());
    expect(vi.mocked(cruiseApi.create).mock.calls[0][0].stops?.[0]).toMatchObject({
      portId: null,
      unresolvedPortName: "Flåm",
      arrivalTime: { local: "2027-06-03T08:00" },
    });
    expect(toasts.addToast).not.toHaveBeenCalledWith("error", expect.anything());
  });

  it("refuses a fly & cruise flight whose airport has no zone instead of using the profile's", async () => {
    const withFlight = entry({
      flights: [
        {
          flightNumber: "LH1",
          airline: "Lufthansa",
          date: "2027-06-01",
          direction: "outbound",
          departureAirport: {
            iata: "FRA",
            icao: "EDDF",
            name: "Frankfurt",
            lat: 50,
            lon: 8,
            timezone: "Europe/Berlin",
          },
          arrivalAirport: { iata: "BGO", icao: "ENBR", name: "Bergen", lat: 60, lon: 5 },
          cabinClass: "economy",
        },
      ],
    } as Partial<ParsedCruiseEntry>);
    render(
      <CruiseImportPreviewModal entries={[withFlight]} onCancel={vi.fn()} onSaved={vi.fn()} />
    );
    await userEvent.click(saveButton());
    await waitFor(() =>
      expect(toasts.addToast).toHaveBeenCalledWith(
        "error",
        expect.stringMatching(/keine Zeitzone bekannt/)
      )
    );
    expect(cruiseApi.create).not.toHaveBeenCalled();
    expect(flightsApi.create).not.toHaveBeenCalled();
  });
});
