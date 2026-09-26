import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import type { CruiseTrackOverview } from "../../../types/cruiseTracks";

/**
 * The cruise recordings section words the SERVER's verdict per leg — it never
 * decides coverage itself — and offers a recording only where one would help.
 */

const overviewMock = vi.fn();
const uploadMock = vi.fn();
const pullMock = vi.fn();
const removeMock = vi.fn();
const settingsMock = vi.fn();
const addToast = vi.fn();

vi.mock("../../../lib/api/cruiseTracks", () => ({
  cruiseTracksApi: {
    overview: (...a: unknown[]) => overviewMock(...a),
    upload: (...a: unknown[]) => uploadMock(...a),
    pullDawarich: (...a: unknown[]) => pullMock(...a),
    remove: (...a: unknown[]) => removeMock(...a),
  },
}));

vi.mock("../../../lib/api/dawarich", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api/dawarich")>()),
  dawarichApi: { getSettings: () => settingsMock() },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.count !== undefined ? `${k}:${o.count}` : k),
    i18n: { language: "de" },
  }),
}));

vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));

import CruiseTracksPanel from "../CruiseTracksPanel";

const OVERVIEW: CruiseTrackOverview = {
  window: { startAt: "2026-05-31T10:00:00.000Z", endAt: "2026-06-04T14:00:00.000Z" },
  tracks: [
    {
      id: "t1",
      cruiseId: "c1",
      source: "gpx",
      name: "Nordsee",
      startedAt: "2026-06-02T08:00:00.000Z",
      endedAt: "2026-06-03T08:00:00.000Z",
      pointCount: 900,
      distanceKm: 230,
      truncated: false,
      externalRef: null,
      createdAt: "2026-06-05T08:00:00.000Z",
      coveredLegs: [1],
    },
  ],
  legs: [
    {
      ordinal: 0,
      fromPortId: 1,
      toPortId: 2,
      fromPortName: "Kiel",
      toPortName: "Oslo",
      distanceKm: 480,
      geometrySource: "sea_route",
      coverage: { trackId: "t1", status: "notCovered", reason: "missesFrom" },
      window: { startAt: "2026-05-31T10:00:00.000Z", endAt: "2026-06-03T14:00:00.000Z" },
    },
    {
      ordinal: 1,
      fromPortId: 2,
      toPortId: 3,
      fromPortName: "Oslo",
      toPortName: "Kopenhagen",
      distanceKm: 512,
      geometrySource: "track",
      coverage: { trackId: "t1", status: "covered", reason: "complete" },
      window: null,
    },
  ],
};

describe("CruiseTracksPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    overviewMock.mockResolvedValue(OVERVIEW);
    settingsMock.mockResolvedValue({ hasAccess: false });
  });

  it("shows each leg's source and the server's verdict, and offers a track only where none is used", async () => {
    render(<CruiseTracksPanel cruiseId="c1" onChanged={vi.fn()} />);
    const first = await screen.findByTestId("cruise-leg-0");
    expect(within(first).getByText("tracks.source.sea_route")).toBeTruthy();
    expect(within(first).getByText("tracks.verdict.missesFrom")).toBeTruthy();
    expect(within(first).getByText("tracks.addToLeg")).toBeTruthy();

    const second = screen.getByTestId("cruise-leg-1");
    expect(within(second).getByText("tracks.source.track")).toBeTruthy();
    expect(within(second).getByText("tracks.verdict.complete")).toBeTruthy();
    expect(within(second).queryByText("tracks.addToLeg")).toBeNull();

    expect(screen.getByText("tracks.coversLegs:1")).toBeTruthy();
  });

  // Browser acceptance 2026-09-26: a leg without a computed row showed
  // "Berechnete Seeroute" and no kilometres — a claim nothing had made.
  it("does not call a leg computed before it has been", async () => {
    overviewMock.mockResolvedValue({
      ...OVERVIEW,
      legs: [{ ...OVERVIEW.legs[0], distanceKm: null, coverage: null }],
    });
    render(<CruiseTracksPanel cruiseId="c1" onChanged={vi.fn()} />);
    const leg = await screen.findByTestId("cruise-leg-0");
    expect(within(leg).getByText("tracks.source.pending")).toBeTruthy();
    expect(within(leg).queryByText("tracks.source.sea_route")).toBeNull();
    expect(within(leg).queryByText(/km/)).toBeNull();
  });

  it("does not offer a Dawarich pull that can only fail", async () => {
    render(<CruiseTracksPanel cruiseId="c1" onChanged={vi.fn()} />);
    await screen.findByTestId("cruise-leg-0");
    const pull = screen.getByText("tracks.pullLeg").closest("button")!;
    expect(pull.disabled).toBe(true);
  });

  it("pulls one leg's window when Dawarich is connected, then re-reads", async () => {
    settingsMock.mockResolvedValue({ hasAccess: true });
    pullMock.mockResolvedValue("t2");
    const onChanged = vi.fn();
    render(<CruiseTracksPanel cruiseId="c1" onChanged={onChanged} />);
    await screen.findByTestId("cruise-leg-0");
    const pull = screen.getByText("tracks.pullLeg").closest("button")!;
    await waitFor(() => expect(pull.disabled).toBe(false));
    fireEvent.click(pull);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(pullMock).toHaveBeenCalledWith("c1", 0);
    expect(overviewMock).toHaveBeenCalledTimes(2);
  });

  it("uploads a file and tells the page the legs changed", async () => {
    uploadMock.mockResolvedValue("t2");
    const onChanged = vi.fn();
    render(<CruiseTracksPanel cruiseId="c1" onChanged={onChanged} />);
    await screen.findByTestId("cruise-leg-0");
    const file = new File(["<gpx/>"], "voyage.gpx");
    fireEvent.change(screen.getByTestId("cruise-track-upload"), { target: { files: [file] } });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(uploadMock).toHaveBeenCalledWith("c1", file);
  });

  // The server's English sentence never reaches the German page: a refusal
  // carries a stable code, and each code has its own DE/EN sentence.
  it("words a refused upload by its code, not the server's prose", async () => {
    uploadMock.mockRejectedValue({
      response: {
        status: 400,
        data: { error: "This recording has no timestamps", code: "TRACK_NO_TIMESTAMPS" },
      },
    });
    render(<CruiseTracksPanel cruiseId="c1" onChanged={vi.fn()} />);
    await screen.findByTestId("cruise-leg-0");
    fireEvent.change(screen.getByTestId("cruise-track-upload"), {
      target: { files: [new File(["x"], "a.gpx")] },
    });
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "trips:tours.tracks.errors.noTimestamps")
    );
  });

  it("names the cruise, not a tour, for a recording imported twice", async () => {
    uploadMock.mockRejectedValue({
      response: { status: 409, data: { error: "dup", code: "TRACK_ALREADY_IMPORTED" } },
    });
    render(<CruiseTracksPanel cruiseId="c1" onChanged={vi.fn()} />);
    await screen.findByTestId("cruise-leg-0");
    fireEvent.change(screen.getByTestId("cruise-track-upload"), {
      target: { files: [new File(["x"], "a.gpx")] },
    });
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "cruise:tracks.alreadyImported")
    );
  });

  it("asks before removing a recording", async () => {
    removeMock.mockResolvedValue(undefined);
    render(<CruiseTracksPanel cruiseId="c1" onChanged={vi.fn()} />);
    await screen.findByTestId("cruise-leg-0");
    fireEvent.click(screen.getByText("tracks.remove"));
    expect(removeMock).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("tracks.remove"));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith("c1", "t1"));
  });

  it("says the list failed rather than showing an empty one", async () => {
    overviewMock.mockRejectedValue(new Error("offline"));
    render(<CruiseTracksPanel cruiseId="c1" onChanged={vi.fn()} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("tracks.empty")).toBeNull();
  });
});
