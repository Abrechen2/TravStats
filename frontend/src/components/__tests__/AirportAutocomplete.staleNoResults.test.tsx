import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import AirportAutocomplete, { airportInputLabel } from "../AirportAutocomplete";
import { airportsApi, setupApi, type Airport } from "../../lib/api";

/**
 * A field must not call its own contents invalid.
 *
 * Forgejo #10: type a nonsense query so the dropdown says no airports were
 * found, then search JFK and pick it. The airport is selected and Save turns
 * on — and the no-results message stays on screen. The form says the
 * destination is both valid and unfindable at the same time.
 *
 * The cause is that picking a row deliberately keeps focus on the input (the
 * mousedown handler prevents the default focus shift, or the click would never
 * reach the button). The field is then filled with the airport's LABEL —
 * "JFK — John F. Kennedy International Airport" — which re-ran the debounced
 * search. Nothing matches that string, so results emptied, and because the
 * input was still focused the dropdown reopened on the empty result.
 *
 * Two entrances, so two assertions: selecting, and later clicking back into an
 * already-filled field, which opens the dropdown without going through the
 * search effect at all.
 */
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    airportsApi: { search: vi.fn(), getByCode: vi.fn() },
    setupApi: { getAirportSeedingStatus: vi.fn() },
  };
});

const JFK = {
  id: "a1",
  iata: "JFK",
  icao: "KJFK",
  name: "John F. Kennedy International Airport",
} as unknown as Airport;

describe("AirportAutocomplete — no stale not-found", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(setupApi.getAirportSeedingStatus).mockResolvedValue({ status: "done" } as never);
    // The catalogue answers a code, and answers NOTHING for the display label —
    // which is the real server's behaviour and the whole point of the bug.
    vi.mocked(airportsApi.search).mockImplementation(async (q: string) =>
      q.toUpperCase() === "JFK" ? [JFK] : []
    );
    vi.mocked(airportsApi.getByCode).mockResolvedValue(JFK as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("stops saying not-found once an airport is chosen", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <AirportAutocomplete value={null} onChange={onChange} label="Nach" />
    );

    const input = screen.getByRole("textbox");
    input.focus();
    // SIX letters on purpose: a 3-4 letter query looks like an airport CODE and
    // takes the notFound branch instead, which is a different message.
    fireEvent.change(input, { target: { value: "zzzzzz" } });
    await vi.advanceTimersByTimeAsync(400);

    // The starting state the reporter described.
    await waitFor(() =>
      expect(screen.getByText("flights:airportAutocomplete.noResults")).toBeInTheDocument()
    );

    // Now a real selection arrives, exactly as the parent would hand it back.
    rerender(<AirportAutocomplete value={JFK} onChange={onChange} label="Nach" />);
    await vi.advanceTimersByTimeAsync(400);

    expect(screen.getByRole("textbox")).toHaveValue(airportInputLabel(JFK));
    expect(screen.queryByText("flights:airportAutocomplete.noResults")).toBeNull();
    expect(screen.queryByText(/notFound/)).toBeNull();
  });

  it("stays quiet when the user clicks back into a filled field", async () => {
    // This path never touches the search effect — focus opens the dropdown on
    // its own — so it needs its own guard and its own assertion.
    render(<AirportAutocomplete value={JFK} onChange={vi.fn()} label="Nach" />);
    await vi.advanceTimersByTimeAsync(400);

    fireEvent.focus(screen.getByRole("textbox"));
    await vi.advanceTimersByTimeAsync(400);

    expect(screen.queryByText("flights:airportAutocomplete.noResults")).toBeNull();
  });

  it("still reports a genuine miss", () => {
    // The guard must not silence the message for a query that really found
    // nothing, or it fixes the contradiction by removing the useful half.
    render(<AirportAutocomplete value={null} onChange={vi.fn()} label="Nach" />);
    const input = screen.getByRole("textbox");
    input.focus();
    fireEvent.change(input, { target: { value: "qqqqqq" } });

    return vi.advanceTimersByTimeAsync(400).then(async () => {
      await waitFor(() =>
        expect(screen.getByText("flights:airportAutocomplete.noResults")).toBeInTheDocument()
      );
    });
  });

  it("does not search the catalogue for its own display label", () => {
    // The render guard above already hides the contradiction. This pins the
    // second half of the fix, which is otherwise invisible: without it the
    // component fires a request for "JFK — John F. Kennedy International
    // Airport" on every selection — a query no catalogue can answer, whose
    // only effect is a wasted round trip and a flicker of the dropdown.
    render(<AirportAutocomplete value={JFK} onChange={vi.fn()} label="Nach" />);

    return vi.advanceTimersByTimeAsync(400).then(() => {
      const searched = vi.mocked(airportsApi.search).mock.calls.map((c) => c[0]);
      expect(searched).not.toContain(airportInputLabel(JFK));
    });
  });

});
