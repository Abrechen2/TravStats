import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({
    onChange,
  }: {
    onChange: (s: { lat: number; lon: number; name?: string }) => void;
  }) => (
    <button type="button" onClick={() => onChange({ lat: 35.68, lon: 139.77, name: "Tokyo" })}>
      geocoder
    </button>
  ),
}));
const searchStations = vi.fn();
vi.mock("../../../lib/api/rail", () => ({
  railApi: { searchStations: (...a: unknown[]) => searchStations(...a) },
}));

import { StationPicker } from "../StationPicker";
import { EMPTY_STATION, type RailStationDraft } from "../RailStationField";

const ZURICH = {
  id: 1,
  name: "Zürich HB",
  uic: "8503000",
  dbId: "8503000",
  lat: 47.378177,
  lon: 8.540192,
  country: "CH",
  timezone: "Europe/Zurich",
};

/** The picker with its value held like the form holds it; every change is recorded. */
function Harness({
  initial = EMPTY_STATION,
  changes,
}: {
  initial?: RailStationDraft;
  changes: RailStationDraft[];
}): JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <StationPicker
      label="Ab"
      idPrefix="dep"
      value={value}
      inputClassName=""
      onChange={(next) => {
        changes.push(next);
        setValue(next);
      }}
    />
  );
}

describe("StationPicker", () => {
  beforeEach(() => {
    searchStations.mockReset();
  });

  it("searches the catalogue and takes a pick over with its id, code and country", async () => {
    searchStations.mockResolvedValue([ZURICH]);
    const changes: RailStationDraft[] = [];
    render(<Harness changes={changes} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zurich hb" } });
    fireEvent.click(await screen.findByRole("button", { name: /Zürich HB/ }));

    expect(searchStations).toHaveBeenCalledWith("zurich hb");
    expect(changes[changes.length - 1]).toEqual({
      name: "Zürich HB",
      lat: 47.378177,
      lon: 8.540192,
      country: "CH",
      code: "8503000",
      stationId: 1,
    });
    expect(screen.getByRole("combobox")).toHaveValue("Zürich HB");
    // Showing the pick is not a new search.
    expect(searchStations).toHaveBeenCalledTimes(1);
  });

  it("forgets the picked station as soon as the text changes — no old pin under a new name", async () => {
    const changes: RailStationDraft[] = [];
    render(
      <Harness
        changes={changes}
        initial={{ ...EMPTY_STATION, name: "Zürich HB", lat: 47.37, lon: 8.54, stationId: 1 }}
      />
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Zürich H" } });
    expect(changes[changes.length - 1]).toEqual({ ...EMPTY_STATION, name: "Zürich H" });
  });

  it("does not ask for one letter", async () => {
    render(<Harness changes={[]} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "z" } });
    await new Promise((r) => setTimeout(r, 400));
    expect(searchStations).not.toHaveBeenCalled();
  });

  it("says when the search failed instead of showing an empty catalogue", async () => {
    searchStations.mockRejectedValue(new Error("offline"));
    render(<Harness changes={[]} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "basel" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("rail:station.searchError");
  });

  it("offers the geocoder for a station the catalogue does not know, with no catalogue id", async () => {
    searchStations.mockResolvedValue([]);
    const changes: RailStationDraft[] = [];
    render(<Harness changes={changes} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "tokyo" } });
    expect(await screen.findByText("rail:station.noHits")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "rail:station.useGeocoder" }));
    fireEvent.click(screen.getByRole("button", { name: "geocoder" }));
    await waitFor(() =>
      expect(changes[changes.length - 1]).toMatchObject({
        lat: 35.68,
        lon: 139.77,
        stationId: null,
        code: null,
      })
    );
  });

  it("opens an existing geocoder station in the geocoder, not as an empty search", () => {
    render(
      <Harness
        changes={[]}
        initial={{ ...EMPTY_STATION, name: "Tokyo", lat: 35.68, lon: 139.77 }}
      />
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.getByRole("button", { name: "rail:station.backToCatalogue" })
    ).toBeInTheDocument();
  });
});
