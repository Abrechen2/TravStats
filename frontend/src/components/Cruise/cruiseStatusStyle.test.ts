import { describe, it, expect } from "vitest";
import { cruiseStatusPillStyle } from "./cruiseStatusStyle";
import { statusPillStyle } from "../table/statusPillStyle";

/**
 * A cruise status is a status, and there is one palette.
 *
 * This file used to pin the purple `in_progress` that cruises introduced so a
 * voyage under way read as neither past nor future. The shared design system
 * does not spend a hue on it — the Companion's own `live` token is the same
 * value as `good` — so the distinction is carried by the label from 2.7.0 on.
 * What is worth testing here is no longer the hue but the delegation: cruises
 * must not grow a fourth private palette.
 */
describe("cruiseStatusPillStyle", () => {
  it("delegates to the shared palette rather than keeping one of its own", () => {
    for (const status of [
      "scheduled",
      "in_progress",
      "flown",
      "historical",
      "cancelled",
    ] as const) {
      expect(cruiseStatusPillStyle(status)).toEqual(statusPillStyle(status));
    }
  });

  it("separates a cancelled voyage from every other state", () => {
    const cancelled = cruiseStatusPillStyle("cancelled");
    expect(cancelled).not.toEqual(cruiseStatusPillStyle("scheduled"));
    expect(cancelled).not.toEqual(cruiseStatusPillStyle("flown"));
    expect(cancelled).not.toEqual(cruiseStatusPillStyle("in_progress"));
  });
});
