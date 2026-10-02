import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import StationTimeline from "../StationTimeline";
import { toEditorStation } from "../useStationAutosave";
import { isSavable, stationWarnings } from "../../../lib/roadtrip/roadtripView";
import TourPointEditor from "../../Trips/TourPointEditor";
import type { RoadtripStation } from "../../../types/roadtrip";
import type { TourLeg } from "../../../types/tour";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && "n" in o ? `${k}:${String(o.n)}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({ idPrefix }: { idPrefix: string }) => <span data-testid={idPrefix} />,
}));

/**
 * Route corrections (tester 2026-09-26, "Streckenkorrektur"): a nameless point
 * the route is bent through. The traveller sees stations; the correction only
 * shapes the line and the kilometres between them.
 */
const station = (id: string, over: Partial<RoadtripStation> = {}): RoadtripStation => ({
  id,
  title: id,
  lat: 56,
  lon: 9,
  startDate: null,
  endDate: null,
  notes: null,
  order: 0,
  state: "pass",
  lodgingStayId: null,
  stay: null,
  ...over,
});
const leg = (from: string, to: string, km: number): TourLeg => ({
  id: `${from}-${to}`,
  fromStopId: from,
  toStopId: to,
  distanceKm: km,
  source: "routed",
  mode: "road",
  confidence: "high",
  waypoints: null,
  drivingMinutes: null,
});

describe("a route correction", () => {
  it("is not listed as a station, and the leg across it is one leg with the whole distance", () => {
    render(
      <MemoryRouter>
        <StationTimeline
          stations={[
            station("Hamburg"),
            station("v", { title: "", state: "via" }),
            station("Hirtshals"),
          ]}
          legs={[leg("Hamburg", "v", 300), leg("v", "Hirtshals", 120)]}
          tours={[]}
          startDate={null}
          today="2026-09-27"
          selectedId={null}
          onSelect={vi.fn()}
        />
      </MemoryRouter>
    );
    expect(
      screen.getAllByRole("button", { name: /Hamburg|Hirtshals|roadtrips/ }).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText("roadtrips:editor.unnamed")).toBeNull();
    expect(screen.getByText(/^420 km/)).toBeInTheDocument();
  });

  it("stays a correction when the editor loads and saves it again", () => {
    const draft = toEditorStation(station("v", { title: "", state: "via" }));
    expect(draft.night).toEqual({ kind: "via" });
    // No name is needed, and it holds no save back.
    expect(isSavable(draft)).toBe(true);
    expect(stationWarnings([draft])).toEqual([]);
  });

  it("is a switch in the point editor that lets a point go without a name", () => {
    const onSave = vi.fn();
    render(
      <TourPointEditor
        points={[
          { id: "a", title: "Gjendesheim", lat: 61.49, lon: 8.8 },
          { id: "b", title: "", lat: 61.5, lon: 8.76 },
          { id: "c", title: "Memurubu", lat: 61.5, lon: 8.73 },
        ]}
        saving={false}
        onSave={onSave}
      />
    );
    const save = screen.getByText("trips:tours.points.save");
    expect(save).toBeDisabled();
    fireEvent.click(screen.getAllByRole("switch", { name: "trips:tours.points.via" })[1]);
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    expect(onSave.mock.calls[0][0].map((p: { via?: boolean }) => p.via ?? false)).toEqual([
      false,
      true,
      false,
    ]);
  });
});
