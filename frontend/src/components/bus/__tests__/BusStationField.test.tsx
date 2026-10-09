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
        onClick={() => onChange({ lat: 52.5, lon: 13.3, name: "ZOB Berlin", countryCode: "de" })}
      >
        pick named
      </button>
      <button
        type="button"
        onClick={() => onChange({ lat: 37.5048, lon: 127.0046, name: "Seoul" })}
      >
        pick same point
      </button>
    </>
  ),
}));

import { BusStationField, type BusStationDraft } from "../BusStationField";

const SEOUL: BusStationDraft = {
  name: "Seoul Express Bus Terminal",
  address: "Banpo-daero",
  lat: 37.5048,
  lon: 127.0046,
  country: "KR",
};

function renderField(): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  render(
    <BusStationField
      label="Von"
      idPrefix="dep"
      value={SEOUL}
      onChange={onChange}
      inputClassName="x"
    />
  );
  return onChange;
}

describe("BusStationField pick", () => {
  it("clears the country when the point moves and the pick brings none, keeping the typed name and address", () => {
    const onChange = renderField();
    fireEvent.click(screen.getByText("pick bare"));
    expect(onChange).toHaveBeenCalledWith({
      name: SEOUL.name,
      address: SEOUL.address,
      lat: 35.1,
      lon: 129.0,
      country: null,
    });
  });

  it("takes the pick's country, upper-cased, and its name", () => {
    const onChange = renderField();
    fireEvent.click(screen.getByText("pick named"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ZOB Berlin", country: "DE" })
    );
  });

  it("keeps the country when the same point is picked again without one", () => {
    const onChange = renderField();
    fireEvent.click(screen.getByText("pick same point"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ country: "KR" }));
  });
});
