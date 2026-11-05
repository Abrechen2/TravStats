import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TravTrackStop, TravTrackStopIdentity } from "../../../lib/api/travtrackLegs";

const legsApi = vi.hoisted(() => ({ stopIdentity: vi.fn(), setStopPlace: vi.fn() }));
vi.mock("../../../lib/api/travtrackLegs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/travtrackLegs")>()),
  travTrackLegsApi: legsApi,
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length > 0 ? `${key} ${JSON.stringify(o)}` : key,
    i18n: { language: "de" },
  }),
}));

import TrackLegList from "../TrackLegList";
import { clearStopIdentityCache, loadStopIdentity } from "../../../lib/travtrackStopIdentity";

/**
 * A stop row names its place: the probable one with "accept" and "other
 * suggestions", the accepted one from the server, and a failed lookup as itself.
 */

const stop = (over: Partial<TravTrackStop> = {}): TravTrackStop => ({
  fromMs: 1_000_000,
  untilMs: 1_000_000 + 40 * 60_000,
  anchor: { lat: 52.5, lon: 13.4 },
  stayRef: null,
  place: null,
  ...over,
});

const identity = (over: Partial<TravTrackStopIdentity> = {}): TravTrackStopIdentity => ({
  lat: 52.5,
  lon: 13.4,
  probable: { name: "Lidl", source: "nearbyPlace", photoSupported: false },
  known: [],
  geocoder: "ok",
  candidates: [
    {
      name: "Lidl",
      type: "shopping",
      address: null,
      city: null,
      lat: 52.5,
      lon: 13.4,
      distanceM: 8,
    },
    { name: "Ionity", type: "x", address: null, city: null, lat: 52.5, lon: 13.4, distanceM: 40 },
  ],
  candidatesState: "ok",
  ...over,
});

const renderList = (s: TravTrackStop) =>
  render(
    <MemoryRouter>
      <TrackLegList
        date="2026-10-25"
        zone="UTC"
        legs={[]}
        stops={[s]}
        selection={null}
        onSelect={() => {}}
      />
    </MemoryRouter>
  );

describe("TrackStopPlace in the stop row", () => {
  beforeEach(() => {
    legsApi.stopIdentity.mockReset();
    legsApi.setStopPlace.mockReset();
    clearStopIdentityCache();
  });

  it("shows the probable place, lists other suggestions and stores an accepted one", async () => {
    legsApi.stopIdentity.mockResolvedValue(identity());
    legsApi.setStopPlace.mockResolvedValue(
      stop({ place: { name: "Ionity", lat: 52.5, lon: 13.4, source: "accepted" } })
    );
    renderList(stop());
    expect(await screen.findByTestId("track-stop-place-probable")).toHaveTextContent("Lidl");
    fireEvent.click(screen.getByTestId("track-stop-place-others"));
    const buttons = screen.getAllByTestId("track-stop-place-candidate-accept");
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    await waitFor(() =>
      expect(legsApi.setStopPlace).toHaveBeenCalledWith(
        { fromMs: 1_000_000, untilMs: 1_000_000 + 40 * 60_000 },
        { name: "Ionity", lat: 52.5, lon: 13.4 }
      )
    );
    expect(await screen.findByTestId("track-stop-place-name")).toHaveTextContent("Ionity");
  });

  it("shows the name the server already holds without asking a geocoder", () => {
    renderList(stop({ place: { name: "Hotel Adlon", lat: null, lon: null, source: "accepted" } }));
    expect(screen.getByTestId("track-stop-place-name")).toHaveTextContent("Hotel Adlon");
    expect(legsApi.stopIdentity).not.toHaveBeenCalled();
  });

  it("says the lookup failed (and offers a retry) instead of showing no suggestion", async () => {
    legsApi.stopIdentity.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    legsApi.stopIdentity.mockResolvedValueOnce(identity());
    renderList(stop());
    expect(await screen.findByText("track:stop.place.failed")).toBeInTheDocument();
    fireEvent.click(screen.getByText("track:stop.place.retry"));
    expect(await screen.findByTestId("track-stop-place-probable")).toBeInTheDocument();
  });

  it("says the geocoder was unreachable rather than 'no name found'", async () => {
    legsApi.stopIdentity.mockResolvedValue(
      identity({
        probable: null,
        candidates: [],
        geocoder: "degraded",
        candidatesState: "degraded",
      })
    );
    renderList(stop());
    expect(await screen.findByTestId("track-stop-place-none")).toHaveTextContent(
      "track:stop.place.unavailable"
    );
  });

  it("shows why a name could not be saved and keeps the suggestion", async () => {
    legsApi.stopIdentity.mockResolvedValue(identity());
    legsApi.setStopPlace.mockRejectedValue({ response: { status: 500, data: {} } });
    renderList(stop());
    fireEvent.click(await screen.findByTestId("track-stop-place-accept"));
    expect(await screen.findByRole("alert")).toHaveTextContent("track:errors.generic");
    expect(screen.getByTestId("track-stop-place-probable")).toBeInTheDocument();
  });
});

describe("TrackStopPlace — review fixes", () => {
  beforeEach(() => {
    legsApi.stopIdentity.mockReset();
    legsApi.setStopPlace.mockReset();
    clearStopIdentityCache();
  });

  it("an answer still in flight when the account signs out is not kept for the next account", async () => {
    let resolve!: (i: TravTrackStopIdentity) => void;
    legsApi.stopIdentity.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const first = loadStopIdentity(stop());
    clearStopIdentityCache();
    resolve(identity());
    await first;
    legsApi.stopIdentity.mockResolvedValueOnce(identity({ probable: null }));
    expect((await loadStopIdentity(stop())).probable).toBeNull();
    expect(legsApi.stopIdentity).toHaveBeenCalledTimes(2);
  });

  it("'Andere Vorschläge' lists every known place of the owner, then the geocoder's", async () => {
    legsApi.stopIdentity.mockResolvedValue(
      identity({
        probable: { name: "Home", source: "known", photoSupported: false },
        known: [
          { name: "Home", kind: "place", distanceM: 5, lat: 52.5, lon: 13.4 },
          { name: "Garage", kind: "place", distanceM: 30, lat: 52.5, lon: 13.4 },
        ],
      })
    );
    renderList(stop());
    fireEvent.click(await screen.findByTestId("track-stop-place-others"));
    const text = screen.getByTestId("track-stop-place-candidates").textContent ?? "";
    expect(text.indexOf("Home")).toBeLessThan(text.indexOf("Garage"));
    expect(text.indexOf("Garage")).toBeLessThan(text.indexOf("Lidl"));
  });

  it("a stop that no longer exists (404) reads the day again", async () => {
    legsApi.stopIdentity.mockResolvedValue(identity());
    legsApi.setStopPlace.mockRejectedValue({
      response: { status: 404, data: { code: "TRAVTRACK_STOP_NOT_FOUND" } },
    });
    const onChanged = vi.fn();
    render(
      <MemoryRouter>
        <TrackLegList
          date="2026-10-25"
          zone="UTC"
          legs={[]}
          stops={[stop()]}
          selection={null}
          onSelect={() => {}}
          onStopPlaceChanged={onChanged}
        />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByTestId("track-stop-place-accept"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.getByRole("alert")).toHaveTextContent("track:errors.stopGone");
  });

  it("a partly failed lookup says so, not 'no suggestion possible' beside an accept button", async () => {
    legsApi.stopIdentity.mockResolvedValue(identity({ candidatesState: "degraded" }));
    renderList(stop());
    expect(await screen.findByTestId("track-stop-place-degraded")).toHaveTextContent(
      "track:stop.place.partial"
    );
    expect(screen.getByTestId("track-stop-place-accept")).toBeInTheDocument();
  });

  it("with stay suggestions off and no known place it says so, not 'no name found'", async () => {
    legsApi.stopIdentity.mockResolvedValue(
      identity({ probable: null, candidates: [], candidatesState: "empty", lookup: "off" })
    );
    renderList(stop());
    expect(await screen.findByTestId("track-stop-place-none")).toHaveTextContent(
      "track:stop.place.suggestionsOff"
    );
  });

  it("with stay suggestions off a known place is still offered to accept", async () => {
    legsApi.stopIdentity.mockResolvedValue(
      identity({
        probable: { name: "Home", source: "known", photoSupported: false },
        known: [{ name: "Home", kind: "place", distanceM: 20, lat: 52.5, lon: 13.4 }],
        candidates: [],
        candidatesState: "empty",
        lookup: "off",
      })
    );
    renderList(stop());
    expect(await screen.findByTestId("track-stop-place-accept")).toBeInTheDocument();
  });
});
