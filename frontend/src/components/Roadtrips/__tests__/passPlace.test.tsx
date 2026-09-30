import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import StationEditCard from "../StationEditCard";
import { toEditorStation, type EditorStation } from "../useStationAutosave";
import type { RoadtripStation } from "../../../types/roadtrip";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../location/LocationInput", () => ({ LocationInput: () => null }));
vi.mock("../../../hooks/usePlacesVisible", () => ({ usePlacesVisible: () => true }));
const listPlaces = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/places", () => ({ listPlaces }));

/**
 * Tester 2026-09-26: a "Durchfahrt" should pick one of the user's places, the
 * way "Unterkunft" picks a stay.
 */
const place = (id: string, name: string, lat: number, lon: number) => ({
  id,
  name,
  lat,
  lon,
  city: null,
  category: "viewpoint",
});

const PASS: EditorStation = {
  key: "k",
  id: "s1",
  title: "",
  lat: 62.4,
  lon: 7.6,
  startDate: null,
  endDate: null,
  notes: null,
  night: { kind: "pass" },
};

function renderCard(onChange = vi.fn()) {
  render(
    <StationEditCard
      station={PASS}
      position={2}
      total={3}
      tripId={null}
      lodgings={[]}
      onChange={onChange}
      onClose={vi.fn()}
    />
  );
  return onChange;
}

describe("a pass-through names a place", () => {
  // Every case sets its own answer. No `mockReset` between them: resetting a
  // mock whose rejected promise vitest still tracks reports that rejection as
  // unhandled in whichever case runs next.

  it("offers the user's places nearest first and links the one picked", async () => {
    listPlaces.mockResolvedValue([
      place("far", "Nordkapp", 71.17, 25.78),
      place("near", "Trollstigen", 62.45, 7.67),
    ]);
    const onChange = renderCard();
    const rows = await screen.findAllByRole("button", { name: /Trollstigen|Nordkapp/ });
    expect(rows.map((r) => r.textContent)).toEqual(["Trollstigen", "Nordkapp"]);
    fireEvent.click(rows[0]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        night: { kind: "pass", placeId: "near" },
        placeLabel: "Trollstigen",
        title: "Trollstigen",
      })
    );
  });

  it("finds a place beyond the nearest few by searching", async () => {
    listPlaces.mockResolvedValue([
      ...Array.from({ length: 12 }, (_, i) => place(`p${i}`, `Nah ${i}`, 62.4, 7.6 + i / 1000)),
      place("far", "Nordkapp", 71.17, 25.78),
    ]);
    renderCard();
    await screen.findByText("Nah 0");
    expect(screen.queryByText("Nordkapp")).toBeNull();
    fireEvent.change(screen.getByLabelText("roadtrips:place.search"), {
      target: { value: "nord" },
    });
    expect(screen.getByText("Nordkapp")).toBeInTheDocument();
  });

  it("says the places could not be loaded instead of offering none", async () => {
    listPlaces.mockImplementation(() => Promise.reject(new Error("places unavailable")));
    renderCard();
    expect(await screen.findByRole("alert")).toHaveTextContent("roadtrips:place.loadError");
    expect(screen.queryByText("roadtrips:place.none")).toBeNull();
  });

  it("keeps the link when a loaded station is edited and saved again", () => {
    const loaded = {
      id: "s1",
      title: "Trollstigen",
      lat: 62.45,
      lon: 7.67,
      startDate: null,
      endDate: null,
      notes: null,
      order: 1,
      state: "pass",
      lodgingStayId: null,
      placeId: "near",
      place: { id: "near", name: "Trollstigen", category: "viewpoint" },
      stay: null,
    } as RoadtripStation;
    expect(toEditorStation(loaded).night).toEqual({ kind: "pass", placeId: "near" });
    expect(toEditorStation(loaded).placeLabel).toBe("Trollstigen");
  });
});
