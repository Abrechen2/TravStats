import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TravTrackStop } from "../../../lib/api/travtrackLegs";
import type { Place } from "../../../types/place";

const placesApi = vi.hoisted(() => ({
  listPlaces: vi.fn(),
  getPlace: vi.fn(),
  createVisit: vi.fn(),
}));
vi.mock("../../../lib/api/places", () => placesApi);
vi.mock("../../../lib/api/travtrackLegs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/travtrackLegs")>()),
  travTrackLegsApi: { stopIdentity: vi.fn(), setStopPlace: vi.fn() },
}));
vi.mock("../../../components/places/PlaceFormModal", () => ({
  PlaceFormModal: (p: {
    initialName?: string;
    initialLocation?: { lat: number; lon: number };
    onSaved: (place: unknown) => void;
  }) => (
    <button
      data-testid="form"
      data-name={p.initialName}
      data-lat={p.initialLocation?.lat}
      onClick={() => p.onSaved({ id: "new1", name: p.initialName })}
    />
  ),
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length > 0 ? `${key} ${JSON.stringify(o)}` : key,
    i18n: { language: "de" },
  }),
}));

import TrackStopCard from "../map/TrackStopCard";

const stop: TravTrackStop = {
  fromMs: Date.UTC(2026, 9, 25, 10, 0),
  untilMs: Date.UTC(2026, 9, 25, 11, 0),
  anchor: { lat: 52.5, lon: 13.4 },
  stayRef: null,
  place: { name: "Café Einstein", lat: 52.5, lon: 13.4, source: "accepted" },
};
const place = (over: Partial<Place> = {}) =>
  ({
    id: "p1",
    name: "Café Einstein",
    lat: 52.5001,
    lon: 13.4001,
    city: "Berlin",
    visits: [],
    ...over,
  }) as unknown as Place;

const open = () => {
  render(<TrackStopCard stop={stop} zone="UTC" onClose={() => {}} onChanged={async () => {}} />);
  fireEvent.click(screen.getByTestId("track-stop-to-places-toggle"));
};

describe("TrackStopCard — In Orte übernehmen", () => {
  beforeEach(() => {
    Object.values(placesApi).forEach((f) => f.mockReset());
  });

  it("offers the own place that already carries the name instead of a second copy", async () => {
    placesApi.listPlaces.mockResolvedValue([place(), place({ id: "far", lat: 48, lon: 11 })]);
    open();
    expect(await screen.findAllByTestId("track-stop-to-places-pick")).toHaveLength(1);
  });

  it("prefills the new place form with the stop's name and position", async () => {
    placesApi.listPlaces.mockResolvedValue([]);
    open();
    fireEvent.click(await screen.findByTestId("track-stop-to-places-new"));
    expect(screen.getByTestId("form")).toHaveAttribute("data-name", "Café Einstein");
    expect(screen.getByTestId("form")).toHaveAttribute("data-lat", "52.5");
  });

  it("records no visit unless it is ticked", async () => {
    placesApi.listPlaces.mockResolvedValue([place()]);
    open();
    fireEvent.click(await screen.findByTestId("track-stop-to-places-pick"));
    fireEvent.click(screen.getByTestId("track-stop-to-places-finish"));
    expect(await screen.findByTestId("track-stop-to-places-done")).toBeInTheDocument();
    expect(placesApi.createVisit).not.toHaveBeenCalled();
  });

  it("records the visit on the stop's day when ticked, and not twice on a repeat", async () => {
    placesApi.listPlaces.mockResolvedValue([place()]);
    placesApi.getPlace.mockResolvedValueOnce(place());
    placesApi.createVisit.mockResolvedValue({});
    open();
    fireEvent.click(await screen.findByTestId("track-stop-to-places-pick"));
    fireEvent.click(screen.getByTestId("track-stop-to-places-visit"));
    fireEvent.click(screen.getByTestId("track-stop-to-places-finish"));
    await waitFor(() =>
      expect(placesApi.createVisit).toHaveBeenCalledWith("p1", { visitedAt: "2026-10-25" })
    );
  });

  it("skips the visit when the place already has one that day", async () => {
    placesApi.listPlaces.mockResolvedValue([place()]);
    placesApi.getPlace.mockResolvedValue(
      place({ visits: [{ id: "v", visitedAt: "2026-10-25" }] as unknown as Place["visits"] })
    );
    open();
    fireEvent.click(await screen.findByTestId("track-stop-to-places-pick"));
    fireEvent.click(screen.getByTestId("track-stop-to-places-visit"));
    fireEvent.click(screen.getByTestId("track-stop-to-places-finish"));
    expect(await screen.findByTestId("track-stop-to-places-done")).toHaveTextContent("visitExists");
    expect(placesApi.createVisit).not.toHaveBeenCalled();
  });

  it("says the visit could not be recorded and keeps the choice", async () => {
    placesApi.listPlaces.mockResolvedValue([place()]);
    placesApi.getPlace.mockResolvedValue(place());
    placesApi.createVisit.mockRejectedValue({ response: { status: 500, data: {} } });
    open();
    fireEvent.click(await screen.findByTestId("track-stop-to-places-pick"));
    fireEvent.click(screen.getByTestId("track-stop-to-places-visit"));
    fireEvent.click(screen.getByTestId("track-stop-to-places-finish"));
    expect(await screen.findByRole("alert")).toHaveTextContent("track:errors.generic");
    expect(screen.getByTestId("track-stop-to-places-finish")).toBeEnabled();
  });

  it("shows a failed search of the own places as itself, not as 'none nearby'", async () => {
    placesApi.listPlaces.mockRejectedValue({ response: { status: 500, data: {} } });
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("track:stop.toPlaces.searchFailed");
    expect(screen.queryByTestId("track-stop-to-places-none")).toBeNull();
  });
});
