import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import StationEditor from "../StationEditor";
import { roadtripsApi } from "../../../lib/api/roadtrips";
import type { RoadtripStation, StationInput } from "../../../types/roadtrip";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}:${String(o.name)}` : k),
    i18n: { language: "de" },
  }),
}));
// The location search talks to a geocoder and draws a map; the editor only
// needs "a point was chosen", so the test chooses one directly.
vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({
    onChange,
  }: {
    onChange: (s: { lat: number; lon: number; name: string }) => void;
  }) => (
    <button type="button" onClick={() => onChange({ lat: 58.97, lon: 5.73, name: "Stavanger" })}>
      pick-location
    </button>
  ),
}));
vi.mock("../../../lib/api/lodging", () => ({
  listLodgings: vi.fn().mockResolvedValue([
    {
      id: "l1",
      name: "Mosvangen Camping",
      stays: [
        {
          id: "stay-1",
          checkIn: "2026-07-14T00:00:00.000Z",
          checkOut: "2026-07-16T00:00:00.000Z",
          status: "completed",
        },
      ],
    },
  ]),
  createLodging: vi.fn(),
  createStay: vi.fn(),
  deleteLodging: vi.fn(),
}));
vi.mock("../../../lib/api/roadtrips", () => ({ roadtripsApi: { replaceStations: vi.fn() } }));

const HAMBURG_ID = "11111111-1111-4111-8111-111111111111";
const HAMBURG: RoadtripStation = {
  id: HAMBURG_ID,
  title: "Hamburg",
  lat: 53.55,
  lon: 9.99,
  startDate: "2026-07-12T00:00:00.000Z",
  endDate: null,
  notes: null,
  order: 0,
  state: "pass",
  lodgingStayId: null,
  stay: null,
};

/** The server answers with every station it was sent, new ones given an id. */
function echoServer(): void {
  vi.mocked(roadtripsApi.replaceStations).mockImplementation(
    async (_id, stations: StationInput[]) => ({
      roadtrip: {} as never,
      nights: {} as never,
      legs: [],
      stations: stations.map((s, i) => ({ ...HAMBURG, ...s, id: s.id ?? `server-${i}` }) as never),
    })
  );
}

function renderEditor(start: "plain" | "new" = "plain"): void {
  render(
    <StationEditor
      routeId="rt"
      stations={[HAMBURG]}
      legs={[]}
      tripId={null}
      start={start}
      today="2026-07-14"
      onSaved={vi.fn()}
      onStatus={vi.fn()}
      onEditLeg={vi.fn()}
    />
  );
}

async function pause(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
}

function sent(call = 0): StationInput[] {
  return vi.mocked(roadtripsApi.replaceStations).mock.calls[call][1];
}

describe("StationEditor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    echoServer();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("holds a new station back until it has a place, then saves it as a free night after the pause", async () => {
    renderEditor("new");
    await pause();
    expect(roadtripsApi.replaceStations).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("pick-location"));
    expect(roadtripsApi.replaceStations).not.toHaveBeenCalled();
    await pause();

    expect(roadtripsApi.replaceStations).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual([
      expect.objectContaining({ id: HAMBURG_ID }),
      expect.objectContaining({
        title: "Stavanger",
        lat: 58.97,
        night: { kind: "free" },
        // It starts where the one before it left off.
        startDate: "2026-07-12T00:00:00.000Z",
      }),
    ]);
  });

  it("sends a burst of changes once, and a later change carries the id the server gave", async () => {
    renderEditor("new");
    fireEvent.click(screen.getByText("pick-location"));
    fireEvent.change(screen.getByLabelText("roadtrips:editor.name"), {
      target: { value: "Stavanger Hafen" },
    });
    await pause();
    expect(roadtripsApi.replaceStations).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("roadtrips:editor.name"), {
      target: { value: "Stavanger" },
    });
    await pause();
    expect(sent(1)[1]).toMatchObject({ id: "server-1", title: "Stavanger" });
  });

  it("does not save a stay night before its stay is linked", async () => {
    renderEditor("new");
    fireEvent.click(screen.getByText("pick-location"));
    fireEvent.click(screen.getByRole("radio", { name: /roadtrips:editor.choice.stay.label/ }));
    await pause();
    expect(roadtripsApi.replaceStations).not.toHaveBeenCalled();
    expect(screen.getByText("roadtrips:editor.warnings.noStay:Stavanger")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("roadtrips:stay.search"), {
      target: { value: "mos" },
    });
    await pause(); // the lodging library arrives
    fireEvent.click(screen.getByText(/Mosvangen Camping/));
    await pause();
    expect(sent()[1].night).toEqual({ kind: "stay", lodgingStayId: "stay-1" });
  });

  it("takes a removal back when asked", async () => {
    renderEditor();
    fireEvent.click(screen.getByLabelText("roadtrips:stations.remove"));
    expect(screen.getByText("roadtrips:editor.removed:Hamburg")).toBeInTheDocument();
    fireEvent.click(screen.getByText("roadtrips:editor.undo"));
    await pause();
    // The last word was "keep it": the list goes out with Hamburg in it.
    const calls = vi.mocked(roadtripsApi.replaceStations).mock.calls;
    expect(calls[calls.length - 1][1]).toEqual([expect.objectContaining({ id: HAMBURG_ID })]);
  });
});
