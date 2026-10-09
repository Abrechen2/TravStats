/**
 * forgejo#245–#249 on the special-flight form ("Sonder-Flug"): on the shared
 * dialog frame, its rules at their fields, one save at a time, and a question
 * before a changed form is discarded.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Flight } from "../../types";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "de" } }),
}));
vi.mock("../../lib/api", () => ({
  companionsApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock("@/hooks/useTagSuggestions", () => ({ useTagSuggestions: () => [] }));
vi.mock("../../lib/api/catalogue", () => ({
  aircraftApi: { search: vi.fn().mockResolvedValue([]) },
  airlinesApi: { search: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
// The map widget needs WebGL; a stub keeps the event kind renderable.
vi.mock("../specialFlights/EventLocationPicker", () => ({
  EventLocationPicker: () => <div data-testid="event-location" />,
}));
// The airport picker searches the catalogue; a button picks a fixed airport,
// and the stub repeats what the real one does with an error (see
// AirportAutocomplete.error.test.tsx for the real wiring).
vi.mock("../AirportAutocomplete", () => ({
  default: ({
    id,
    error,
    onChange,
    value,
  }: {
    id: string;
    error?: string | null;
    onChange: (a: unknown) => void;
    value: { iata: string } | null;
  }) => (
    <>
      <input
        id={id}
        required
        readOnly
        value={value?.iata ?? ""}
        aria-invalid={error ? true : undefined}
      />
      {error ? <p>{error}</p> : null}
      <button
        type="button"
        onClick={() =>
          onChange({
            iata: "MUC",
            icao: "EDDM",
            name: "Munich",
            lat: 48,
            lon: 11,
            timezone: "Europe/Berlin",
          })
        }
      >
        {`pick-${id}`}
      </button>
    </>
  ),
}));
const create = vi.fn();
const update = vi.fn();
vi.mock("../../lib/api/flights", () => ({
  flightsApi: {
    create: (...a: unknown[]) => create(...a),
    update: (...a: unknown[]) => update(...a),
  },
}));

import SpecialFlightModal from "../SpecialFlightModal";

const networkError = Object.assign(new Error("Network Error"), { isAxiosError: true });

function renderModal(flight: Flight | null = null) {
  const props = { isOpen: true, onClose: vi.fn(), onSaved: vi.fn(), flight };
  render(<SpecialFlightModal {...props} />);
  return props;
}

function pickSightseeing(): void {
  fireEvent.click(screen.getByText("specialFlights:type.sightseeing"));
}

const save = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "specialFlights:actions.save" }));
};

describe("SpecialFlightModal — the shared form blocks", () => {
  beforeEach(() => {
    create.mockReset().mockResolvedValue({ id: "new" });
    update.mockReset().mockResolvedValue({});
  });

  it("is a dialog on the shared frame, and an untouched one closes on Escape", () => {
    const props = renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("says the airport is missing at the airport, focuses it, and sends nothing", async () => {
    renderModal();
    pickSightseeing();
    expect(
      screen.getByRole("button", { name: "specialFlights:missing.airport" })
    ).toBeInTheDocument();
    save();
    const airport = document.getElementById("special-departure-airport") as HTMLInputElement;
    await waitFor(() => expect(airport).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText("specialFlights:error.missingAirport")).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(airport));
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a coordinate out of range at its field", async () => {
    renderModal();
    fireEvent.click(screen.getByText("specialFlights:type.zerog"));
    fireEvent.click(screen.getByText("pick-special-departure-airport"));
    fireEvent.change(document.getElementById("zerog-pattern-lat")!, { target: { value: "95" } });
    save();
    const lat = document.getElementById("zerog-pattern-lat") as HTMLInputElement;
    await waitFor(() => expect(lat).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById(lat.getAttribute("aria-describedby")!)).toHaveTextContent(
      "specialFlights:error.invalidCoordinates"
    );
    await waitFor(() => expect(document.activeElement).toBe(lat));
    expect(create).not.toHaveBeenCalled();
  });

  it("asks before a changed form is discarded", async () => {
    const props = renderModal();
    pickSightseeing();
    fireEvent.click(screen.getByRole("button", { name: "specialFlights:actions.cancel" }));
    expect(await screen.findByText("common:discard.title")).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("keeps the draft after a dropped connection; the retry saves once more", async () => {
    create.mockRejectedValueOnce(networkError).mockResolvedValueOnce({ id: "new" });
    const props = renderModal();
    pickSightseeing();
    fireEvent.click(screen.getByText("pick-special-departure-airport"));
    save();
    const banner = (await screen.findByText("common:saveErrors.network")).closest(
      "[data-form-error-banner]"
    ) as HTMLElement;
    expect(banner).toHaveAttribute("role", "alert");
    fireEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(2);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("creates once for a double submit", async () => {
    let settle: (v: unknown) => void = () => {};
    create.mockImplementation(() => new Promise((r) => (settle = r)));
    renderModal();
    pickSightseeing();
    fireEvent.click(screen.getByText("pick-special-departure-airport"));
    act(() => {
      save();
      save();
    });
    await act(async () => settle({ id: "new" }));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("opens an existing special flight unchanged: Escape closes without asking", async () => {
    const flight = {
      id: "s1",
      airline: "",
      flightNumber: "",
      departureTime: "2026-08-12T18:00:00.000Z",
      arrivalTime: "2026-08-12T20:00:00.000Z",
      status: "flown",
      createdAt: "2026-01-01T00:00:00.000Z",
      specialType: "sightseeing",
      depIata: "MUC",
      depLat: 48,
      depLon: 11,
      arrIata: "MUC",
      arrLat: 48,
      arrLon: 11,
      notes: "Alpenrundflug",
    } as unknown as Flight;
    const props = renderModal(flight);
    await waitFor(() =>
      expect((document.getElementById("special-notes") as HTMLTextAreaElement).value).toBe(
        "Alpenrundflug"
      )
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("says which event kind is chosen, not only by colour", async () => {
    renderModal();
    fireEvent.click(screen.getByText("specialFlights:type.event"));
    // The companion picker's suggestions settle first.
    await act(async () => {});
    expect(screen.getByRole("button", { name: /specialFlights:subtype\.eclipse/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: /specialFlights:subtype\.aurora/ })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });
});
