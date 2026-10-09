import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * The bus form on the shared form blocks (forgejo#245–#249): required marks,
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
vi.mock("../../../hooks/useDebouncedValue", () => ({ useDebouncedValue: <T,>(v: T) => v }));
// The geocoder field stands in as: a search box carrying what the form asked
// of it (`required`), a pick button, a pick that brings no name (a map click),
// a "refused longitude" button, and the two coordinate inputs a hint item can
// focus.
vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({
    label,
    idPrefix,
    required,
    onChange,
    onValidityChange,
  }: {
    label: string;
    idPrefix: string;
    required?: boolean;
    onChange: (s: { lat: number; lon: number; name?: string; countryCode?: string }) => void;
    onValidityChange?: (valid: boolean, field?: "lat" | "lon") => void;
  }) => (
    <div>
      <input
        id={`${idPrefix}-search`}
        aria-label={`search ${label}`}
        aria-required={required || undefined}
      />
      <button
        type="button"
        onClick={() =>
          onChange(
            label === "bus:form.departureStation"
              ? { lat: 37.5048, lon: 127.0046, name: "Seoul Express", countryCode: "kr" }
              : { lat: 38.1911, lon: 128.5918, name: "Sokcho Express", countryCode: "kr" }
          )
        }
      >
        pick {label}
      </button>
      <button type="button" onClick={() => onChange({ lat: 35.1, lon: 129.0 })}>
        pick bare {label}
      </button>
      <button type="button" onClick={() => onValidityChange?.(false, "lon")}>
        bad lon {label}
      </button>
      <input id={`${idPrefix}-lat`} aria-label={`lat ${label}`} />
      <input id={`${idPrefix}-lon`} aria-label={`lon ${label}`} />
    </div>
  ),
}));

const getAllTrips = vi.fn();
vi.mock("../../../lib/api", () => ({
  tripsApi: { getAll: (...a: unknown[]) => getAllTrips(...a) },
}));
const create = vi.fn();
const update = vi.fn();
vi.mock("../../../lib/api/bus", () => ({
  busApi: {
    create: (...a: unknown[]) => create(...a),
    update: (...a: unknown[]) => update(...a),
    entrySuggestions: () => Promise.resolve({ operators: [], fareClasses: [], terminals: [] }),
  },
}));

import { BusFormModal } from "../BusFormModal";
import type { BusJourney } from "../../../types/bus";
import { rideFixture } from "./busFixture";

const DEPARTURE_TIME = /^bus:form\.departureTime\s*\*?$/;
const NETWORK = { isAxiosError: true, message: "Network Error" };
// A refusal the server answered (nothing stored), so a create may retry.
const DB_DOWN = { isAxiosError: true, response: { status: 503, data: { code: "DB_UNAVAILABLE" } } };

const saveButton = (): HTMLElement => screen.getByTestId("bus-form-save");
/** Lets the mount-time lookups (trips, suggestions) land inside `act`. */
const settle = (): Promise<void> => act(async () => {});

async function renderForm(
  props: Partial<{
    journey: BusJourney | null;
    onClose: () => void;
    onSaved: (ride: BusJourney) => void | Promise<void>;
    afterSaveFailedKey: string;
    onReload: () => void;
  }> = {}
): Promise<void> {
  await act(async () => {
    render(
      <BusFormModal
        journey={props.journey ?? null}
        onClose={props.onClose ?? vi.fn()}
        onSaved={props.onSaved ?? vi.fn()}
        afterSaveFailedKey={props.afterSaveFailedKey}
        onReload={props.onReload}
      />
    );
  });
}

function pickBoth(): void {
  fireEvent.click(screen.getByText("pick bus:form.departureStation"));
  fireEvent.click(screen.getByText("pick bus:form.arrivalStation"));
}

/** A new ride with both terminals and a departure — ready to save. */
async function readyForm(props: Parameters<typeof renderForm>[0] = {}): Promise<void> {
  await renderForm(props);
  pickBoth();
  fireEvent.change(screen.getByLabelText(DEPARTURE_TIME), {
    target: { value: "2026-09-20T09:00" },
  });
  await settle();
}

describe("BusFormModal — shared form blocks", () => {
  beforeEach(() => {
    create.mockReset();
    update.mockReset();
    getAllTrips.mockReset().mockResolvedValue([]);
  });

  it("marks both terminals, their names and the departure as required, and explains the mark", async () => {
    await renderForm();
    for (const id of ["bus-dep-search", "bus-arr-search", "bus-dep-name", "bus-arr-name"]) {
      expect(document.getElementById(id)).toHaveAttribute("aria-required", "true");
    }
    expect(screen.getByLabelText(DEPARTURE_TIME)).toHaveAttribute("aria-required", "true");
    // The arrival is optional and says nothing of the kind.
    expect(screen.getByLabelText("bus:form.arrivalTime")).not.toHaveAttribute("aria-required");
    expect(screen.getByText("common:form.requiredLegend")).toBeInTheDocument();
  });

  it("says beside the greyed-out save what is missing, and the list shrinks as it is filled", async () => {
    await renderForm();
    const hint = screen.getByTestId("save-blocked-hint");
    expect(hint).toHaveTextContent("bus:form.departureStation");
    expect(hint).toHaveTextContent("bus:form.arrivalStation");
    expect(hint).toHaveTextContent("bus:form.missing.departureTime");
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAccessibleDescription(/common:form\.saveBlocked/);

    // The item takes the user to the field.
    fireEvent.click(screen.getByRole("button", { name: "bus:form.departureStation" }));
    expect(document.getElementById("bus-dep-search")).toHaveFocus();

    pickBoth();
    await settle();
    expect(screen.getByTestId("save-blocked-hint")).not.toHaveTextContent(
      "bus:form.departureStation"
    );
    fireEvent.click(screen.getByRole("button", { name: "bus:form.missing.departureTime" }));
    expect(screen.getByLabelText(DEPARTURE_TIME)).toHaveFocus();

    fireEvent.change(screen.getByLabelText(DEPARTURE_TIME), {
      target: { value: "2026-09-20T09:00" },
    });
    expect(screen.queryByTestId("save-blocked-hint")).toBeNull();
    expect(saveButton()).not.toBeDisabled();
  });

  it("asks for a departure DATE when only the date is known", async () => {
    await renderForm();
    fireEvent.click(screen.getByLabelText("bus:form.departureTime: bus:form.dayOnly"));
    const hint = screen.getByTestId("save-blocked-hint");
    expect(hint).toHaveTextContent("bus:form.missing.departureDay");
    expect(hint).not.toHaveTextContent("bus:form.missing.departureTime");
  });

  it("names a terminal placed without a name, and takes the user to its name field", async () => {
    await readyForm();
    fireEvent.click(screen.getByText("pick bare bus:form.arrivalStation"));
    // A map pick with no name keeps the old one; clear it as a user would.
    fireEvent.change(document.getElementById("bus-arr-name") as HTMLInputElement, {
      target: { value: "" },
    });
    expect(saveButton()).toBeDisabled();
    const hint = screen.getByTestId("save-blocked-hint");
    expect(hint).not.toHaveTextContent("bus:form.arrivalStation");
    fireEvent.click(screen.getByRole("button", { name: "bus:form.missing.arrName" }));
    expect(document.getElementById("bus-arr-name")).toHaveFocus();
    await settle();
  });

  it("takes the user to the coordinate that was refused, and counts it as a change", async () => {
    const onClose = vi.fn();
    await renderForm({ journey: rideFixture(), onClose });
    fireEvent.click(screen.getByText("bad lon bus:form.departureStation"));
    expect(saveButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "bus:form.missing.depCoordinates" }));
    expect(document.getElementById("bus-dep-lon")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(await screen.findByText("common:discard.title")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the draft after a database restart, says so in a banner that takes focus, and retries", async () => {
    create.mockRejectedValueOnce(DB_DOWN);
    create.mockResolvedValueOnce({ ...rideFixture(), id: "new" });
    const onSaved = vi.fn();
    await readyForm({ onSaved });
    fireEvent.click(saveButton());

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("common:saveErrors.dbUnavailable");
    await waitFor(() => expect(banner).toHaveFocus());
    expect(screen.getByLabelText(DEPARTURE_TIME)).toHaveValue("2026-09-20T09:00");
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.click(within(banner).getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(2);
  });

  // Bus review, Minor 2 (integration wiring): the ride may be stored.
  it("offers no retry after a create whose answer was lost, and offers a reload instead", async () => {
    create.mockRejectedValueOnce(NETWORK);
    const onReload = vi.fn();
    await readyForm({ onReload });
    fireEvent.click(saveButton());

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("common:saveErrors.outcomeUnknown");
    expect(within(banner).queryByRole("button", { name: "common:buttons.retry" })).toBeNull();
    expect(screen.getByLabelText(DEPARTURE_TIME)).toHaveValue("2026-09-20T09:00");
    fireEvent.click(within(banner).getByRole("button", { name: "common:buttons.reloadList" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("clears the banner with the next edit, and offers no retry for a refused input", async () => {
    create.mockRejectedValue({ response: { status: 400, data: { code: "BUS_INVALID_INPUT" } } });
    await readyForm();
    fireEvent.click(saveButton());
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("bus:form.errors.invalid");
    expect(within(banner).queryByRole("button")).toBeNull();

    fireEvent.change(screen.getByLabelText("bus:form.seatNumber"), { target: { value: "4" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a refused seat at the seat field and takes the user there, with no banner", async () => {
    create.mockRejectedValue({
      response: { status: 400, data: { code: "BUS_INVALID_INPUT", field: "seat" } },
    });
    await readyForm();
    fireEvent.click(saveButton());
    const seat = screen.getByLabelText("bus:form.seatNumber");
    await waitFor(() => expect(seat).toHaveFocus());
    expect(seat).toHaveAttribute("aria-invalid", "true");
    expect(seat).toHaveAccessibleDescription("bus:form.errors.invalidField");
    expect(document.querySelector("[data-form-error-banner]")).toBeNull();
  });

  it("focuses a refused arrival at its field", async () => {
    create.mockRejectedValue({
      response: { data: { code: "BUS_ARRIVAL_BEFORE_DEPARTURE", field: "arrivalLocal" } },
    });
    await readyForm();
    fireEvent.click(saveButton());
    const arrival = screen.getByLabelText("bus:form.arrivalTime");
    await waitFor(() => expect(arrival).toHaveFocus());
    expect(arrival).toHaveAccessibleDescription("bus:form.errors.arrivalBeforeDeparture");
  });

  it("sends one request for a double click", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    create.mockReturnValue(new Promise((r) => (resolve = r)));
    const onSaved = vi.fn();
    await readyForm({ onSaved });
    const save = saveButton();
    fireEvent.click(save);
    fireEvent.click(save);
    await act(async () => {
      resolve({ ...rideFixture(), id: "new" });
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("says a stored ride whose list did not reload is saved, offers only Close, and cannot create it twice", async () => {
    create.mockResolvedValue({ ...rideFixture(), id: "new" });
    const onSaved = vi.fn().mockRejectedValue(new Error("list down"));
    const onClose = vi.fn();
    await readyForm({ onSaved, onClose });
    fireEvent.click(saveButton());
    expect(await screen.findByRole("status")).toHaveTextContent(
      "common:form.savedButRefreshFailed"
    );
    expect(screen.queryByTestId("bus-form-save")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    // Saved is not "changed": Close leaves without asking.
    // The footer's Close — the last of the two (the × carries the same name).
    const closes = screen.getAllByRole("button", { name: "common:buttons.close" });
    fireEvent.click(closes[closes.length - 1]);
    expect(screen.queryByText("common:discard.title")).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it("names the view, not the list, where the caller says so", async () => {
    update.mockResolvedValue(rideFixture());
    await renderForm({
      journey: rideFixture(),
      onSaved: vi.fn().mockRejectedValue(new Error("view down")),
      afterSaveFailedKey: "common:form.savedButViewRefreshFailed",
    });
    fireEvent.click(saveButton());
    expect(await screen.findByRole("status")).toHaveTextContent(
      "common:form.savedButViewRefreshFailed"
    );
  });

  it("asks before Escape drops a changed form, and closes an untouched one at once", async () => {
    const onClose = vi.fn();
    await renderForm({ journey: rideFixture(), onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before Escape or Cancel drops a changed form, and discards on the answer", async () => {
    const onClose = vi.fn();
    await renderForm({ journey: rideFixture(), onClose });
    fireEvent.change(screen.getByLabelText("bus:form.seatNumber"), { target: { value: "42" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(await screen.findByText("common:discard.title")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "common:discard.keepEditing" }));
    expect(screen.getByLabelText("bus:form.seatNumber")).toHaveValue("42");

    fireEvent.click(screen.getByRole("button", { name: "bus:form.cancel" }));
    expect(await screen.findByText("common:discard.title")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "common:discard.confirm" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not count a time changed away and back as a change", async () => {
    const onClose = vi.fn();
    await renderForm({ journey: rideFixture(), onClose });
    const time = screen.getByLabelText(DEPARTURE_TIME);
    fireEvent.change(time, { target: { value: "2026-09-20T10:00" } });
    fireEvent.change(time, { target: { value: "2026-09-20T09:00" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The trip the form preselects follows the typed departure; undoing the
  // date undoes the trip, so nothing the user did not type keeps it "changed".
  it("is unchanged again once a typed date that preselected a trip is removed", async () => {
    getAllTrips.mockResolvedValue([
      { id: "t1", name: "Korea", startDate: "2026-09-18", endDate: "2026-09-25" },
    ]);
    const onClose = vi.fn();
    await renderForm({ onClose });
    const time = screen.getByLabelText(DEPARTURE_TIME);
    fireEvent.change(time, { target: { value: "2026-09-20T09:00" } });
    const trip = screen.getByLabelText("bus:form.trip") as HTMLSelectElement;
    await waitFor(() => expect(trip.value).toBe("t1"));
    fireEvent.change(time, { target: { value: "" } });
    await waitFor(() => expect(trip.value).toBe(""));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("gives every text field a label that stays visible once typed into", async () => {
    await renderForm();
    for (const name of [
      "bus:form.operator",
      "bus:form.line",
      "bus:form.kind",
      "bus:form.class",
      "bus:form.seatNumber",
      "bus:form.bookingReference",
      "bus:form.price",
      "bus:form.delay",
      "bus:form.distance",
      "bus:form.trip",
      "bus:form.notes",
    ]) {
      const field = screen.getByLabelText(name);
      // Named by a visible <label>, not by an aria-label or a placeholder.
      expect(field).not.toHaveAttribute("aria-label");
      expect(field.closest("label")).not.toBeNull();
    }
    // The terminal fields keep the terminal in their name, and show a label too.
    const name = document.getElementById("bus-dep-name") as HTMLInputElement;
    expect(document.querySelector('label[for="bus-dep-name"]')).toHaveTextContent(
      "bus:form.stationName"
    );
    expect(name).toHaveAccessibleName("bus:form.departureStation: bus:form.stationName");
    expect(document.querySelector('label[for="bus-currency"]')).toHaveTextContent(
      "bus:form.currency"
    );
  });

  it("reads the help under a field as that field's description", async () => {
    await renderForm();
    expect(screen.getByLabelText("bus:form.kind")).toHaveAccessibleDescription("bus:form.kindHint");
    expect(screen.getByLabelText("bus:form.distance")).toHaveAccessibleDescription(
      "bus:form.distanceHint"
    );
  });

  it("lets a finger hit the checkbox rows on a coarse pointer", async () => {
    await renderForm();
    for (const box of [
      screen.getByLabelText("bus:form.cancelled"),
      screen.getByLabelText("bus:form.departureTime: bus:form.dayOnly"),
      screen.getByLabelText("bus:form.arrivalTime: bus:form.dayOnly"),
    ]) {
      expect(box.closest("label")?.className).toContain(
        "pointer-coarse:min-h-(--ts-size-touch-min)"
      );
    }
  });
});
