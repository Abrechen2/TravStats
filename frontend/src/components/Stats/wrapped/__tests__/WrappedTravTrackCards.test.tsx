import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { WrappedTravTrack } from "../../../../types/wrapped";
import WrappedTravTrackCards from "../WrappedTravTrackCards";

/**
 * forgejo#400 — the year's TravTrack cards abstain figure by figure: no
 * believable top speed or height draws no card, and unmeasurable kilometres
 * are said so instead of printing 0.
 */

const base: WrappedTravTrack = {
  kmGround: 812.4,
  daysRecorded: 41,
  topSpeedKmh: 142,
  highestPointM: 2210,
  byMotion: [
    { motion: "walking", hours: 30.5, km: 150 },
    { motion: "stationary", hours: 900, km: 0 },
  ],
};

const renderCards = (data: WrappedTravTrack): void => {
  render(
    <MemoryRouter>
      <WrappedTravTrackCards data={data} count={(n) => String(n)} year={2026} />
    </MemoryRouter>
  );
};

describe("WrappedTravTrackCards", () => {
  it("draws days, top speed, highest point and the moving classes only", () => {
    renderCards(base);
    expect(screen.getByText("41")).toBeInTheDocument();
    expect(screen.getByText(/142/)).toBeInTheDocument();
    expect(screen.getByText(/2.?210 m/)).toBeInTheDocument();
    // Standing still is not travel: its 900 hours are in no card.
    expect(screen.queryByText(/900/)).not.toBeInTheDocument();
  });

  it("draws no card for a figure the server abstained on, and says unmeasurable km", () => {
    renderCards({ ...base, kmGround: null, topSpeedKmh: null, highestPointM: null, byMotion: [] });
    expect(screen.queryByText("stats:wrapped.travTrack.topSpeed")).not.toBeInTheDocument();
    expect(screen.queryByText("stats:wrapped.travTrack.highest")).not.toBeInTheDocument();
    expect(screen.queryByText("stats:wrapped.travTrack.byMotion")).not.toBeInTheDocument();
    expect(screen.getByText("stats:wrapped.travTrack.kmNone")).toBeInTheDocument();
  });
});
