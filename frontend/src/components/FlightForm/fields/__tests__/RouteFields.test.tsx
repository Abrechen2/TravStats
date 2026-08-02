import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Airport } from "../../../../lib/api";
import RouteFields from "../RouteFields";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
// AirportAutocomplete does its own debounced search + seeding-status polling
// against the API — irrelevant to what RouteFields itself is responsible
// for (wiring two pickers to two onChange callbacks), so it's replaced with
// a minimal stub exposing the same value/onChange contract. Same isolation
// boundary FlightCompleteStep.timesFieldsWiring.test.tsx uses.
vi.mock("../../../AirportAutocomplete", () => ({
  default: ({
    value,
    onChange,
    placeholder,
  }: {
    value: Airport | null;
    onChange: (a: Airport | null) => void;
    placeholder?: string;
  }) => (
    <div>
      <span>{value?.iata ?? "none"}</span>
      <button type="button" aria-label={`${placeholder}-pick`} onClick={() => onChange(NEXT)}>
        pick
      </button>
      <button type="button" aria-label={`${placeholder}-clear`} onClick={() => onChange(null)}>
        clear
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

  it("routes a typed-clear the same way, through onDepartureChange only", () => {
    const onDepartureChange = vi.fn();
    const onArrivalChange = vi.fn();
    render(
      <RouteFields
        departure={{ iata: "HND", name: "Tokyo Haneda", lat: 35.5, lon: 139.8 }}
        arrival={null}
        onDepartureChange={onDepartureChange}
        onArrivalChange={onArrivalChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: `${DEP_PLACEHOLDER}-clear` }));
    expect(onDepartureChange).toHaveBeenCalledWith(null);
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
});
