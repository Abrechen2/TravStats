import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StayReviewCard from "../StayReviewCard";
import { dawarichStaysApi, type DawarichStay } from "../../../lib/api/dawarichStays";

/**
 * A TravTrack finding on the review card (TravTrack plan E4): it names its
 * source, says when it was made before the account's last source switch,
 * explains itself by its code, and answers the accept protocol's refusals —
 * EVIDENCE_INVALIDATED takes the card away, SUGGESTION_ACCEPT_IN_PROGRESS is
 * retried quietly, TRAVTRACK_DISABLED is said and the card stays.
 */
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("../StayIdentityPanel", () => ({ default: () => null }));
vi.mock("../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { accept: vi.fn(), reject: vi.fn() },
}));

const travtrackRow = {
  id: "finding",
  status: "pending",
  name: "Seoul stop",
  startAt: "2026-10-10T10:00:00Z",
  endAt: "2026-10-10T10:30:00Z",
  sourceStartAt: "2026-10-10T10:00:00Z",
  sourceEndAt: "2026-10-10T10:30:00Z",
  sourceLat: 37.57,
  sourceLon: 126.97,
  lat: 37.57,
  lon: 126.97,
  zone: "Asia/Seoul",
  pointCount: 4,
  placeId: null,
  tripId: null,
  visitId: null,
  visit: null,
  detectedAt: "2026-10-11T00:00:00Z",
  resolvedAt: null,
  evidence: {
    source: "travtrack",
    zone: "Asia/Seoul",
    maxGapMinutes: 10,
    uncertainties: [],
    readCoverage: "complete",
    explanation: {
      code: "stay.dwell",
      params: { minutes: 30, points: 4, radiusM: 150, maxGapMinutes: 10 },
    },
  },
} as DawarichStay;

const choices = { places: [], trips: [] };
const refusal = (code: string) => ({ response: { data: { code } } });

const mount = (row: DawarichStay = travtrackRow) => {
  const done = vi.fn();
  render(
    <MemoryRouter>
      <StayReviewCard row={row} choices={choices} onDone={done} />
    </MemoryRouter>
  );
  return done;
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("a TravTrack finding on the review card", () => {
  it("names TravTrack as its source and explains itself by its code", () => {
    mount();
    expect(screen.getByText("trips:dawarichStays.source.travtrack")).toBeInTheDocument();
    expect(
      screen.getByText(
        `trips:dawarichStays.explanation.stay.dwell ${JSON.stringify({
          minutes: 30,
          points: 4,
          radiusM: 150,
          maxGapMinutes: 10,
        })}`
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/Dawarich ·/)).not.toBeInTheDocument();
    expect(screen.queryByText("trips:dawarichStays.beforeSourceSwitch")).not.toBeInTheDocument();
  });

  it("says when it was made before the last source switch", () => {
    mount({ ...travtrackRow, beforeSourceSwitch: true });
    expect(screen.getByText("trips:dawarichStays.beforeSourceSwitch")).toBeInTheDocument();
  });

  it("a Dawarich finding shows no source line, as before", () => {
    mount({
      ...travtrackRow,
      evidence: {
        source: "dawarich",
        zone: "Asia/Seoul",
        pointIds: [1, 2, 3, 4],
        maxGapMinutes: 10,
        uncertainties: [],
      },
    });
    expect(screen.queryByText(/trips:dawarichStays\.source\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/trips:dawarichStays\.explanation\./)).not.toBeInTheDocument();
  });

  it("EVIDENCE_INVALIDATED says why and takes the card away", async () => {
    vi.mocked(dawarichStaysApi.accept).mockRejectedValue(refusal("EVIDENCE_INVALIDATED"));
    const done = mount();
    fireEvent.click(screen.getByRole("button", { name: "trips:dawarichStays.accept" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(screen.getByRole("alert")).toHaveTextContent("trips:dawarichStays.evidenceInvalidated");
  });

  it("SUGGESTION_ACCEPT_IN_PROGRESS is retried quietly", async () => {
    vi.useFakeTimers();
    vi.mocked(dawarichStaysApi.accept)
      .mockRejectedValueOnce(refusal("SUGGESTION_ACCEPT_IN_PROGRESS"))
      .mockResolvedValueOnce({} as never);
    const done = mount();
    fireEvent.click(screen.getByRole("button", { name: "trips:dawarichStays.accept" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(dawarichStaysApi.accept).toHaveBeenCalledTimes(2);
    expect(done).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("TRAVTRACK_DISABLED is said and the card stays", async () => {
    vi.mocked(dawarichStaysApi.accept).mockRejectedValue(refusal("TRAVTRACK_DISABLED"));
    const done = mount();
    fireEvent.click(screen.getByRole("button", { name: "trips:dawarichStays.accept" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "trips:dawarichStays.travTrackDisabled"
    );
    expect(done).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "trips:dawarichStays.accept" })).toBeEnabled();
  });

  it("a finding mid-accept is still offered for review", () => {
    mount({ ...travtrackRow, status: "accepting" });
    expect(screen.getByRole("button", { name: "trips:dawarichStays.accept" })).toBeInTheDocument();
  });
});
