import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../../CompanionPicker", () => ({ default: () => null }));
// The geocoder field stands in as one button per station that "picks" a hit.
vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({
    label,
    onChange,
  }: {
    label: string;
    onChange: (s: { lat: number; lon: number; name?: string; countryCode?: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange(
          label === "rail:form.departureStation"
            ? { lat: 50.1071, lon: 8.6632, name: "Frankfurt (Main) Hbf", countryCode: "de" }
            : { lat: 48.8768, lon: 2.3591, name: "Paris Est", countryCode: "fr" }
        )
      }
    >
      pick {label}
    </button>
  ),
}));

const getAllTrips = vi.fn();
vi.mock("../../../lib/api", () => ({
  tripsApi: { getAll: (...a: unknown[]) => getAllTrips(...a) },
}));
const create = vi.fn();
const update = vi.fn();
const searchStations = vi.fn();
const lookup = vi.fn();
const lookupProviders = vi.fn();
vi.mock("../../../lib/api/rail", () => ({
  railApi: {
    create: (...a: unknown[]) => create(...a),
    update: (...a: unknown[]) => update(...a),
    searchStations: (...a: unknown[]) => searchStations(...a),
    lookup: (...a: unknown[]) => lookup(...a),
    lookupProviders: (...a: unknown[]) => lookupProviders(...a),
  },
}));

import { RailFormModal } from "../RailFormModal";
import { makeRailJourney } from "./railJourneyFixture";

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "rail:form.save" });
}

/** Both station fields switched from the catalogue to the geocoder, then picked. */
function pickBothViaGeocoder(): void {
  for (const b of screen.getAllByRole("button", { name: "rail:station.useGeocoder" })) {
    fireEvent.click(b);
  }
  fireEvent.click(screen.getByText("pick rail:form.departureStation"));
  fireEvent.click(screen.getByText("pick rail:form.arrivalStation"));
}

describe("RailFormModal", () => {
  beforeEach(() => {
    create.mockReset();
    update.mockReset();
    getAllTrips.mockReset();
    getAllTrips.mockResolvedValue([{ id: "t1", name: "Paris weekend" }]);
    searchStations.mockReset();
    lookup.mockReset();
    lookupProviders.mockReset();
    lookupProviders.mockResolvedValue({
      transitous: true,
      dbRest: true,
      transitousSourcesUrl: "https://transitous.org/sources/",
    });
  });

  it("will not save until both stations have a position and the train has a departure", async () => {
    render(<RailFormModal journey={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(getAllTrips).toHaveBeenCalled());
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText("rail:form.stationMissing")).toBeInTheDocument();

    pickBothViaGeocoder();
    expect(screen.queryByText("rail:form.stationMissing")).toBeNull();
    expect(saveButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("rail:form.departureTime"), {
      target: { value: "2026-07-01T08:15" },
    });
    expect(saveButton()).not.toBeDisabled();
  });

  it("sends the station's wall clock, the picked stations and the trip", async () => {
    const saved = { id: "new" };
    create.mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(<RailFormModal journey={null} onClose={vi.fn()} onSaved={onSaved} />);
    await screen.findByRole("option", { name: "Paris weekend" });

    pickBothViaGeocoder();
    fireEvent.change(screen.getByLabelText("rail:form.departureTime"), {
      target: { value: "2026-07-01T08:15" },
    });
    fireEvent.change(screen.getByLabelText("rail:form.category"), { target: { value: "ICE" } });
    fireEvent.change(screen.getByLabelText("rail:form.trip"), { target: { value: "t1" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        trainCategory: "ICE",
        departureLocal: "2026-07-01T08:15",
        arrivalLocal: null,
        departureStation: {
          stationId: null,
          code: null,
          name: "Frankfurt (Main) Hbf",
          lat: 50.1071,
          lon: 8.6632,
          country: "DE",
        },
        arrivalStation: {
          stationId: null,
          code: null,
          name: "Paris Est",
          lat: 48.8768,
          lon: 2.3591,
          country: "FR",
        },
        tripId: "t1",
        status: "scheduled",
        lookup: null,
      })
    );
  });

  // As for flights, cruises and stays: the one trip whose dates hold the
  // departure day is picked for a new ride, and a pick by hand ends that.
  it("files a new ride under the one trip its departure day falls in", async () => {
    getAllTrips.mockResolvedValue([
      { id: "t1", name: "Paris weekend", startDate: "2026-07-01", endDate: "2026-07-03" },
      { id: "t2", name: "Später", startDate: "2026-08-01", endDate: "2026-08-05" },
    ]);
    render(<RailFormModal journey={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByRole("option", { name: "Paris weekend" });
    const trip = screen.getByLabelText("rail:form.trip") as HTMLSelectElement;
    expect(trip.value).toBe("");

    fireEvent.change(screen.getByLabelText("rail:form.departureTime"), {
      target: { value: "2026-07-02T08:15" },
    });
    await waitFor(() => expect(trip.value).toBe("t1"));

    fireEvent.change(trip, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("rail:form.departureTime"), {
      target: { value: "2026-08-02T08:15" },
    });
    expect(trip.value).toBe("");
  });

  it("shows the server's refusal instead of closing", async () => {
    create.mockRejectedValue({
      response: { data: { error: "arrival must not precede departure" } },
    });
    const onSaved = vi.fn();
    render(<RailFormModal journey={null} onClose={vi.fn()} onSaved={onSaved} />);
    pickBothViaGeocoder();
    fireEvent.change(screen.getByLabelText("rail:form.departureTime"), {
      target: { value: "2026-07-01T08:15" },
    });
    fireEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "arrival must not precede departure"
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("sends a catalogue pick with its id and code, and a looked-up train with its match", async () => {
    searchStations.mockResolvedValue([
      {
        id: 7604,
        name: "Frankfurt (Main) Hbf",
        uic: "8011068",
        dbId: "8000105",
        lat: 50.107149,
        lon: 8.663785,
        country: "DE",
        timezone: "Europe/Berlin",
      },
    ]);
    lookup.mockResolvedValue({
      match: {
        provider: "transitous",
        ref: "trip-696",
        operator: "DB Fernverkehr AG",
        trainCategory: "ICE",
        trainNumber: "696",
        boardingIndex: 0,
        hasGeometry: true,
        stops: [
          {
            name: "Frankfurt (Main) Hauptbahnhof",
            lat: 50.107149,
            lon: 8.663785,
            stationId: 7604,
            code: "8011068",
            country: "DE",
            arrivalLocal: null,
            departureLocal: "2026-09-26T06:15",
          },
          {
            name: "Berlin Gesundbrunnen",
            lat: 52.5486,
            lon: 13.3884,
            stationId: 10112,
            code: "8011102",
            country: "DE",
            arrivalLocal: "2026-09-26T10:43",
            departureLocal: null,
          },
        ],
      },
      attempts: [{ provider: "transitous", outcome: "matched" }],
    });
    create.mockResolvedValue({ id: "new" });
    render(<RailFormModal journey={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    const [depSearch] = screen.getAllByRole("combobox");
    fireEvent.change(depSearch, { target: { value: "frankfurt hbf" } });
    fireEvent.click(await screen.findByRole("button", { name: /Frankfurt \(Main\) Hbf/ }));
    expect(screen.getByText("rail:station.picked")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("rail:form.number"), { target: { value: "ICE 696" } });
    fireEvent.change(screen.getByLabelText("rail:lookup.date"), {
      target: { value: "2026-09-26" },
    });
    fireEvent.click(screen.getByRole("button", { name: "rail:lookup.run" }));
    await waitFor(() =>
      expect(lookup).toHaveBeenCalledWith({
        trainNumber: "ICE 696",
        date: "2026-09-26",
        fromStationId: 7604,
      })
    );
    fireEvent.click(await screen.findByRole("button", { name: "rail:lookup.apply" }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({
      operator: "DB Fernverkehr AG",
      trainCategory: "ICE",
      trainNumber: "696",
      departureLocal: "2026-09-26T06:15",
      arrivalLocal: "2026-09-26T10:43",
      departureStation: { stationId: 7604, code: "8011068" },
      arrivalStation: { stationId: 10112, name: "Berlin Gesundbrunnen" },
      lookup: { provider: "transitous", ref: "trip-696" },
    });
  });

  it("saves a leg and moves on to its connection, bound to it on the next save", async () => {
    const first = makeRailJourney({ id: "leg-1", tripId: "t1" });
    const second = makeRailJourney({ id: "leg-2" });
    create.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const onProgress = vi.fn();
    const onSaved = vi.fn();
    render(
      <RailFormModal journey={null} onClose={vi.fn()} onSaved={onSaved} onProgress={onProgress} />
    );
    await screen.findByRole("option", { name: "Paris weekend" });
    pickBothViaGeocoder();
    fireEvent.change(screen.getByLabelText("rail:form.departureTime"), {
      target: { value: "2026-07-01T08:15" },
    });
    fireEvent.click(screen.getByTestId("rail-save-and-connect"));

    await waitFor(() => expect(onProgress).toHaveBeenCalledWith(first));
    expect(onSaved).not.toHaveBeenCalled();
    expect(create.mock.calls[0][0]).not.toHaveProperty("connectsFrom");
    // The dialog now holds the next leg, from the previous arrival.
    expect(await screen.findByTestId("rail-connection-banner")).toBeInTheDocument();
    expect(screen.getByLabelText("rail:form.departureTime")).toHaveValue("2026-09-26T07:10");

    for (const b of screen.getAllByRole("button", { name: "rail:station.useGeocoder" })) {
      fireEvent.click(b);
    }
    fireEvent.click(screen.getByText("pick rail:form.arrivalStation"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(second));
    expect(create.mock.calls[1][0]).toMatchObject({ connectsFrom: "leg-1", tripId: "t1" });
  });
});
