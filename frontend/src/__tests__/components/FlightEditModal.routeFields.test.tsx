/**
 * Task 4 (#flight-form-phase1-times) — the edit modal's departure/arrival
 * airports are now editable via RouteFields. Two things this file pins that
 * no earlier test covers:
 *
 * 1. Changing an airport must move the submitted departureLocal/depTimezone
 *    (or arrivalLocal/arrTimezone) pair onto the NEWLY selected airport's
 *    zone — not leave it pinned to the flight's originally stored zone. This
 *    is the interaction between RouteFields and Task 2's useAirportLocalTimes
 *    hook: a code change re-triggers resolution, and the modal's hydration
 *    effect re-derives the wall clock once the new zone lands.
 * 2. Saving WHILE that re-resolution is still in flight must not submit a
 *    mismatched pair (a stale wall clock paired with the new zone, or vice
 *    versa) — useAirportLocalTimes never un-hydrates mid-resolution, and the
 *    modal only ever writes depDate/depTime and depTz together, so whatever
 *    is submitted must still recombine to a single coherent instant.
 *
 * AirportAutocomplete itself (search-as-you-type, dropdown, seeding status)
 * is out of scope here — same isolation boundary FlightCompleteStep's own
 * wiring tests use — so it's replaced with a minimal value/onChange stub.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fromZonedTime } from "date-fns-tz";
import type { Flight } from "../../types";
import type { Airport } from "../../lib/api";

// `nextAirport` is what the AirportAutocomplete stub below "selects" on
// click — mutable so each test can point it at a different airport. Lives on
// the vi.hoisted() container (not a plain module-level `let`) because
// vi.mock factories run before the rest of this file's top-level code, so a
// plain variable would still be in the TDZ when the factory closes over it.
const mocks = vi.hoisted(() => ({
  getByCode: vi.fn(),
  nextAirport: null as Airport | null,
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../components/ReceiptUpload", () => ({
  default: () => null,
}));
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({
    features: { enableCostTracking: false },
    display: { timezone: "Europe/Berlin", language: "de" },
  }),
}));
vi.mock("../../lib/api/airports", () => ({
  airportsApi: { getByCode: mocks.getByCode },
}));
vi.mock("../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../lib/api", () => ({
  companionsApi: { list: vi.fn().mockResolvedValue([]) },
}));
// See file header: AirportAutocomplete's own search UI isn't under test
// here. The stub reproduces its actual value/onChange/onFocus/onBlur
// contract with one button per action:
//   "{placeholder}"        -> onChange(mocks.nextAirport)  (pick a suggestion)
//   "{placeholder}-clear"  -> onChange(null)                (a keystroke that
//                              diverges from the current selection — the real
//                              component calls this on EVERY such keystroke,
//                              not just an abandoned one — see
//                              AirportAutocomplete.tsx's handleInputChange)
//   "{placeholder}-blur"   -> onBlur()                      (leaving the field)
// Round 2 (review follow-up): the FIRST version of this mock exposed only
// "pick" and a TERMINAL "clear" — never clear-then-pick, and no blur at
// all — so the hint's "fires on every keystroke, not just an abandoned
// edit" regression was unexercised. It is now.
vi.mock("../../components/AirportAutocomplete", () => ({
  default: ({
    value,
    onChange,
    placeholder,
    onBlur,
  }: {
    value: Airport | null;
    onChange: (a: Airport | null) => void;
    placeholder?: string;
    onBlur?: () => void;
  }) => (
    <div>
      <button type="button" aria-label={placeholder} onClick={() => onChange(mocks.nextAirport)}>
        {value?.iata ?? "none"}
      </button>
      <button type="button" aria-label={`${placeholder}-clear`} onClick={() => onChange(null)}>
        clear
      </button>
      <button type="button" aria-label={`${placeholder}-blur`} onClick={() => onBlur?.()}>
        blur
      </button>
    </div>
  ),
}));

import FlightEditModal from "../../components/FlightEditModal";

// A flight stored at 12:35/16:50 UTC, departing Tokyo (UTC+9), arriving New
// York (UTC-4 in August). Browser (mocked above) runs in Berlin. All three
// zones differ on purpose — same fixture shape as FlightEditModal.timezone.test.tsx.
const FLIGHT: Flight = {
  id: "f1",
  userId: "u1",
  airline: "ANA",
  flightNumber: "NH203",
  depLat: 35.5,
  depLon: 139.8,
  arrLat: 40.6,
  arrLon: -73.8,
  departureTime: "2026-08-14T12:35:00.000Z",
  arrivalTime: "2026-08-14T16:50:00.000Z",
  depIata: "HND",
  arrIata: "JFK",
  status: "scheduled",
  createdAt: "2026-01-01T00:00:00.000Z",
  companions: [],
  tags: [],
};

const LHR: Airport = { iata: "LHR", icao: "EGLL", name: "London Heathrow", lat: 51.5, lon: -0.45 };

const AIRPORTS: Record<string, { iata: string; timezone: string; lat: number; lon: number }> = {
  HND: { iata: "HND", timezone: "Asia/Tokyo", lat: 35.5, lon: 139.8 },
  JFK: { iata: "JFK", timezone: "America/New_York", lat: 40.6, lon: -73.8 },
  LHR: { iata: "LHR", timezone: "Europe/London", lat: 51.5, lon: -0.45 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.nextAirport = LHR;
  mocks.getByCode.mockImplementation(async (code: string) => AIRPORTS[code]);
});

async function waitForHydration(): Promise<void> {
  // Tokyo is UTC+9 with no DST: 12:35Z -> 21:35 local, same date.
  await waitFor(() => {
    const dateInput = document.querySelector("#editDepartureDate") as HTMLInputElement;
    const timeInput = document.querySelector("#editDepartureTime") as HTMLInputElement;
    expect(dateInput.value).toBe("2026-08-14");
    expect(timeInput.value).toBe("21:35");
  });
}

describe("FlightEditModal route editing (Task 4)", () => {
  it("submits departure/arrival objects carrying lat/lon", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FlightEditModal flight={FLIGHT} isOpen onClose={() => {}} onSave={onSave} />);
    await waitForHydration();

    await userEvent.click(await screen.findByRole("button", { name: /speichern|save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    const [, payload] = onSave.mock.calls[onSave.mock.calls.length - 1];
    expect(payload.departure).toMatchObject({ iata: "HND", lat: 35.5, lon: 139.8 });
    expect(payload.arrival).toMatchObject({ iata: "JFK", lat: 40.6, lon: -73.8 });
  });

  it("moves the submitted timezone basis to a newly selected departure airport", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FlightEditModal flight={FLIGHT} isOpen onClose={() => {}} onSave={onSave} />);
    await waitForHydration();

    // Switch the departure airport from Tokyo to London.
    await userEvent.click(
      screen.getByRole("button", { name: "flights:form.placeholders.departureAirport" })
    );

    // The re-resolved zone (Europe/London) must land on the wall-clock inputs
    // too — the hydration effect re-derives them from the SAME stored UTC
    // instant, now split against the new zone. London is on BST (UTC+1) in
    // August: 12:35Z -> 13:35 local, same date.
    await waitFor(() => {
      const dateInput = document.querySelector("#editDepartureDate") as HTMLInputElement;
      const timeInput = document.querySelector("#editDepartureTime") as HTMLInputElement;
      expect(dateInput.value).toBe("2026-08-14");
      expect(timeInput.value).toBe("13:35");
    });

    await userEvent.click(await screen.findByRole("button", { name: /speichern|save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    const [, payload] = onSave.mock.calls[onSave.mock.calls.length - 1];
    expect(payload.depTimezone).toBe("Europe/London");
    expect(payload.departure).toMatchObject({ iata: "LHR" });
    // The pair must still describe the SAME original instant — only the
    // zone basis it's expressed in changed, not the underlying flight time.
    expect(fromZonedTime(payload.departureLocal, payload.depTimezone).toISOString()).toBe(
      FLIGHT.departureTime
    );
  });

  it("submits a coherent wall-clock/timezone pair when saving mid-resolution", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FlightEditModal flight={FLIGHT} isOpen onClose={() => {}} onSave={onSave} />);
    await waitForHydration();

    // Make the NEXT lookup (triggered by the departure-airport change below)
    // hang forever, simulating "save while re-resolution is still in
    // flight". useAirportLocalTimes awaits Promise.all([dep, arr]), so a
    // pending departure lookup blocks the whole pair from updating — depTz/
    // arrTz (and therefore the rendered wall clock) must stay exactly what
    // they were before the click.
    mocks.getByCode.mockImplementation(
      (code: string) =>
        new Promise((resolve) => {
          if (code !== "LHR") resolve(AIRPORTS[code]);
          // LHR: never resolves within this test.
        })
    );

    await userEvent.click(
      screen.getByRole("button", { name: "flights:form.placeholders.departureAirport" })
    );

    // Give the pending effect a tick to start (and NOT finish).
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The inputs must still show the OLD (Tokyo) wall clock — the new
    // selection hasn't resolved yet.
    const dateInput = document.querySelector("#editDepartureDate") as HTMLInputElement;
    const timeInput = document.querySelector("#editDepartureTime") as HTMLInputElement;
    expect(dateInput.value).toBe("2026-08-14");
    expect(timeInput.value).toBe("21:35");

    await userEvent.click(await screen.findByRole("button", { name: /speichern|save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    const [, payload] = onSave.mock.calls[onSave.mock.calls.length - 1];
    // Whichever pair got submitted, it must recombine to a single coherent
    // instant — never a stale wall clock crossed with the new airport's zone.
    expect(fromZonedTime(payload.departureLocal, payload.depTimezone).toISOString()).toBe(
      FLIGHT.departureTime
    );
    expect(payload.depTimezone).toBe("Asia/Tokyo");
  });

  // Review follow-up #2 (round 1): an abandoned typed edit (AirportAutocomplete's
  // own onChange(null) when the typed text doesn't resolve) must be visible, not
  // silent — before that fix, departureAirport just went null and the save
  // quietly kept the flight's stored airport with no indication anything was
  // dropped.
  //
  // Round 2 correction: the hint must only appear once the field SETTLES
  // unresolved — a blur while still null — not on the raw null itself. So this
  // test now drives BOTH "type" (clear) and "leave the field" (blur) before
  // expecting the hint; see the next test for the case that round 1 missed.
  it("shows a hint once an abandoned typed edit is left unresolved, and still saves with the stored airport kept", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FlightEditModal flight={FLIGHT} isOpen onClose={() => {}} onSave={onSave} />);
    await waitForHydration();

    await userEvent.click(
      screen.getByRole("button", { name: "flights:form.placeholders.departureAirport-clear" })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "flights:form.placeholders.departureAirport-blur" })
    );

    // The abandoned, LEFT edit must be visible — not a blocking error, just a hint.
    expect(await screen.findByText("flights:edit.routeUnresolvedHint")).toBeInTheDocument();

    // Not a blocking validation: saving must still work.
    await userEvent.click(await screen.findByRole("button", { name: /speichern|save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    const [, payload] = onSave.mock.calls[onSave.mock.calls.length - 1];
    // Not a data-integrity bug: the field is simply omitted, so the server
    // keeps the flight's currently stored departure untouched.
    expect(payload.departure).toBeUndefined();
  });

  // THE test round 2 was missing: the normal editing path — typing toward a
  // NEW airport and picking it — passes through the exact same onChange(null)
  // the abandoned-edit path does (see AirportAutocomplete.tsx's
  // handleInputChange, which nulls the value on the FIRST keystroke that
  // diverges from the current selection). A hint gated on raw null fires here
  // too, mid-search, for an edit that's about to succeed. It must not.
  it("shows NO hint at any point while typing toward a new airport and picking it", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FlightEditModal flight={FLIGHT} isOpen onClose={() => {}} onSave={onSave} />);
    await waitForHydration();

    // "Typing": the first diverging keystroke nulls the value, same as the
    // real component. Mid-search — no hint yet.
    await userEvent.click(
      screen.getByRole("button", { name: "flights:form.placeholders.departureAirport-clear" })
    );
    expect(screen.queryByText("flights:edit.routeUnresolvedHint")).not.toBeInTheDocument();

    // "Picking": lands on a real airport from the dropdown.
    await userEvent.click(
      screen.getByRole("button", { name: "flights:form.placeholders.departureAirport" })
    );
    expect(screen.queryByText("flights:edit.routeUnresolvedHint")).not.toBeInTheDocument();

    // Leaving the field afterwards must not resurrect a stale hint either.
    await userEvent.click(
      screen.getByRole("button", { name: "flights:form.placeholders.departureAirport-blur" })
    );
    expect(screen.queryByText("flights:edit.routeUnresolvedHint")).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: /speichern|save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, payload] = onSave.mock.calls[onSave.mock.calls.length - 1];
    expect(payload.departure).toMatchObject({ iata: "LHR" });
  });
});
