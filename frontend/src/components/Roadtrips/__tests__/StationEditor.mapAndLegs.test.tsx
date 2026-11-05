import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import StationEditor from "../StationEditor";
import { roadtripsApi } from "../../../lib/api/roadtrips";
import { reversePlaces } from "../../../lib/api/geo";
import { toursApi } from "../../../lib/api/tours";
import type { RoadtripStation, StationInput } from "../../../types/roadtrip";
import type { TourLeg } from "../../../types/tour";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../location/LocationInput", () => ({ LocationInput: () => null }));
vi.mock("../../../lib/api/lodging", () => ({
  listLodgings: vi.fn().mockResolvedValue([]),
  createLodging: vi.fn(),
  createStay: vi.fn(),
  deleteLodging: vi.fn(),
}));
vi.mock("../../../lib/api/roadtrips", () => ({ roadtripsApi: { replaceStations: vi.fn() } }));
vi.mock("../../../lib/api/geo", () => ({ reversePlaces: vi.fn() }));
vi.mock("../../../lib/api/tours", () => ({
  toursApi: { setLeg: vi.fn(), routeLeg: vi.fn() },
}));

const A_ID = "11111111-1111-4111-8111-111111111111";
const B_ID = "22222222-2222-4222-8222-222222222222";
const base = {
  notes: null,
  lodgingStayId: null,
  stay: null,
  endDate: null,
} satisfies Partial<RoadtripStation>;
const HAMBURG: RoadtripStation = {
  ...base,
  id: A_ID,
  title: "Hamburg",
  lat: 53.55,
  lon: 9.99,
  startDate: "2026-07-12T00:00:00.000Z",
  order: 0,
  state: "pass",
};
const FREE: RoadtripStation = {
  ...base,
  id: B_ID,
  title: "Stellplatz",
  lat: 54.1,
  lon: 10.1,
  startDate: "2026-07-12T00:00:00.000Z",
  endDate: "2026-07-14T00:00:00.000Z",
  order: 1,
  state: "free",
};

const leg = (patch: Partial<TourLeg> = {}): TourLeg => ({
  id: "leg",
  fromStopId: A_ID,
  toStopId: B_ID,
  distanceKm: 100,
  source: "routed",
  mode: "road",
  confidence: "high",
  waypoints: null,
  drivingMinutes: null,
  ...patch,
});

const onEditLeg = vi.fn();
const onLegChanged = vi.fn();

function renderEditor(
  props: Partial<React.ComponentProps<typeof StationEditor>> = {},
  stations = [HAMBURG, FREE]
): ReturnType<typeof render> {
  return render(
    <StationEditor
      routeId="rt"
      stations={stations}
      legs={[]}
      tripId={null}
      start="plain"
      today="2026-07-14"
      onSaved={vi.fn()}
      onStatus={vi.fn()}
      onEditLeg={onEditLeg}
      onLegChanged={onLegChanged}
      routingAvailable
      {...props}
    />
  );
}

async function settle(ms = 50): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("StationEditor — nights from derived data", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(roadtripsApi.replaceStations).mockResolvedValue({
      roadtrip: {} as never,
      nights: {} as never,
      legs: [],
      stations: [],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("counts the nights of the stations as drafted, and moves when a date moves", async () => {
    renderEditor();
    await settle();
    // Two days between arrival and departure at a free station: two nights.
    expect(screen.getByTestId("editor-nights").textContent).toContain('"count":2');
    expect(screen.getByText(/editor\.nightsChip:\{"count":2\}/)).toBeInTheDocument();
  });
});

describe("StationEditor — add a station from the map", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(roadtripsApi.replaceStations).mockImplementation(
      async (_id, stations: StationInput[]) => ({
        roadtrip: {} as never,
        nights: {} as never,
        legs: [],
        stations: stations.map((s, i) => ({ ...HAMBURG, ...s, id: s.id ?? `s-${i}` }) as never),
      })
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("names a clicked point from the reverse lookup and saves it as a station", async () => {
    vi.mocked(reversePlaces).mockResolvedValue({
      results: [{ name: "Mosvangen Camping", lat: 58.95, lon: 5.72 }],
      degraded: false,
    });
    renderEditor({ mapPick: { nonce: 1, lat: 58.95, lon: 5.72 } }, [HAMBURG]);
    await settle();
    expect(reversePlaces).toHaveBeenCalledWith(58.95, 5.72, "de");
    expect(screen.queryByRole("alert")).toBeNull();
    await settle(900);
    const sent = vi.mocked(roadtripsApi.replaceStations).mock.calls[0][1];
    expect(sent[1]).toEqual(
      expect.objectContaining({ title: "Mosvangen Camping", lat: 58.95, lon: 5.72 })
    );
  });

  it("keeps both points when a second click comes while the first lookup is still running", async () => {
    let release: (v: { results: never[]; degraded: boolean }) => void = () => {};
    vi.mocked(reversePlaces)
      .mockImplementationOnce(() => new Promise((r) => (release = r as typeof release)))
      .mockResolvedValueOnce({ results: [{ name: "Zweiter", lat: 2, lon: 2 }], degraded: false });
    const view = renderEditor({ mapPick: { nonce: 1, lat: 1, lon: 1 } }, [HAMBURG]);
    await settle();
    view.rerender(
      <StationEditor
        routeId="rt"
        stations={[HAMBURG]}
        legs={[]}
        tripId={null}
        start="plain"
        today="2026-07-14"
        onSaved={vi.fn()}
        onStatus={vi.fn()}
        onEditLeg={onEditLeg}
        mapPick={{ nonce: 2, lat: 2, lon: 2 }}
      />
    );
    await settle();
    release({ results: [], degraded: true });
    await settle();
    expect(screen.getAllByText(/roadtrips:editor\.stationOf/).slice(-1)[0]?.textContent).toContain(
      '"total":3'
    );
  });

  it("says so when the name lookup is unreachable — the point is kept, never a silent nameless pin", async () => {
    vi.mocked(reversePlaces).mockResolvedValue({ results: [], degraded: true });
    renderEditor({ mapPick: { nonce: 1, lat: 58.95, lon: 5.72 } }, [HAMBURG]);
    await settle();
    expect(screen.getByRole("alert").textContent).toBe("roadtrips:editor.mapAdd.failed");
    // The station exists, on the clicked point, waiting for its name: nothing is sent.
    expect(screen.getByLabelText(/roadtrips:editor\.name/)).toHaveValue("");
    await settle(900);
    expect(roadtripsApi.replaceStations).not.toHaveBeenCalled();
  });

  it("says so when the lookup request itself throws", async () => {
    vi.mocked(reversePlaces).mockRejectedValue(new Error("boom"));
    renderEditor({ mapPick: { nonce: 1, lat: 1, lon: 2 } }, [HAMBURG]);
    await settle();
    expect(screen.getByRole("alert").textContent).toBe("roadtrips:editor.mapAdd.failed");
  });

  it("says that nothing is named there when the lookup answers empty", async () => {
    vi.mocked(reversePlaces).mockResolvedValue({ results: [], degraded: false });
    renderEditor({ mapPick: { nonce: 1, lat: 1, lon: 2 } }, [HAMBURG]);
    await settle();
    expect(screen.getByRole("alert").textContent).toBe("roadtrips:editor.mapAdd.noName");
  });
});

describe("StationEditor — leg transport chips", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(toursApi.setLeg).mockResolvedValue({} as never);
    vi.mocked(toursApi.routeLeg).mockResolvedValue({ fallbackReason: null } as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("switches a routed road leg to a ferry in one tap (straight, ferry)", async () => {
    renderEditor({ legs: [leg()] });
    fireEvent.click(screen.getByText("roadtrips:editor.legMode.ferry"));
    await settle();
    expect(toursApi.setLeg).toHaveBeenCalledWith(undefined, "rt", A_ID, B_ID, {
      source: "straight",
      mode: "ferry",
    });
    expect(toursApi.routeLeg).not.toHaveBeenCalled();
    expect(onLegChanged).toHaveBeenCalled();
  });

  it("routes a ferry leg again when it becomes a road leg, and says so when routing fails", async () => {
    vi.mocked(toursApi.routeLeg).mockResolvedValue({ fallbackReason: "no_route" } as never);
    renderEditor({ legs: [leg({ mode: "ferry", source: "routed" })] });
    fireEvent.click(screen.getByText("roadtrips:editor.legMode.road"));
    await settle();
    expect(toursApi.routeLeg).toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("roadtrips:editor.legMode.routeFailed");
  });

  it("routes a straight ferry leg when it becomes a road leg (road → ferry → road keeps its road)", async () => {
    renderEditor({ legs: [leg({ mode: "ferry", source: "straight" })] });
    fireEvent.click(screen.getByText("roadtrips:editor.legMode.road"));
    await settle();
    expect(toursApi.routeLeg).toHaveBeenCalled();
  });

  it("never replaces a recorded line from a chip: it opens the leg dialog instead", async () => {
    renderEditor({ legs: [leg({ source: "track" })] });
    fireEvent.click(screen.getByText("roadtrips:editor.legMode.ferry"));
    await settle();
    expect(toursApi.setLeg).not.toHaveBeenCalled();
    expect(onEditLeg).toHaveBeenCalled();
  });

  it("shows a failed save of the transport instead of swallowing it", async () => {
    vi.mocked(toursApi.setLeg).mockRejectedValue(new Error("nope"));
    renderEditor({ legs: [leg()] });
    fireEvent.click(screen.getByText("roadtrips:editor.legMode.ferry"));
    await settle();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onLegChanged).not.toHaveBeenCalled();
  });
});
