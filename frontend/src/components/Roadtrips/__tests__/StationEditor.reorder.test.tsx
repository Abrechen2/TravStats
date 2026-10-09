import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import StationEditor from "../StationEditor";
import { roadtripsApi } from "../../../lib/api/roadtrips";
import type { RoadtripStation, StationInput } from "../../../types/roadtrip";
import type { TourLeg } from "../../../types/tour";

/**
 * forgejo#242: an arrow press used to reorder at once and the next autosave
 * deleted every leg on either side — a recorded or hand-drawn line with them.
 * Now the move is asked first, with its consequences, and held for the undo.
 */
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}:${String(o.name)}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../location/LocationInput", () => ({ LocationInput: () => <div /> }));
vi.mock("../../../lib/api/lodging", () => ({
  listLodgings: vi.fn().mockResolvedValue([]),
  createLodging: vi.fn(),
  createStay: vi.fn(),
  deleteLodging: vi.fn(),
}));
vi.mock("../../../lib/api/roadtrips", () => ({
  roadtripsApi: { replaceStations: vi.fn(), get: vi.fn() },
}));

const id = (n: number): string => `0000000${n}-0000-4000-8000-000000000000`;
const station = (n: number, title: string, day: string): RoadtripStation => ({
  id: id(n),
  title,
  lat: 60 + n,
  lon: 5,
  startDate: `${day}T00:00:00.000Z`,
  endDate: null,
  notes: null,
  order: n,
  state: "pass",
  lodgingStayId: null,
  stay: null,
});
const STATIONS = [
  station(1, "Bergen", "2026-07-10"),
  station(2, "Voss", "2026-07-11"),
  station(3, "Flåm", "2026-07-12"),
];
const leg = (a: number, b: number, source: TourLeg["source"]): TourLeg => ({
  id: `leg-${a}-${b}`,
  fromStopId: id(a),
  toStopId: id(b),
  distanceKm: 100,
  source,
  mode: "road",
  confidence: "high",
  waypoints: null,
  drivingMinutes: null,
});
const LEGS = [leg(1, 2, "track"), leg(2, 3, "routed")];

function renderEditor(): void {
  render(
    <StationEditor
      routeId="rt"
      stations={STATIONS}
      legs={LEGS}
      tripId={null}
      start="plain"
      today="2026-07-14"
      onSaved={vi.fn()}
      onStatus={vi.fn()}
      onEditLeg={vi.fn()}
    />
  );
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const sentTitles = (): string[] => {
  const calls = vi.mocked(roadtripsApi.replaceStations).mock.calls;
  return calls[calls.length - 1][1].map((s: StationInput) => s.title);
};

/** The "move up" arrow of the station with this title. */
const moveUp = (title: string): HTMLElement =>
  within(screen.getByText(title).closest("div") as HTMLElement).getByLabelText(
    "roadtrips:stations.moveUp"
  );

describe("StationEditor — reordering (forgejo#242)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(roadtripsApi.replaceStations).mockImplementation(
      async (_r, list: StationInput[]) => ({
        roadtrip: {} as never,
        nights: {} as never,
        legs: [],
        stations: list.map((s, i) => ({ ...STATIONS[0], ...s, id: s.id ?? `n${i}` }) as never),
      })
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("asks before moving, naming neighbours, dropped legs with their recording, and date conflicts", async () => {
    renderEditor();
    await wait(0);
    fireEvent.click(moveUp("Voss"));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("roadtrips:reorder.title:Voss");
    expect(dialog).toHaveTextContent("roadtrips:reorder.first");
    // The recorded leg Bergen → Voss is named as recorded and as lost.
    const recorded = dialog.querySelector('[data-protected="true"]') as HTMLElement;
    expect(recorded).toHaveTextContent("Bergen → Voss");
    expect(recorded).toHaveTextContent("roadtrips:reorder.source.track");
    expect(recorded).toHaveTextContent("roadtrips:reorder.lossTrack");
    // Bergen (10th) now sits behind Voss (11th).
    expect(within(dialog).getByRole("alert")).toHaveTextContent("roadtrips:reorder.dateConflict");
    // The confirm says what it costs.
    expect(within(dialog).getByText("roadtrips:reorder.confirmLoss")).toBeInTheDocument();
  });

  it("changes nothing when the question is cancelled", async () => {
    renderEditor();
    await wait(0);
    fireEvent.click(moveUp("Voss"));
    fireEvent.click(screen.getByText("common:buttons.cancel"));
    await wait(9000);
    expect(roadtripsApi.replaceStations).not.toHaveBeenCalled();
    expect(screen.getAllByText(/^(Bergen|Voss|Flåm)$/).map((el) => el.textContent)).toEqual([
      "Bergen",
      "Voss",
      "Flåm",
    ]);
  });

  it("holds the move for the undo window, so undo brings the legs back too", async () => {
    renderEditor();
    await wait(0);
    fireEvent.click(moveUp("Voss"));
    fireEvent.click(screen.getByText("roadtrips:reorder.confirmLoss"));
    await wait(2000);
    // Nothing sent yet: the server still holds Bergen → Voss and its recording.
    expect(roadtripsApi.replaceStations).not.toHaveBeenCalled();
    expect(screen.getByText("roadtrips:editor.moved:Voss")).toBeInTheDocument();
    expect(screen.getByText("roadtrips:editor.movedRestores")).toBeInTheDocument();

    fireEvent.click(screen.getByText("roadtrips:editor.undo"));
    await wait(800);
    expect(sentTitles()).toEqual(["Bergen", "Voss", "Flåm"]);
  });

  it("sends the move once the undo window has passed", async () => {
    renderEditor();
    await wait(0);
    fireEvent.click(moveUp("Voss"));
    fireEvent.click(screen.getByText("roadtrips:reorder.confirmLoss"));
    await wait(8800);
    expect(roadtripsApi.replaceStations).toHaveBeenCalledTimes(1);
    expect(sentTitles()).toEqual(["Voss", "Bergen", "Flåm"]);
  });

  it("marks a leg's line as recorded in the editor, not only in the timeline", async () => {
    renderEditor();
    await wait(0);
    expect(screen.getAllByText("roadtrips:timeline.source.track").length).toBeGreaterThan(0);
  });
});
