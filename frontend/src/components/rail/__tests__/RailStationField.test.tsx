import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
// The geocoder field stands in as buttons that "pick" a hit with or without a country.
vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({ onChange }: { onChange: (s: Record<string, unknown>) => void }) => (
    <>
      <button type="button" onClick={() => onChange({ lat: 35.1, lon: 129.0 })}>
        pick bare
      </button>
      <button
        type="button"
        onClick={() => onChange({ lat: 52.5, lon: 13.3, name: "Berlin Hbf", countryCode: "de" })}
      >
        pick named
      </button>
      <button
        type="button"
        onClick={() => onChange({ lat: 37.5547, lon: 126.9707, name: "Seoul" })}
      >
        pick same point
      </button>
    </>
  ),
}));

import { RailStationField, type RailStationDraft } from "../RailStationField";

const SEOUL: RailStationDraft = {
  name: "Seoul Station",
  lat: 37.5547,
  lon: 126.9707,
  country: "KR",
  code: null,
  stationId: null,
};

function renderField(): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  render(
    <RailStationField
      label="Von"
      idPrefix="dep"
      value={SEOUL}
      onChange={onChange}
      inputClassName="x"
    />
  );
  return onChange;
}

// forgejo#213: a pick that brought no country kept the previous station's.
describe("RailStationField pick", () => {
  it("clears the country when the point moves and the pick brings none, keeping the typed name", () => {
    const onChange = renderField();
    fireEvent.click(screen.getByText("pick bare"));
    expect(onChange).toHaveBeenCalledWith({
      name: SEOUL.name,
      lat: 35.1,
      lon: 129.0,
      country: null,
      code: null,
      stationId: null,
    });
  });

  it("takes the pick's country, upper-cased, and its name", () => {
    const onChange = renderField();
    fireEvent.click(screen.getByText("pick named"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Berlin Hbf", country: "DE" })
    );
  });

  it("keeps the country when the same point is picked again without one", () => {
    const onChange = renderField();
    fireEvent.click(screen.getByText("pick same point"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ country: "KR" }));
  });
});
