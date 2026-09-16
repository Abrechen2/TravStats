import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// The eight blocks each want a fully populated rollup and have tests of their
// own. What is pinned here is only which of them the switches let through, so
// each is a labelled stand-in.
vi.mock("../../../lib/api/lodging", () => ({
  getLodgingStats: vi.fn().mockResolvedValue({ lodgingsCount: 2, staysCount: 3 }),
}));
vi.mock("../../Dashboard/tabs/lodging/LodgingStatStrip", () => ({
  LodgingStatStrip: () => <p>block:kpis</p>,
}));
vi.mock("../../Dashboard/tabs/lodging/LodgingCurrencyBreakdown", () => ({
  LodgingCurrencyBreakdown: () => <p>block:currency</p>,
}));
vi.mock("../lodging/LodgingMoneySection", () => ({ default: () => <p>block:money</p> }));
vi.mock("../lodging/LodgingQualitySection", () => ({ default: () => <p>block:quality</p> }));
vi.mock("../lodging/LodgingGeoSection", () => ({ default: () => <p>block:geo</p> }));
vi.mock("../lodging/LodgingRhythmSection", () => ({ default: () => <p>block:rhythm</p> }));
vi.mock("../lodging/LodgingLoyaltySection", () => ({ default: () => <p>block:loyalty</p> }));
vi.mock("../lodging/LodgingRecordsSection", () => ({ default: () => <p>block:records</p> }));

import LodgingStatsSection from "../LodgingStatsSection";
import { hiding } from "./sectionVisibilityStub";

const LIFETIME = { year: null, compareYear: null };

// A tester with no prices asked for the cost block to go (2026-08-29). The
// switch existed for flights only; stays have a cost block too.
describe("LodgingStatsSection hides the blocks the reader switched off", () => {
  it("draws every block while nothing is hidden", async () => {
    render(<LodgingStatsSection scope={LIFETIME} visibility={hiding()} />);
    for (const block of [
      "kpis",
      "currency",
      "money",
      "quality",
      "geo",
      "rhythm",
      "loyalty",
      "records",
    ]) {
      expect(await screen.findByText(`block:${block}`)).toBeInTheDocument();
    }
  });

  it("takes the currency breakdown away with the money block", async () => {
    render(<LodgingStatsSection scope={LIFETIME} visibility={hiding("money")} />);
    expect(await screen.findByText("block:quality")).toBeInTheDocument();
    expect(screen.queryByText("block:money")).not.toBeInTheDocument();
    expect(screen.queryByText("block:currency")).not.toBeInTheDocument();
  });
});
