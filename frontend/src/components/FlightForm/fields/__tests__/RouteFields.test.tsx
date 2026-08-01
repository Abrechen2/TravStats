import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Airport } from "../../../../lib/api";
import RouteFields from "../RouteFields";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
// AirportAutocomplete does its own debounced search + seeding-status polling
// against the API — irrelevant to what RouteFields itself is responsible
// for (wiring two pickers to two onChange callbacks), so it's replaced with
// a minimal stub that exposes the same value/onChange contract. Same
// isolation boundary FlightCompleteStep.timesFieldsWiring.test.tsx uses.
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
    <button type="button" aria-label={placeholder} onClick={() => onChange(NEXT)}>
      {value?.iata ?? "none"}
    </button>
  ),
}));

const NEXT: Airport = { iata: "LHR", icao: "EGLL", name: "London Heathrow", lat: 51.5, lon: -0.45 };

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
    const [depButton] = screen.getAllByRole("button");
    depButton.click();
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

  // Review follow-up #2: an abandoned typed edit (the AirportAutocomplete's
  // own onChange(null) when the typed text doesn't match a real airport)
  // must not vanish silently — RouteFields renders whatever hint text the
  // caller supplies under the corresponding field. RouteFields itself is
  // dumb about WHEN to show one; FlightEditModal decides that (see its own
  // test file) by only passing a hint when its airport state is null.
  it("shows the caller-supplied hint under a field with a null value, none when absent", () => {
    render(
      <RouteFields
        departure={null}
        arrival={{ iata: "JFK", name: "JFK", lat: 40.6, lon: -73.8 }}
        onDepartureChange={() => {}}
        onArrivalChange={() => {}}
        departureHint="not recognised"
      />
    );
    expect(screen.getByText("not recognised")).toBeInTheDocument();
  });

  it("renders no hint when the caller doesn't supply one", () => {
    render(
      <RouteFields
        departure={null}
        arrival={null}
        onDepartureChange={() => {}}
        onArrivalChange={() => {}}
      />
    );
    expect(screen.queryByText("not recognised")).not.toBeInTheDocument();
  });
});
