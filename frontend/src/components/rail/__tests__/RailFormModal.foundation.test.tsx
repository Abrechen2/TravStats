import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * The rail form on the shared form blocks (forgejo#245–#249): required marks,
 * a visible reason for the greyed-out save, refusals at their field or in a
 * banner that stays, one request per save, and a question before a changed
 * form is thrown away.
 */
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../../CompanionPicker", () => ({ default: () => null }));
// The geocoder field stands in as a pick button, a "refused longitude"
// button, and the two coordinate inputs a hint item can focus.
vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({
    label,
    idPrefix,
    onChange,
    onValidityChange,
  }: {
    label: string;
    idPrefix: string;
    onChange: (s: { lat: number; lon: number; name?: string; countryCode?: string }) => void;
    onValidityChange?: (valid: boolean, field?: "lat" | "lon") => void;
  }) => (
    <div>
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
      <button type="button" onClick={() => onValidityChange?.(false, "lon")}>
        bad lon {label}
      </button>
      <input id={`${idPrefix}-lat`} aria-label={`lat ${label}`} />
      <input id={`${idPrefix}-lon`} aria-label={`lon ${label}`} />
    </div>
  ),
}));

// The chips re-query on a real 500 ms debounce after a station changes. Once a
// loaded runner stretched a test past those 500 ms, the re-query's answer set
// state in the middle of it, outside act(...) (CI, 2026-10-09: "An update to
// RailFormModal"). The chips have their own file; here they stay empty and
// nothing is left in flight.
vi.mock("../../../hooks/useRailEntrySuggestions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../hooks/useRailEntrySuggestions")>();
  return {
    ...actual,
    useRailEntrySuggestions: () => ({ suggestions: actual.NO_RAIL_SUGGESTIONS, failed: false }),
  };
});

const getAllTrips = vi.fn();
vi.mock("../../../lib/api", () => ({
  tripsApi: { getAll: (...a: unknown[]) => getAllTrips(...a) },
}));
const create = vi.fn();
const update = vi.fn();
vi.mock("../../../lib/api/rail", () => ({
  railApi: {
    entrySuggestions: () =>
      Promise.resolve({ trains: [], operators: [], travelClass: null, coaches: [], seats: [] }),
    create: (...a: unknown[]) => create(...a),
    update: (...a: unknown[]) => update(...a),
    searchStations: () => Promise.resolve([]),
    lookup: vi.fn(),
    lookupProviders: () =>
      Promise.resolve({ transitous: true, dbRest: true, transitousSourcesUrl: "https://x" }),
  },
}));

import { RailFormModal } from "../RailFormModal";
import { connectionDraftFrom } from "../railFormModel";
import { makeRailJourney } from "./railJourneyFixture";
import { allNamed, getNamed, queryNamed } from "../../../__tests__/helpers/namedElement";

const DEPARTURE_TIME = /^rail:form\.departureTime\s*\*?$/;
const NETWORK = { isAxiosError: true, message: "Network Error" };
// A refusal the server answered (nothing stored), so a create may retry.
const DB_DOWN = { isAxiosError: true, response: { status: 503, data: { code: "DB_UNAVAILABLE" } } };

const saveButton = (): HTMLElement => getNamed("button", "rail:form.save");

function pickBothViaGeocoder(): void {
  for (const b of allNamed("button", "rail:station.useGeocoder")) {
    fireEvent.click(b);
  }
  fireEvent.click(screen.getByText("pick rail:form.departureStation"));
  fireEvent.click(screen.getByText("pick rail:form.arrivalStation"));
}

/** A new ride with both stations and a departure — ready to save. */
async function readyForm(onSaved = vi.fn()): Promise<{ onSaved: typeof onSaved }> {
  render(<RailFormModal journey={null} onClose={vi.fn()} onSaved={onSaved} />);
  await waitFor(() => expect(getAllTrips).toHaveBeenCalled());
  pickBothViaGeocoder();
  fireEvent.change(screen.getByLabelText(DEPARTURE_TIME), {
    target: { value: "2026-07-01T08:15" },
  });
  return { onSaved };
}

describe("RailFormModal — shared form blocks", () => {
  beforeEach(() => {
    create.mockReset();
    update.mockReset();
    getAllTrips.mockReset().mockResolvedValue([]);
  });

  it("marks both stations and the departure as required, and explains the mark", async () => {
    render(<RailFormModal journey={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(getAllTrips).toHaveBeenCalled());
    expect(document.getElementById("rail-dep-search")).toHaveAttribute("aria-required", "true");
    expect(document.getElementById("rail-arr-search")).toHaveAttribute("aria-required", "true");
    expect(screen.getByLabelText(DEPARTURE_TIME)).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("common:form.requiredLegend")).toBeInTheDocument();
  });

  it("says beside the greyed-out save what is missing, and the list shrinks as it is filled", async () => {
    render(<RailFormModal journey={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(getAllTrips).toHaveBeenCalled());
    const hint = screen.getByTestId("save-blocked-hint");
    expect(hint).toHaveTextContent("rail:form.departureStation");
    expect(hint).toHaveTextContent("rail:form.arrivalStation");
    expect(hint).toHaveTextContent("rail:form.missing.departureTime");
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAccessibleDescription(/common:form\.saveBlocked/);
    expect(screen.getByTestId("rail-save-and-connect")).toHaveAccessibleDescription(
      /rail:form\.missing\.departureTime/
    );

    pickBothViaGeocoder();
    expect(screen.getByTestId("save-blocked-hint")).not.toHaveTextContent(
      "rail:form.departureStation"
    );
    // The item takes the user to the field.
    fireEvent.click(getNamed("button", "rail:form.missing.departureTime"));
    expect(screen.getByLabelText(DEPARTURE_TIME)).toHaveFocus();

    fireEvent.change(screen.getByLabelText(DEPARTURE_TIME), {
      target: { value: "2026-07-01T08:15" },
    });
    expect(screen.queryByTestId("save-blocked-hint")).toBeNull();
    expect(saveButton()).not.toBeDisabled();
  });

  it("keeps the draft after a database restart, says so in a banner that takes focus, and retries", async () => {
    create.mockRejectedValueOnce(DB_DOWN);
    create.mockResolvedValueOnce({ journey: makeRailJourney({ id: "new" }), geometry: null });
    const { onSaved } = await readyForm();
    fireEvent.click(saveButton());

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("common:saveErrors.dbUnavailable");
    await waitFor(() => expect(banner).toHaveFocus());
    expect(screen.getByLabelText(DEPARTURE_TIME)).toHaveValue("2026-07-01T08:15");

    fireEvent.click(within(banner).getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(2);
  });

  // Bus review, Minor 2 (integration wiring): the ride may be stored.
  it("offers no retry after a create whose answer was lost, and offers a reload instead", async () => {
    create.mockRejectedValueOnce(NETWORK);
    const onReload = vi.fn();
    render(
      <RailFormModal journey={null} onClose={vi.fn()} onSaved={vi.fn()} onReload={onReload} />
    );
    await waitFor(() => expect(getAllTrips).toHaveBeenCalled());
    pickBothViaGeocoder();
    fireEvent.change(screen.getByLabelText(DEPARTURE_TIME), {
      target: { value: "2026-07-01T08:15" },
    });
    fireEvent.click(saveButton());

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("common:saveErrors.outcomeUnknown");
    expect(within(banner).queryByRole("button", { name: "common:buttons.retry" })).toBeNull();
    fireEvent.click(within(banner).getByRole("button", { name: "common:buttons.reloadList" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("clears the banner with the next edit, and offers no retry for a refused input", async () => {
    create.mockRejectedValue({ response: { status: 400, data: { code: "RAIL_INVALID_INPUT" } } });
    await readyForm();
    fireEvent.click(saveButton());
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("rail:form.errors.invalid");
    expect(within(banner).queryByRole("button")).toBeNull();

    fireEvent.change(screen.getByLabelText("rail:form.seatNumber"), { target: { value: "4" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("focuses a refused time at its field", async () => {
    create.mockRejectedValue({
      response: { data: { code: "RAIL_ARRIVAL_BEFORE_DEPARTURE", field: "arrivalLocal" } },
    });
    await readyForm();
    fireEvent.click(saveButton());
    const arrival = screen.getByLabelText("rail:form.arrivalTime");
    await waitFor(() => expect(arrival).toHaveFocus());
    expect(arrival).toHaveAccessibleDescription("rail:form.errors.arrivalBeforeDeparture");
  });

  it("sends one request for a double click", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    create.mockReturnValue(new Promise((r) => (resolve = r)));
    const { onSaved } = await readyForm();
    const save = saveButton();
    fireEvent.click(save);
    fireEvent.click(save);
    await act(async () => {
      resolve({ journey: makeRailJourney({ id: "new" }), geometry: null });
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("says a stored ride whose list did not reload is saved, and cannot create it twice", async () => {
    create.mockResolvedValue({ journey: makeRailJourney({ id: "new" }), geometry: null });
    const onSaved = vi.fn().mockRejectedValue(new Error("list down"));
    await readyForm(onSaved);
    fireEvent.click(saveButton());
    expect(await screen.findByText("common:form.savedButRefreshFailed")).toBeInTheDocument();
    expect(queryNamed("button", "rail:form.save")).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("asks before Escape drops a changed form, and closes an untouched one at once", async () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <RailFormModal journey={makeRailJourney()} onClose={onClose} onSaved={vi.fn()} />
    );
    await waitFor(() => expect(getAllTrips).toHaveBeenCalled());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    onClose.mockReset();
    render(<RailFormModal journey={makeRailJourney()} onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("rail:form.seatNumber"), { target: { value: "42" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(await screen.findByText("common:discard.title")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(getNamed("button", "common:discard.confirm"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before Cancel drops a changed form", async () => {
    const onClose = vi.fn();
    render(<RailFormModal journey={makeRailJourney()} onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("rail:form.operator"), { target: { value: "ÖBB" } });
    fireEvent.click(getNamed("button", "rail:form.cancel"));
    expect(await screen.findByText("common:discard.title")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  // The connection draft opens with a departure day; the trip the form then
  // preselects for it is the form's own doing, not a change to ask about.
  it("does not count a trip it preselected itself as a change", async () => {
    getAllTrips.mockResolvedValue([
      { id: "t1", name: "Rhön", startDate: "2026-09-25", endDate: "2026-09-27" },
    ]);
    const onClose = vi.fn();
    render(
      <RailFormModal
        journey={null}
        initialDraft={connectionDraftFrom(makeRailJourney())}
        connectsFrom="j1"
        onClose={onClose}
        onSaved={vi.fn()}
      />
    );
    const trip = (await screen.findByLabelText("rail:form.trip")) as HTMLSelectElement;
    await waitFor(() => expect(trip.value).toBe("t1"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("gives every text field a label that stays visible once typed into", async () => {
    render(<RailFormModal journey={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(getAllTrips).toHaveBeenCalled());
    for (const name of [
      "rail:form.operator",
      "rail:form.category",
      "rail:form.number",
      "rail:form.coach",
      "rail:form.seatNumber",
      "rail:form.bookingReference",
      "rail:form.price",
      "rail:form.notes",
    ]) {
      const field = screen.getByLabelText(name);
      // Named by a visible <label>, not by an aria-label or a placeholder.
      expect(field).not.toHaveAttribute("aria-label");
      expect(field.closest("label")).not.toBeNull();
    }
  });

  // Review minor 5: a refusal naming a plain field is said AT that field.
  it("shows a refused coach at the coach field and takes the user there", async () => {
    create.mockRejectedValue({
      response: { status: 400, data: { code: "RAIL_INVALID_INPUT", field: "coach" } },
    });
    await readyForm();
    fireEvent.click(saveButton());
    const coach = screen.getByLabelText("rail:form.coach");
    await waitFor(() => expect(coach).toHaveFocus());
    expect(coach).toHaveAttribute("aria-invalid", "true");
    expect(coach).toHaveAccessibleDescription("rail:form.errors.invalidField");
    expect(document.querySelector("[data-form-error-banner]")).toBeNull();
  });

  // Review minor 6: a map pick can leave the station's name empty; the hint
  // then names the name and takes the user to that field, not to the search.
  it("names a missing station name and takes the user to the name field", async () => {
    await readyForm();
    const name = document.getElementById("rail-dep-name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "" } });
    const item = getNamed("button", "rail:form.missing.depName");
    fireEvent.click(item);
    expect(name).toHaveFocus();
    expect(screen.getByTestId("save-blocked-hint")).not.toHaveTextContent(
      "rail:form.departureStation"
    );
  });

  it("takes the user to the coordinate that was refused", async () => {
    await readyForm();
    fireEvent.click(screen.getByText("bad lon rail:form.departureStation"));
    fireEvent.click(getNamed("button", "rail:form.missing.depCoordinates"));
    expect(document.getElementById("rail-dep-lon")).toHaveFocus();
  });

  // Review minor 7: "save and add a connection" whose list reload fails
  // still opens the next leg, and says the list is stale.
  it("moves on to the next leg when the list behind it did not reload, and says so", async () => {
    create.mockResolvedValue({ journey: makeRailJourney({ id: "leg1" }), geometry: null });
    const onProgress = vi.fn().mockRejectedValue(new Error("list down"));
    render(
      <RailFormModal journey={null} onClose={vi.fn()} onSaved={vi.fn()} onProgress={onProgress} />
    );
    await waitFor(() => expect(getAllTrips).toHaveBeenCalled());
    pickBothViaGeocoder();
    fireEvent.change(screen.getByLabelText(DEPARTURE_TIME), {
      target: { value: "2026-07-01T08:15" },
    });
    fireEvent.click(screen.getByTestId("rail-save-and-connect"));
    expect(await screen.findByTestId("rail-connection-banner")).toBeInTheDocument();
    expect(screen.getByText("common:form.savedButRefreshFailed")).toBeInTheDocument();
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("repeats 'save and add a connection' when its retry is pressed", async () => {
    create.mockRejectedValueOnce(DB_DOWN);
    create.mockResolvedValueOnce({ journey: makeRailJourney({ id: "leg1" }), geometry: null });
    const onSaved = vi.fn();
    render(<RailFormModal journey={null} onClose={vi.fn()} onSaved={onSaved} />);
    await waitFor(() => expect(getAllTrips).toHaveBeenCalled());
    pickBothViaGeocoder();
    fireEvent.change(screen.getByLabelText(DEPARTURE_TIME), {
      target: { value: "2026-07-01T08:15" },
    });
    fireEvent.click(screen.getByTestId("rail-save-and-connect"));
    const banner = await screen.findByRole("alert");
    fireEvent.click(within(banner).getByRole("button", { name: "common:buttons.retry" }));
    expect(await screen.findByTestId("rail-connection-banner")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
  });
});
