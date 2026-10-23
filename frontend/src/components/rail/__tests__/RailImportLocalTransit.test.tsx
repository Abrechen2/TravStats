import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o?.name ? `${k}:${String(o.name)}` : o?.count !== undefined ? `${k}/${String(o.count)}` : k,
    i18n: { language: "de" },
    ready: true,
  }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../StationPicker", () => ({
  StationPicker: ({ label }: { label: string }) => <button type="button">pick {label}</button>,
}));
const create = vi.fn();
vi.mock("../../../lib/api/rail", () => ({
  railApi: { create: (...a: unknown[]) => create(...a) },
}));
const createBus = vi.fn();
vi.mock("../../../lib/api/bus", () => ({
  busApi: { create: (...a: unknown[]) => createBus(...a) },
}));
const enabledDomains = vi.hoisted(() => ({ value: ["flight", "rail", "bus"] }));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: enabledDomains.value,
    isEnabled: (key: string) => enabledDomains.value.includes(key),
  }),
}));
const updateSettings = vi.fn();
vi.mock("../../../lib/api", () => ({
  settingsApi: { update: (...a: unknown[]) => updateSettings(...a) },
}));

import { RailImportPreviewModal } from "../RailImportPreviewModal";
import { useSuggestionSwitchesStore } from "../../../store/suggestionSwitchesStore";
import type { RailImportBooking, RailImportStation } from "../../../types/rail";
import { booking, leg, station } from "./railImportFixture";

/** A stop the catalogue lacks, placed by bahn.de itself. */
const fromBahn = (name: string, lat: number): RailImportStation => ({
  ...station(name, false),
  lat,
  lon: 11.57,
  country: "DE",
  timezone: "Europe/Berlin",
  code: "8000999",
  positionSource: "provider",
});

/** Augsburg → München Hbf by train, U-Bahn to Odeonsplatz, bus 100, then the S-Bahn on. */
function connection(): RailImportBooking {
  return booking({
    source: "db-share-link",
    bookingReference: null,
    price: null,
    tariff: null,
    legs: [
      leg({ trainCategory: null, trainNumber: "57031", transit: { mode: "rail", busKind: null } }),
      leg({
        depStationName: "München Hbf",
        arrStationName: "Odeonsplatz",
        departureLocal: "2026-03-14T09:30",
        arrivalLocal: "2026-03-14T09:36",
        trainCategory: "U",
        trainNumber: "4",
        departureStation: station("München Hbf", true, 2),
        arrivalStation: fromBahn("Odeonsplatz", 48.1425),
        transit: { mode: "metro", busKind: null },
      }),
      leg({
        depStationName: "Odeonsplatz",
        arrStationName: "Chinesischer Turm",
        departureLocal: "2026-03-14T09:40",
        arrivalLocal: "2026-03-14T09:50",
        trainCategory: "Bus",
        trainNumber: "100",
        departureStation: fromBahn("Odeonsplatz", 48.1425),
        arrivalStation: fromBahn("Chinesischer Turm", 48.152),
        transit: { mode: "bus", busKind: "city" },
      }),
      leg({
        depStationName: "Hamburg Hbf",
        arrStationName: "Bremen Hbf",
        departureLocal: "2026-03-14T10:46",
        arrivalLocal: "2026-03-14T11:43",
        trainCategory: "S",
        trainNumber: "1",
        departureStation: station("Hamburg Hbf", true, 2),
        arrivalStation: station("Bremen Hbf", true, 3),
        transit: { mode: "rail", busKind: null },
      }),
    ],
  });
}

const saveButton = (): HTMLElement => screen.getByRole("button", { name: /rail:import.save/ });
const box = (index: number): HTMLInputElement =>
  within(screen.getByTestId(`rail-import-leg-${index}`)).getByRole("checkbox");

describe("RailImportPreviewModal — U-Bahn, tram and bus legs of a bahn.de connection", () => {
  beforeEach(() => {
    create.mockReset();
    createBus.mockReset();
    updateSettings.mockReset().mockResolvedValue({});
    enabledDomains.value = ["flight", "rail", "bus"];
    useSuggestionSwitchesStore.setState({ railImportLocalTransit: "skip", railImportBus: "skip" });
  });

  it("shows every leg with its mode; trains ticked, U-Bahn and bus not", () => {
    render(<RailImportPreviewModal booking={connection()} onCancel={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByTestId("rail-import-mode-0")).toHaveTextContent("rail:import.mode.rail");
    expect(screen.getByTestId("rail-import-mode-1")).toHaveTextContent("rail:import.mode.metro");
    expect(screen.getByTestId("rail-import-mode-2")).toHaveTextContent("rail:import.mode.bus.city");
    expect([0, 1, 2, 3].map((i) => box(i).checked)).toEqual([true, false, false, true]);
    expect(saveButton()).toHaveTextContent("rail:import.save/2");
  });

  it("says a stop's position is bahn.de's own, and lets the leg be saved with it", () => {
    render(<RailImportPreviewModal booking={connection()} onCancel={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getAllByTestId("rail-import-bahn-position-1")[0]).toHaveTextContent(
      "rail:import.positionFromBahn:Odeonsplatz"
    );
    fireEvent.click(box(1));
    expect(within(screen.getByTestId("rail-import-leg-1")).queryByText(/pick/)).toBeNull();
    expect(saveButton()).toBeEnabled();
  });

  it("saves without the skipped legs, and joins no leg across the gap", async () => {
    create
      .mockResolvedValueOnce({ journey: { id: "rb" }, geometry: null })
      .mockResolvedValueOnce({ journey: { id: "s1" }, geometry: null });
    const onSaved = vi.fn();
    render(<RailImportPreviewModal booking={connection()} onCancel={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(2));
    expect(create.mock.calls.map((c) => c[0].trainNumber)).toEqual(["57031", "1"]);
    expect(create.mock.calls[1][0]).not.toHaveProperty("connectsFrom");
    expect(createBus).not.toHaveBeenCalled();
  });

  it("saves a ticked U-Bahn leg as a metro journey and a ticked bus leg as a bus ride, in order", async () => {
    create
      .mockResolvedValueOnce({ journey: { id: "rb" }, geometry: null })
      .mockResolvedValueOnce({ journey: { id: "u4" }, geometry: null })
      .mockResolvedValueOnce({ journey: { id: "s1" }, geometry: null });
    createBus.mockResolvedValueOnce({ id: "bus-100" });
    const onSaved = vi.fn();
    render(<RailImportPreviewModal booking={connection()} onCancel={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(box(1));
    fireEvent.click(box(2));
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(4));
    expect(create.mock.calls[0][0]).toMatchObject({ transitMode: "rail" });
    expect(create.mock.calls[1][0]).toMatchObject({
      transitMode: "metro",
      trainCategory: "U",
      connectsFrom: "rb",
      arrivalStation: { name: "Odeonsplatz", stationId: null, lat: 48.1425 },
    });
    expect(createBus.mock.calls[0][0]).toMatchObject({
      lineName: "Bus 100",
      rideKind: "other",
      operator: null,
      departureLocal: "2026-03-14T09:40",
      departureStation: { name: "Odeonsplatz", lat: 48.1425, lon: 11.57, country: "DE" },
      arrivalStation: { name: "Chinesischer Turm", lat: 48.152 },
    });
    // The bus ride ends the rail chain: the S-Bahn starts a booking of its own.
    expect(create.mock.calls[2][0]).not.toHaveProperty("connectsFrom");
    expect(screen.getByText("rail:import.legSavedAsBus")).toBeInTheDocument();
  });

  it("never turns a bus into a train when the account has no bus domain, and says so", () => {
    enabledDomains.value = ["flight", "rail"];
    render(<RailImportPreviewModal booking={connection()} onCancel={vi.fn()} onSaved={vi.fn()} />);
    expect(box(2)).toBeDisabled();
    expect(box(2).checked).toBe(false);
    expect(screen.getByText("rail:import.mode.busDisabled")).toBeInTheDocument();
    expect(screen.queryByTestId("rail-import-remember-bus")).toBeNull();
  });

  it("starts as the account remembered", () => {
    useSuggestionSwitchesStore.setState({ railImportLocalTransit: "rail", railImportBus: "bus" });
    render(<RailImportPreviewModal booking={connection()} onCancel={vi.fn()} onSaved={vi.fn()} />);
    expect([0, 1, 2, 3].map((i) => box(i).checked)).toEqual([true, true, true, true]);
  });

  it("remembers a default only on the explicit click", async () => {
    render(<RailImportPreviewModal booking={connection()} onCancel={vi.fn()} onSaved={vi.fn()} />);
    const remember = screen.getByTestId("rail-import-remember-localTransit");
    // Nothing chosen differs from the stored default yet: nothing to remember.
    expect(remember).toBeDisabled();
    fireEvent.click(box(1));
    expect(updateSettings).not.toHaveBeenCalled();
    expect(remember).toHaveTextContent("rail:import.remember.localTransit.rail");
    fireEvent.click(remember);
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ railImport: { localTransit: "rail" } })
    );
    expect(useSuggestionSwitchesStore.getState().railImportLocalTransit).toBe("rail");
    expect(screen.getByText("rail:import.remember.done")).toBeInTheDocument();
  });

  it("leaves a document's legs — which carry no mode — exactly as before", () => {
    render(<RailImportPreviewModal booking={booking()} onCancel={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByTestId("rail-import-mode-0")).toBeNull();
    expect(screen.queryByTestId("rail-import-remember")).toBeNull();
    expect([0, 1].map((i) => box(i).checked)).toEqual([true, true]);
  });
});
