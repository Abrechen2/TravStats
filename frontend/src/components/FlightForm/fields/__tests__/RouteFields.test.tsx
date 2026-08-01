import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Airport } from "../../../../lib/api";
import RouteFields from "../RouteFields";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
// AirportAutocomplete does its own debounced search + seeding-status polling
// against the API — irrelevant to what RouteFields itself is responsible
// for (wiring two pickers to two onChange callbacks plus the "did this
// field settle on a match" hint gating), so it's replaced with a minimal
// stub exposing the same value/onChange/onFocus/onBlur contract. Same
// isolation boundary FlightCompleteStep.timesFieldsWiring.test.tsx uses.
//
// Four controls per side, matching what the REAL component actually does:
//   "-clear" -> onChange(null)   (a keystroke that diverges from the
//                                 current selection — AirportAutocomplete
//                                 calls this on EVERY such keystroke, not
//                                 just an abandoned one)
//   "-pick"  -> onBlur() THEN, a microtask later, onChange(NEXT) (clicking
//                                 a dropdown suggestion — see the round-3
//                                 note in FlightEditModal.routeFields.test.tsx
//                                 for why the microtask gap is load-bearing:
//                                 without it, React 18 batches the blur- and
//                                 select-triggered state updates into one
//                                 commit and no assertion can ever observe
//                                 the intermediate "blurred, not yet
//                                 resolved" state — the exact reason two
//                                 earlier rounds' mocks looked green and
//                                 weren't)
//   "-blur"  -> onBlur()         (leaving the field WITHOUT picking anything)
//   "-focus" -> onFocus()        (entering the field)
vi.mock("../../../AirportAutocomplete", () => ({
  default: ({
    value,
    onChange,
    placeholder,
    onFocus,
    onBlur,
  }: {
    value: Airport | null;
    onChange: (a: Airport | null) => void;
    placeholder?: string;
    onFocus?: () => void;
    onBlur?: () => void;
  }) => (
    <div>
      <span>{value?.iata ?? "none"}</span>
      <button
        type="button"
        aria-label={`${placeholder}-pick`}
        onClick={() => {
          onBlur?.();
          void Promise.resolve().then(() => onChange(NEXT));
        }}
      >
        pick
      </button>
      <button type="button" aria-label={`${placeholder}-clear`} onClick={() => onChange(null)}>
        clear
      </button>
      <button type="button" aria-label={`${placeholder}-blur`} onClick={() => onBlur?.()}>
        blur
      </button>
      <button type="button" aria-label={`${placeholder}-focus`} onClick={() => onFocus?.()}>
        focus
      </button>
    </div>
  ),
}));

const NEXT: Airport = { iata: "LHR", icao: "EGLL", name: "London Heathrow", lat: 51.5, lon: -0.45 };
const DEP_PLACEHOLDER = "flights:form.placeholders.departureAirport";

/** A real state owner for `departure` — a no-op `onDepartureChange` (as
 *  most tests in this file use) can never observably resolve, so a test
 *  that needs to see a pick actually LAND needs a genuine parent, exactly
 *  like FlightEditModal is in production. */
function StatefulDeparture(): JSX.Element {
  const [departure, setDeparture] = useState<Airport | null>(null);
  return (
    <RouteFields
      departure={departure}
      arrival={null}
      onDepartureChange={setDeparture}
      onArrivalChange={() => {}}
      departureHint="not recognised"
    />
  );
}

describe("RouteFields", () => {
  it("renders both pickers seeded with the current departure/arrival values", () => {
    const departure: Airport = { iata: "HND", name: "Tokyo Haneda", lat: 35.5, lon: 139.8 };
    render(
      <RouteFields
        departure={departure}
        arrival={null}
        onDepartureChange={() => {}}
        onArrivalChange={() => {}}
      />
    );
    expect(screen.getByText("HND")).toBeInTheDocument();
    expect(screen.getByText("none")).toBeInTheDocument();
  });

  it("routes a departure change through onDepartureChange only", async () => {
    const onDepartureChange = vi.fn();
    const onArrivalChange = vi.fn();
    render(
      <RouteFields
        departure={null}
        arrival={null}
        onDepartureChange={onDepartureChange}
        onArrivalChange={onArrivalChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: `${DEP_PLACEHOLDER}-pick` }));
    await waitFor(() => expect(onDepartureChange).toHaveBeenCalledWith(NEXT));
    expect(onArrivalChange).not.toHaveBeenCalled();
  });

  // Review follow-up #1: the labels must come from the edit-only,
  // non-asterisk key pair (flights:edit.routeFrom/routeTo) — NOT the create
  // form's flights:form.from/form.to, whose translated strings bake a "*"
  // required-marker directly into the text. RouteFields dropped the
  // `required` attribute (see its own docblock), so a baked-in asterisk
  // would now be a false claim. `t` is mocked as identity above, so the
  // rendered text IS the key itself.
  it("labels the pickers with the non-required edit-form keys, not the create form's", () => {
    render(
      <RouteFields
        departure={null}
        arrival={null}
        onDepartureChange={() => {}}
        onArrivalChange={() => {}}
      />
    );
    expect(screen.getByText("flights:edit.routeFrom")).toBeInTheDocument();
    expect(screen.getByText("flights:edit.routeTo")).toBeInTheDocument();
    expect(screen.queryByText("flights:form.from")).not.toBeInTheDocument();
    expect(screen.queryByText("flights:form.to")).not.toBeInTheDocument();
  });

  // Review follow-up #2 (round 2) — AirportAutocomplete nulls its value on
  // the FIRST keystroke of any edit, including a perfectly good one, so
  // gating the hint on raw null cried wolf during ordinary typing/searching.
  // RouteFields must only show it once the field SETTLES unresolved: a
  // blur while still null. Merely going null (typing) must never be enough
  // by itself.
  //
  // Review follow-up #2 (round 3) — blur ALSO fires before a dropdown pick
  // resolves (see the mock's "-pick" control above), so "settled" itself
  // can't be decided synchronously on blur either — handleBlur defers by a
  // macrotask and re-checks the LATEST value. These tests wait accordingly.
  describe("unresolved-airport hint (gated on a deferred blur check, not raw null)", () => {
    it("shows no hint while the value is null but the field hasn't been left yet", () => {
      render(
        <RouteFields
          departure={null}
          arrival={null}
          onDepartureChange={() => {}}
          onArrivalChange={() => {}}
          departureHint="not recognised"
        />
      );
      // departure is ALREADY null at mount (no typing simulated even) —
      // still must render nothing until a blur says the field settled here.
      expect(screen.queryByText("not recognised")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: `${DEP_PLACEHOLDER}-clear` }));
      expect(screen.queryByText("not recognised")).not.toBeInTheDocument();
    });

    it("shows the hint once the field is blurred and stays unresolved past the grace check", async () => {
      render(
        <RouteFields
          departure={null}
          arrival={null}
          onDepartureChange={() => {}}
          onArrivalChange={() => {}}
          departureHint="not recognised"
        />
      );
      fireEvent.click(screen.getByRole("button", { name: `${DEP_PLACEHOLDER}-clear` }));
      fireEvent.click(screen.getByRole("button", { name: `${DEP_PLACEHOLDER}-blur` }));
      await waitFor(() => expect(screen.getByText("not recognised")).toBeInTheDocument());
    });

    it("never shows the hint for a dropdown pick — blur fires, but the pick resolves before the grace check", async () => {
      render(<StatefulDeparture />);
      fireEvent.click(screen.getByRole("button", { name: `${DEP_PLACEHOLDER}-clear` }));
      fireEvent.click(screen.getByRole("button", { name: `${DEP_PLACEHOLDER}-pick` }));
      // Give both the pick's microtask AND handleBlur's macrotask a chance
      // to run, in the order they actually would: the airport display
      // settling on "LHR" confirms onChange landed through REAL state (not
      // a no-op callback, which could never observably resolve).
      await waitFor(() => expect(screen.getByText("LHR")).toBeInTheDocument());
      expect(screen.queryByText("not recognised")).not.toBeInTheDocument();
    });

    // The synchronous companion to the test above: checks the instant right
    // after blur lands, BEFORE the pick's microtask-deferred onChange has
    // had any chance to run. This is what actually distinguishes "deferred
    // grace check" from "decide synchronously on blur" — the test above
    // alone would pass against either implementation, since both settle to
    // the same end state eventually.
    it("shows no hint synchronously right after a pick's blur, before its onChange resolves", () => {
      render(
        <RouteFields
          departure={null}
          arrival={null}
          onDepartureChange={() => {}}
          onArrivalChange={() => {}}
          departureHint="not recognised"
        />
      );
      fireEvent.click(screen.getByRole("button", { name: `${DEP_PLACEHOLDER}-clear` }));
      fireEvent.click(screen.getByRole("button", { name: `${DEP_PLACEHOLDER}-pick` }));
      expect(screen.queryByText("not recognised")).not.toBeInTheDocument();
    });

    it("clears the hint immediately once the field resolves to a real airport", async () => {
      const { rerender } = render(
        <RouteFields
          departure={null}
          arrival={null}
          onDepartureChange={() => {}}
          onArrivalChange={() => {}}
          departureHint="not recognised"
        />
      );
      fireEvent.click(screen.getByRole("button", { name: `${DEP_PLACEHOLDER}-clear` }));
      fireEvent.click(screen.getByRole("button", { name: `${DEP_PLACEHOLDER}-blur` }));
      await waitFor(() => expect(screen.getByText("not recognised")).toBeInTheDocument());

      // Parent re-renders with a resolved value (a later successful edit).
      rerender(
        <RouteFields
          departure={NEXT}
          arrival={null}
          onDepartureChange={() => {}}
          onArrivalChange={() => {}}
          departureHint="not recognised"
        />
      );
      expect(screen.queryByText("not recognised")).not.toBeInTheDocument();
    });

    it("renders no hint when the caller doesn't supply one, even after blurring unresolved", async () => {
      render(
        <RouteFields
          departure={null}
          arrival={null}
          onDepartureChange={() => {}}
          onArrivalChange={() => {}}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: `${DEP_PLACEHOLDER}-blur` }));
      // Let the deferred grace-check run; still nothing to show either way.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(screen.queryByText("not recognised")).not.toBeInTheDocument();
    });
  });
});
