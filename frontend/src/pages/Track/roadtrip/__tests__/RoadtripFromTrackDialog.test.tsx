import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RoadtripFromTrackDialog from "../RoadtripFromTrackDialog";
import { travTrackRoadtripApi } from "../../../../lib/api/travtrackRoadtrip";
import { roadtripsApi } from "../../../../lib/api/roadtrips";
import { toursApi } from "../../../../lib/api/tours";

/** "Als Roadtrip übernehmen" as the user sees it: the preview, its edits, and failures as themselves. */

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../../components/FlightForm/fields/TripSelectField", () => ({
  default: () => <div data-testid="trip-select" />,
}));
vi.mock("../../../../lib/api/travtrackRoadtrip", () => ({
  travTrackRoadtripApi: { preview: vi.fn() },
}));
vi.mock("../../../../lib/api/roadtrips", () => ({
  roadtripsApi: { create: vi.fn(), replaceStations: vi.fn() },
}));
vi.mock("../../../../lib/api/tours", () => ({
  toursApi: { setLeg: vi.fn(), removeStandalone: vi.fn() },
}));

const preview = vi.mocked(travTrackRoadtripApi.preview);
const K = "track:roadtrip";
const T0 = Date.parse("2026-10-12T07:00:00Z");
const H = 3_600_000;
const st = (key: string, kind: "start" | "stop" | "end", h: number, name: string | null) => ({
  key,
  kind,
  name,
  nameSource: null,
  placeId: null,
  lat: 48 + h / 10,
  lon: 7.8,
  arriveMs: kind === "start" ? null : T0 + h * H,
  departMs: kind === "end" ? null : T0 + h * H + (kind === "stop" ? H : 0),
  dwellMs: kind === "stop" ? H : null,
});
const line = [
  [7.8, 48],
  [7.8, 48.2],
] as [number, number][];
const ready = {
  stations: [st("a", "start", 0, null), st("b", "stop", 1, "Titisee"), st("c", "end", 3, "Basel")],
  legs: [
    { fromKey: "a", toKey: "b", coordinates: line, estimated: [], distanceKm: 20, estimatedKm: 0 },
    {
      fromKey: "b",
      toKey: "c",
      coordinates: line,
      estimated: [line],
      distanceKm: 30,
      estimatedKm: 12,
    },
  ],
  distanceKm: 50,
  estimatedKm: 12,
  zone: "Europe/Berlin",
};
const days = { fromDay: "2026-10-12", toDay: "2026-10-12" };
const show = () =>
  render(
    <MemoryRouter>
      <RoadtripFromTrackDialog span={days} days={days} onClose={vi.fn()} />
    </MemoryRouter>
  );

beforeEach(() => vi.clearAllMocks());

describe("RoadtripFromTrackDialog", () => {
  it("shows each station with its time and dwell, and the estimated part of the line", async () => {
    preview.mockResolvedValue(ready);
    show();
    const rows = await screen.findAllByTestId("roadtrip-station");
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toContain('"from":"10:00","until":"11:00"');
    expect(screen.getAllByTestId("roadtrip-sketch-estimated")).toHaveLength(1);
    expect(screen.getByTestId("roadtrip-distance").textContent).toContain(`${K}.estimated`);
  });

  it("dropping the middle station leaves a two-station roadtrip with the joined distance", async () => {
    preview.mockResolvedValue(ready);
    show();
    await screen.findAllByTestId("roadtrip-station");
    await userEvent.click(screen.getByText(`${K}.drop`));
    expect(screen.getAllByTestId("roadtrip-station")).toHaveLength(2);
    expect(screen.getByTestId("roadtrip-distance").textContent).toContain('"km":"50"');
  });

  it("a span that gives nothing says why, not an empty dialog", async () => {
    preview.mockRejectedValue(
      new AxiosError("422", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 422,
        data: { code: "TRAVTRACK_ROADTRIP_PREVIEW_FAILED", reason: "tooLong" },
        statusText: "",
        headers: {},
        config: { headers: new AxiosHeaders() },
      })
    );
    show();
    expect((await screen.findByRole("alert")).textContent).toBe(`${K}.preview.tooLong`);
  });

  it("a failed save names its step and that nothing was left behind", async () => {
    preview.mockResolvedValue(ready);
    vi.mocked(roadtripsApi.create).mockResolvedValue({ id: "rt" } as never);
    vi.mocked(roadtripsApi.replaceStations).mockRejectedValue(new Error("409"));
    vi.mocked(toursApi.removeStandalone).mockResolvedValue();
    show();
    await screen.findAllByTestId("roadtrip-station");
    await userEvent.click(screen.getByTestId("roadtrip-save"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(`${K}.saveFailed.stations`)
    );
    expect(toursApi.removeStandalone).toHaveBeenCalledWith("rt");
  });
});
