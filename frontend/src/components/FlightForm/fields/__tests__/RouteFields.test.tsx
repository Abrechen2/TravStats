import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
//   "-pick"  -> onChange(NEXT)   (clicking a dropdown suggestion)
//   "-blur"  -> onBlur()         (leaving the field)
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
      <button type="button" aria-label={`${placeholder}-pick`} onClick={() => onChange(NEXT)}>
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

  it("routes a departure change through onDepartureChange only", () => {
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
    expect(onDepartureChange).toHaveBeenCalledWith(NEXT);
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
  describe("unresolved-airport hint (gated on blur, not raw null)", () => {
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

    it("shows the hint once the field is blurred while still unresolved", () => {
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
      expect(screen.getByText("not recognised")).toBeInTheDocument();
    });

    it("clears the hint immediately once the field resolves to a real airport", () => {
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
      expect(screen.getByText("not recognised")).toBeInTheDocument();

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

    it("renders no hint when the caller doesn't supply one, even after blurring unresolved", () => {
      render(
        <RouteFields
          departure={null}
          arrival={null}
          onDepartureChange={() => {}}
          onArrivalChange={() => {}}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: `${DEP_PLACEHOLDER}-blur` }));
      expect(screen.queryByText("not recognised")).not.toBeInTheDocument();
    });
  });
});
