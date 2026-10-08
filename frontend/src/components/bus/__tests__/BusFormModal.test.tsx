import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor, fireEvent, within } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.value ? `${k}:${String(o.value)}` : k),
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
// The geocoder field stands in as one button per terminal that "picks" a hit.
vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({
    label,
    onChange,
  }: {
    label: string;
    onChange: (s: { lat: number; lon: number; name?: string; countryCode?: string }) => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() =>
          onChange(
            label === "bus:form.departureStation"
              ? {
                  lat: 37.5048,
                  lon: 127.0046,
                  name: "Seoul Express Bus Terminal",
                  countryCode: "kr",
                }
              : {
                  lat: 38.1911,
                  lon: 128.5918,
                  name: "Sokcho Express Bus Terminal",
                  countryCode: "kr",
                }
          )
        }
      >
        pick {label}
      </button>
      <button type="button" onClick={() => onChange({ lat: 35.1, lon: 129.0 })}>
        pick bare {label}
      </button>
    </>
  ),
}));

const getAllTrips = vi.fn();
vi.mock("../../../lib/api", () => ({
  tripsApi: { getAll: (...a: unknown[]) => getAllTrips(...a) },
}));
const create = vi.fn();
const update = vi.fn();
const entrySuggestions = vi.fn();
vi.mock("../../../lib/api/bus", () => ({
  busApi: {
    create: (...a: unknown[]) => create(...a),
    update: (...a: unknown[]) => update(...a),
    entrySuggestions: (...a: unknown[]) => entrySuggestions(...a),
  },
}));

import { BusFormModal } from "../BusFormModal";
import type { BusJourney } from "../../../types/bus";
import { rideFixture } from "./busFixture";

const NO_CHIPS = { operators: [], fareClasses: [], terminals: [] };

const saveButton = (): HTMLElement => screen.getByTestId("bus-form-save");

/**
 * Renders and lets the two mount-time lookups (trips, entry suggestions)
 * settle inside `act`, so no state update lands after a test's assertions.
 */
async function renderModal(
  journey: BusJourney | null,
  onSaved: (ride: BusJourney) => void = vi.fn()
): Promise<void> {
  await act(async () => {
    render(<BusFormModal journey={journey} onClose={vi.fn()} onSaved={onSaved} />);
  });
}

/**
 * Typing a terminal or the operator asks the suggestions endpoint again; this
 * lets that answer land inside `act` instead of after the test's last assertion.
 */
const settle = (): Promise<void> => act(async () => {});

function pickBothTerminals(): void {
  fireEvent.click(screen.getByText("pick bus:form.departureStation"));
  fireEvent.click(screen.getByText("pick bus:form.arrivalStation"));
}

function typeDeparture(value: string): void {
  fireEvent.change(screen.getByLabelText("bus:form.departureTime"), { target: { value } });
}

describe("BusFormModal", () => {
  beforeEach(() => {
    create.mockReset();
    update.mockReset();
    entrySuggestions.mockReset();
    entrySuggestions.mockResolvedValue(NO_CHIPS);
    getAllTrips.mockReset();
    getAllTrips.mockResolvedValue([]);
  });

  it("will not save until both terminals have a position and the ride has a departure", async () => {
    await renderModal(null);
    await waitFor(() => expect(getAllTrips).toHaveBeenCalled());
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText("bus:form.stationMissing")).toBeInTheDocument();

    pickBothTerminals();
    expect(screen.queryByText("bus:form.stationMissing")).toBeNull();
    expect(saveButton()).toBeDisabled();

    typeDeparture("2026-09-20T09:00");
    expect(saveButton()).not.toBeDisabled();
    await settle();
  });

  it("puts a refused arrival beside the arrival field and does not report a save", async () => {
    create.mockRejectedValue({
      response: {
        data: {
          error: "arrival must not precede departure",
          code: "BUS_ARRIVAL_BEFORE_DEPARTURE",
          field: "arrivalLocal",
        },
      },
    });
    const onSaved = vi.fn();
    await renderModal(null, onSaved);
    pickBothTerminals();
    typeDeparture("2026-09-20T09:00");
    fireEvent.click(saveButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("bus:form.errors.arrivalBeforeDeparture");
    expect(alert).not.toHaveTextContent("arrival must not precede departure");
    expect(alert.id).toBe("bus-arrivalLocal-error");
    expect(screen.getByLabelText("bus:form.arrivalTime")).toHaveAttribute("aria-invalid", "true");
    expect(onSaved).not.toHaveBeenCalled();
    // The dialog stays usable: the user can correct and save again.
    expect(saveButton()).not.toBeDisabled();
  });

  it("says the generic sentence for a refusal that names no field, and does not report a save", async () => {
    create.mockRejectedValue(new Error("Network Error"));
    const onSaved = vi.fn();
    await renderModal(null, onSaved);
    pickBothTerminals();
    typeDeparture("2026-09-20T09:00");
    fireEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("sends a cleared kind as null when editing", async () => {
    const saved = { ...rideFixture(), rideKind: null };
    update.mockResolvedValue(saved);
    const onSaved = vi.fn();
    await renderModal(rideFixture(), onSaved);
    const kind = screen.getByLabelText("bus:form.kind") as HTMLSelectElement;
    expect(kind.value).toBe("intercity");
    fireEvent.change(kind, { target: { value: "" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(update).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({
        rideKind: null,
        operator: "Kobus",
        departureLocal: "2026-09-20T09:00",
        arrivalLocal: "2026-09-20T11:20",
      })
    );
  });

  it("re-placing a terminal on a point with no country sends country null, not the old terminal's", async () => {
    create.mockResolvedValue({ id: "new" });
    await renderModal(null);
    pickBothTerminals();
    fireEvent.click(screen.getByText("pick bare bus:form.departureStation"));
    typeDeparture("2026-09-20T09:00");
    fireEvent.click(saveButton());

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        departureStation: {
          name: "Seoul Express Bus Terminal",
          address: null,
          lat: 35.1,
          lon: 129.0,
          country: null,
        },
        arrivalStation: expect.objectContaining({ country: "KR" }),
      })
    );
  });

  it("sends every optional field as null when nothing was typed", async () => {
    create.mockResolvedValue({ id: "new" });
    await renderModal(null);
    pickBothTerminals();
    typeDeparture("2026-09-20T09:00");
    fireEvent.click(saveButton());

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        operator: null,
        lineName: null,
        rideKind: null,
        arrivalLocal: null,
        fareClass: null,
        seat: null,
        price: null,
        tripId: null,
        notes: null,
        status: "scheduled",
        departureStation: {
          name: "Seoul Express Bus Terminal",
          address: null,
          lat: 37.5048,
          lon: 127.0046,
          country: "KR",
        },
      })
    );
  });

  it("does not call a parent's failure after a stored ride a refusal, and does not file the ride twice", async () => {
    create.mockResolvedValue({ id: "new" });
    const onSaved = vi.fn().mockRejectedValue(new Error("refetch failed"));
    await renderModal(null, onSaved);
    pickBothTerminals();
    typeDeparture("2026-09-20T09:00");
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(screen.queryByRole("alert")).toBeNull();
    // Stored once; a second click has nothing to send.
    fireEvent.click(saveButton());
    expect(create).toHaveBeenCalledTimes(1);
    await settle();
  });

  it("takes a shown refusal down when the user edits the form", async () => {
    create.mockRejectedValue({
      response: { data: { code: "BUS_ARRIVAL_BEFORE_DEPARTURE", field: "arrivalLocal" } },
    });
    await renderModal(null);
    pickBothTerminals();
    typeDeparture("2026-09-20T09:00");
    fireEvent.click(saveButton());
    await screen.findByRole("alert");

    fireEvent.change(screen.getByLabelText("bus:form.arrivalTime"), {
      target: { value: "2026-09-20T11:20" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("bus:form.arrivalTime")).not.toHaveAttribute("aria-invalid");
    await settle();
  });

  describe("entry suggestions", () => {
    it("a terminal chip fills name, address, position and country, so the save needs no geocoder pick", async () => {
      entrySuggestions.mockResolvedValue({
        ...NO_CHIPS,
        terminals: [
          {
            name: "Dong Seoul Bus Terminal",
            address: "50 Gangbyeon-yeok-ro",
            lat: 37.535,
            lon: 127.094,
            country: "KR",
          },
        ],
      });
      create.mockResolvedValue({ id: "new" });
      await renderModal(null);

      // The same merged list sits under both terminal fields.
      const chips = await screen.findAllByRole("button", {
        name: "common:suggestionChip:Dong Seoul Bus Terminal",
      });
      expect(chips).toHaveLength(2);

      fireEvent.click(chips[0]);
      typeDeparture("2026-09-20T09:00");
      expect(saveButton()).toBeDisabled();
      fireEvent.click(
        screen.getByRole("button", { name: "common:suggestionChip:Dong Seoul Bus Terminal" })
      );
      expect(saveButton()).not.toBeDisabled();

      fireEvent.click(saveButton());
      await waitFor(() => expect(create).toHaveBeenCalled());
      const terminal = {
        name: "Dong Seoul Bus Terminal",
        address: "50 Gangbyeon-yeok-ro",
        lat: 37.535,
        lon: 127.094,
        country: "KR",
      };
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ departureStation: terminal, arrivalStation: terminal })
      );
    });

    it("offers a terminal whose name was typed in full but never placed, until it is placed", async () => {
      entrySuggestions.mockResolvedValue({
        ...NO_CHIPS,
        terminals: [
          { name: "Dong Seoul", address: null, lat: 37.535, lon: 127.094, country: "KR" },
        ],
      });
      await renderModal(null);
      const chip = { name: "common:suggestionChip:Dong Seoul" };
      await screen.findAllByRole("button", chip);
      fireEvent.change(screen.getByLabelText("bus:form.departureStation: bus:form.stationName"), {
        target: { value: "Dong Seoul" },
      });
      await settle();

      // The merged list sits under both fields, so only the DEPARTURE row can
      // show that the typed name did not hide the chip it still needs.
      const depRow = within(screen.getByTestId("bus-terminal-chips-dep"));
      const arrRow = within(screen.getByTestId("bus-terminal-chips-arr"));
      expect(depRow.getByRole("button", chip)).toBeInTheDocument();

      fireEvent.click(depRow.getByRole("button", chip));
      // Name and position now match: this chip would change nothing, so it
      // goes — from the departure row only.
      expect(depRow.queryByRole("button", chip)).toBeNull();
      expect(arrRow.getByRole("button", chip)).toBeInTheDocument();
      await settle();
    });

    it("an operator and a class chip fill their fields on a click", async () => {
      entrySuggestions.mockResolvedValue({
        operators: ["Kobus"],
        fareClasses: ["Premium"],
        terminals: [],
      });
      await renderModal(null);
      fireEvent.click(await screen.findByRole("button", { name: "common:suggestionChip:Kobus" }));
      fireEvent.click(screen.getByRole("button", { name: "common:suggestionChip:Premium" }));
      expect(screen.getByLabelText("bus:form.operator")).toHaveValue("Kobus");
      expect(screen.getByLabelText("bus:form.class")).toHaveValue("Premium");
      await settle();
    });

    it("says so when the suggestions could not be loaded, instead of showing no chips", async () => {
      entrySuggestions.mockRejectedValue(new Error("down"));
      await renderModal(null);
      expect(await screen.findByTestId("bus-suggestions-failed")).toHaveTextContent(
        "bus:form.suggestionsFailed"
      );
      // The form still works without them.
      pickBothTerminals();
      typeDeparture("2026-09-20T09:00");
      expect(saveButton()).not.toBeDisabled();
      await settle();
    });
  });

  describe("only the date is known", () => {
    it("switches both inputs to dates and sends days", async () => {
      create.mockResolvedValue({ id: "new" });
      await renderModal(null);
      pickBothTerminals();
      typeDeparture("2026-09-20T09:00");
      fireEvent.change(screen.getByLabelText("bus:form.arrivalTime"), {
        target: { value: "2026-09-20T11:20" },
      });

      fireEvent.click(screen.getByLabelText("bus:form.dayOnly"));
      expect(screen.getByLabelText("bus:form.departureTime")).toHaveAttribute("type", "date");
      expect(screen.getByLabelText("bus:form.departureTime")).toHaveValue("2026-09-20");
      expect(screen.getByLabelText("bus:form.arrivalTime")).toHaveAttribute("type", "date");

      fireEvent.click(saveButton());
      await waitFor(() => expect(create).toHaveBeenCalled());
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ departureLocal: "2026-09-20", arrivalLocal: "2026-09-20" })
      );
    });

    it("opens a ride stored by its day with the box ticked", async () => {
      const stored = rideFixture();
      const ride = {
        ...stored,
        arrivalTime: null,
        times: {
          ...stored.times!,
          departure: {
            ...stored.times!.departure!,
            local: "2026-09-20T00:00:00",
            precision: "day" as const,
          },
          arrival: null,
        },
      };
      await renderModal(ride);
      expect(screen.getByLabelText("bus:form.dayOnly")).toBeChecked();
      expect(screen.getByLabelText("bus:form.departureTime")).toHaveValue("2026-09-20");
    });
  });
});
