import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o?.station ? `${k}:${String(o.station)}` : o?.value ? `${k}:${String(o.value)}` : k,
    i18n: { language: "de" },
    ready: true,
  }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../../CompanionPicker", () => ({ default: () => null }));
// No debounce in a test: the value is the value.
vi.mock("../../../hooks/useDebouncedValue", () => ({ useDebouncedValue: <T,>(v: T) => v }));

const getAllTrips = vi.fn();
vi.mock("../../../lib/api", () => ({
  tripsApi: { getAll: (...a: unknown[]) => getAllTrips(...a) },
}));
const create = vi.fn();
const searchStations = vi.fn();
const lookup = vi.fn();
const lookupProviders = vi.fn();
const entrySuggestions = vi.fn();
vi.mock("../../../lib/api/rail", () => ({
  railApi: {
    create: (...a: unknown[]) => create(...a),
    update: vi.fn(),
    searchStations: (...a: unknown[]) => searchStations(...a),
    lookup: (...a: unknown[]) => lookup(...a),
    lookupProviders: (...a: unknown[]) => lookupProviders(...a),
    entrySuggestions: (...a: unknown[]) => entrySuggestions(...a),
  },
}));

import { RailFormModal } from "../RailFormModal";
import { makeRailJourney } from "./railJourneyFixture";
import { getNamed, queryNamed } from "../../../__tests__/helpers/namedElement";

const SUGGESTIONS = {
  trains: [
    { category: "ICE", number: "578" },
    { category: "RE", number: "4" },
  ],
  operators: ["DB Fernverkehr"],
  travelClass: "second",
  coaches: ["12"],
  seats: ["45", "46"],
};

describe("RailFormModal — chips from the user's own rides", () => {
  beforeEach(() => {
    create.mockReset();
    getAllTrips.mockReset();
    getAllTrips.mockResolvedValue([]);
    searchStations.mockReset();
    lookup.mockReset();
    lookupProviders.mockReset();
    lookupProviders.mockResolvedValue({
      transitous: false,
      dbRest: false,
      transitousSourcesUrl: "",
    });
    entrySuggestions.mockReset();
  });

  it("offers trains, operators, class, coach and seat, and fills a field only on a click", async () => {
    entrySuggestions.mockResolvedValue(SUGGESTIONS);
    render(<RailFormModal journey={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByText("rail:lookup.switchedOff");

    const train = await screen.findByText("ICE 578");
    // Offered, not written: nothing is in the fields yet.
    expect(screen.getByLabelText("rail:form.number")).toHaveValue("");
    expect(screen.getByLabelText("rail:form.class")).toHaveValue("");

    fireEvent.click(train);
    expect(screen.getByLabelText("rail:form.category")).toHaveValue("ICE");
    expect(screen.getByLabelText("rail:form.number")).toHaveValue("578");
    // The chip that would change nothing disappears.
    expect(screen.queryByText("ICE 578")).toBeNull();

    fireEvent.click(screen.getByText("DB Fernverkehr"));
    expect(screen.getByLabelText("rail:form.operator")).toHaveValue("DB Fernverkehr");
    fireEvent.click(getNamed("button", "common:suggestionChip:rail:class.second"));
    expect(screen.getByLabelText("rail:form.class")).toHaveValue("second");
    fireEvent.click(screen.getByText("12"));
    expect(screen.getByLabelText("rail:form.coach")).toHaveValue("12");
    fireEvent.click(screen.getByText("46"));
    expect(screen.getByLabelText("rail:form.seatNumber")).toHaveValue("46");
    // Picking the operator asked again (the operator scopes the trains); let
    // that answer land before the test ends.
    await waitFor(() =>
      expect(entrySuggestions).toHaveBeenLastCalledWith({ operator: "DB Fernverkehr" })
    );
    await act(async () => {});
  });

  it("never overwrites a typed value: a class the user chose hides the class chip", async () => {
    entrySuggestions.mockResolvedValue(SUGGESTIONS);
    render(<RailFormModal journey={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByText("rail:lookup.switchedOff");
    await screen.findByText("ICE 578");

    fireEvent.change(screen.getByLabelText("rail:form.class"), { target: { value: "first" } });
    expect(queryNamed("button", "common:suggestionChip:rail:class.second")).toBeNull();
    expect(screen.getByLabelText("rail:form.class")).toHaveValue("first");

    // A typed seat narrows the chips to those that continue it; none replaces it.
    fireEvent.change(screen.getByLabelText("rail:form.seatNumber"), { target: { value: "4" } });
    expect(screen.getByLabelText("rail:form.seatNumber")).toHaveValue("4");
    expect(screen.getByText("45")).toBeInTheDocument();
  });

  it("asks for the station pair once both stations are known", async () => {
    entrySuggestions.mockResolvedValue(SUGGESTIONS);
    render(
      <RailFormModal
        journey={makeRailJourney({ depStationId: 11, arrStationId: 22 })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(entrySuggestions).toHaveBeenCalledWith(
        expect.objectContaining({
          depStationId: 11,
          arrStationId: 22,
          depName: "Frankfurt",
          arrName: "Fulda",
        })
      )
    );
  });

  it("says so when the suggestions could not be loaded, and the form still works", async () => {
    entrySuggestions.mockRejectedValue(new Error("503"));
    render(<RailFormModal journey={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(await screen.findByTestId("rail-suggestions-failed")).toHaveTextContent(
      "rail:form.suggestionsFailed"
    );
    fireEvent.change(screen.getByLabelText("rail:form.number"), { target: { value: "578" } });
    expect(screen.getByLabelText("rail:form.number")).toHaveValue("578");
  });

  it("offers the onward ride when the looked-up train does not reach the chosen arrival", async () => {
    entrySuggestions.mockResolvedValue({ ...SUGGESTIONS, trains: [] });
    lookupProviders.mockResolvedValue({
      transitous: true,
      dbRest: false,
      transitousSourcesUrl: "https://transitous.org/sources/",
    });
    // The user already knows where they are going: Fulda → Hamburg Hbf.
    const known = makeRailJourney({
      id: "draft-src",
      depStationName: "Fulda",
      depStationId: 3,
      depLat: 50.55,
      depLon: 9.68,
      arrStationName: "Hamburg Hbf",
      arrStationId: 4,
      arrLat: 53.55,
      arrLon: 10.0,
      trainNumber: "578",
    });
    lookup.mockResolvedValue({
      match: {
        provider: "transitous",
        ref: "trip-578",
        operator: "DB Fernverkehr AG",
        trainCategory: "ICE",
        trainNumber: "578",
        boardingIndex: 0,
        hasGeometry: false,
        stops: [
          {
            name: "Fulda",
            lat: 50.55,
            lon: 9.68,
            stationId: 3,
            code: null,
            country: "DE",
            arrivalLocal: null,
            departureLocal: "2026-09-26T07:10",
          },
          {
            name: "Hannover Hbf",
            lat: 52.38,
            lon: 9.74,
            stationId: 5,
            code: null,
            country: "DE",
            arrivalLocal: "2026-09-26T08:40",
            departureLocal: null,
          },
        ],
      },
      attempts: [{ provider: "transitous", outcome: "matched" }],
    });
    const saved = makeRailJourney({
      id: "leg-1",
      arrStationName: "Hannover Hbf",
      arrLat: 52.38,
      arrLon: 9.74,
      arrStationId: 5,
      arrivalTime: "2026-09-26T06:40:00.000Z",
    });
    create.mockResolvedValue({ journey: saved, geometry: null });
    const onProgress = vi.fn();

    // Opened as a NEW ride prefilled from the known one (the connection path
    // hands the form a draft the same way).
    const { draftFrom } = await import("../railFormModel");
    render(
      <RailFormModal
        journey={null}
        initialDraft={{ ...draftFrom(known), departureLocal: "2026-09-26T07:10" }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onProgress={onProgress}
      />
    );

    fireEvent.change(await screen.findByLabelText("rail:lookup.date"), {
      target: { value: "2026-09-26" },
    });
    fireEvent.click(getNamed("button", "rail:lookup.run"));
    expect(await screen.findByTestId("rail-lookup-change")).toBeInTheDocument();
    fireEvent.click(getNamed("button", "rail:lookup.applyWithChange"));

    // The first leg ends at the change; the banner names where the ride goes on.
    expect(screen.getByTestId("rail-onward-banner")).toHaveTextContent("Hamburg Hbf");
    fireEvent.click(getNamed("button", "rail:connection.saveAndContinue:Hamburg Hbf"));

    await waitFor(() => expect(onProgress).toHaveBeenCalledWith(saved));
    expect(create.mock.calls[0][0]).toMatchObject({
      arrivalStation: { name: "Hannover Hbf", stationId: 5 },
    });
    // The next leg: from the change, to the destination the user had chosen.
    expect(await screen.findByTestId("rail-connection-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("rail-onward-banner")).toBeNull();
    expect(screen.getByDisplayValue("Hamburg Hbf")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Hannover Hbf")).toBeInTheDocument();
  });
});
