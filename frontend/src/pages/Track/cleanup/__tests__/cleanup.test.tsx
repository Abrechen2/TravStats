import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TrackDayCleanup from "../TrackDayCleanup";
import TrackLegTools, { resetMapMatchingAvailability } from "../TrackLegTools";
import {
  drawnDay,
  travTrackCleanupApi,
  type TravTrackDayCleanup,
} from "../../../../lib/api/travtrackCleanup";
import type { TravTrackDay } from "../../../../lib/api/travtrack";
import type { TravTrackLeg } from "../../../../lib/api/travtrackLegs";

/** The optional cleanup of a day (rc46 extras C) as the user sees it. */

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
    i18n: { language: "de" },
  }),
}));

const axiosFail = (status: number, data: object) =>
  new AxiosError(String(status), "ERR", undefined, undefined, {
    status,
    data,
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
const cleanup = (over: Partial<TravTrackDayCleanup> = {}): TravTrackDayCleanup => ({
  smoothing: { eligible: true, on: false, from: "global", global: false, threshold: 0.5 },
  smoothed: null,
  matched: [],
  ...over,
});

describe("drawnDay", () => {
  const raw = [
    [
      [0, 50, 8, 10],
      [60_000, 50.02, 8, 10],
      [120_000, 50, 8, 10],
    ],
  ] as TravTrackDay["segments"];
  const smooth = [
    [
      [0, 50, 8, 10],
      [60_000, 50, 8, 10],
      [120_000, 50, 8, 10],
    ],
  ] as TravTrackDay["segments"];
  const day = (c?: TravTrackDayCleanup) =>
    ({ segments: raw, cleanup: c }) as unknown as TravTrackDay;

  it("draws the smoothed stretches while smoothing is on, labelled", () => {
    const out = drawnDay(day(cleanup({ smoothed: smooth })));
    expect(out.segments).toBe(smooth);
    expect(out.smoothedShown).toBe(true);
  });

  it("draws the raw read otherwise, and never a misaligned smoothing", () => {
    expect(drawnDay(day(cleanup())).segments).toBe(raw);
    expect(drawnDay(day(cleanup({ smoothed: [smooth[0].slice(0, 2)] }))).segments).toBe(raw);
  });
});

describe("TrackDayCleanup", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("is not drawn for a day with nothing to clean up", () => {
    const { container } = render(
      <TrackDayCleanup
        day={{
          date: "2026-10-12",
          cleanup: cleanup({ smoothing: { ...cleanup().smoothing, eligible: false } }),
        }}
        onChanged={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("switches smoothing for the day and for all days", async () => {
    const set = vi.spyOn(travTrackCleanupApi, "setSmoothing").mockResolvedValue();
    const changed = vi.fn();
    render(
      <TrackDayCleanup day={{ date: "2026-10-12", cleanup: cleanup() }} onChanged={changed} />
    );
    await userEvent.click(screen.getByLabelText("track:cleanup.smoothDay"));
    expect(set).toHaveBeenCalledWith({ scope: "day", date: "2026-10-12", enabled: true });
    await userEvent.click(screen.getByLabelText("track:cleanup.smoothAll"));
    expect(set).toHaveBeenLastCalledWith({ scope: "global", enabled: true });
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
  });

  it("labels a matched stretch and undoes it; a failed undo is said", async () => {
    const undo = vi.spyOn(travTrackCleanupApi, "undo").mockRejectedValueOnce(new Error("down"));
    const c = cleanup({
      matched: [
        { id: "m1", fromMs: 0, untilMs: 1, lines: [], confidence: 0.9, provider: "router.lan" },
      ],
    });
    render(<TrackDayCleanup day={{ date: "2026-10-12", cleanup: c }} onChanged={vi.fn()} />);
    expect(screen.getByText('track:cleanup.matchedLine {"provider":"router.lan"}')).toBeTruthy();
    await userEvent.click(screen.getByText("track:cleanup.undo"));
    expect(undo).toHaveBeenCalledWith("m1");
    expect((await screen.findByRole("alert")).textContent).toBe("track:cleanup.error.undoFailed");
  });
});

describe("TrackLegTools — snap to roads", () => {
  const leg = { fromMs: 1000, untilMs: 2000, mode: "car" } as TravTrackLeg;
  const show = (l = leg) =>
    render(
      <MemoryRouter>
        <TrackLegTools leg={l} zone="Europe/Berlin" onChanged={vi.fn(async () => {})} />
      </MemoryRouter>
    );

  beforeEach(() => {
    vi.restoreAllMocks();
    resetMapMatchingAvailability();
  });

  it("is not offered while the server has no router", async () => {
    const avail = vi
      .spyOn(travTrackCleanupApi, "availability")
      .mockResolvedValue({ available: false, reason: "serviceOff" });
    show();
    await waitFor(() => expect(avail).toHaveBeenCalled());
    expect(screen.queryByTestId("track-leg-match")).toBeNull();
  });

  it("is never offered for a flight", async () => {
    const avail = vi.spyOn(travTrackCleanupApi, "availability");
    show({ ...leg, mode: "flight" });
    expect(screen.queryByTestId("track-leg-match")).toBeNull();
    expect(avail).not.toHaveBeenCalled();
  });

  it("asks before sending, then shows a low-confidence answer as itself", async () => {
    vi.spyOn(travTrackCleanupApi, "availability").mockResolvedValue({
      available: true,
      reason: null,
    });
    const match = vi
      .spyOn(travTrackCleanupApi, "match")
      .mockRejectedValueOnce(
        axiosFail(409, {
          code: "CONFIRMATION_REQUIRED",
          disclosure: {
            serviceId: "mapMatching",
            host: "router.lan:8002",
            provider: "valhalla",
            location: "lan",
            fields: ["points"],
            pointCount: 40,
            privacyZonesApplied: true,
          },
        })
      )
      .mockRejectedValueOnce(axiosFail(422, { code: "MAP_MATCH_FAILED", reason: "lowConfidence" }));
    show();
    await userEvent.click(await screen.findByTestId("track-leg-match"));
    const facts = await screen.findByTestId("use-consent-facts");
    expect(facts.textContent).toContain("40");
    expect(facts.textContent).toContain("externalServices:useConsent.zonesApplied");
    expect(match).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("use-consent-always"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "track:cleanup.error.lowConfidence"
    );
    expect(match.mock.calls[1][1]).toEqual({ mode: "always", target: "valhalla@router.lan:8002" });
  });
});
