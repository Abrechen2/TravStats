import { describe, expect, it } from "vitest";
import { placeCard, placeTooltip, type Box } from "../placeFloating";

/**
 * Browser look on forgejo#323: a card for a station near the right edge
 * (Chiang Mai at x≈1076 on a 1180×820 map) opened at x≈932 and ran off the
 * viewport, under the "Als nächstes" panel; the hover tooltip was clipped the
 * same way. Card and tooltip stay inside the map with a 16 px margin, on all
 * four edges and in every corner, and clear of the side list when it is open.
 */
const VIEW = { width: 1180, height: 820 };
const CARD = { width: 280, height: 300 };
const TIP = { width: 220, height: 90 };
const M = 16;

function inside(b: Box, view = VIEW, left = 0): void {
  expect(b.left).toBeGreaterThanOrEqual(left + M);
  expect(b.top).toBeGreaterThanOrEqual(M);
  expect(b.left + CARD.width <= view.width - M || b.left + TIP.width <= view.width - M).toBe(true);
}

describe("placeCard", () => {
  it("sits centred above its anchor when there is room", () => {
    expect(placeCard({ x: 590, y: 500 }, CARD, VIEW)).toEqual({
      left: 590 - 140,
      top: 500 - 300 - 14,
      side: "above",
    });
  });

  it("the reported defect: an anchor near the right edge stays fully on screen", () => {
    const b = placeCard({ x: 1076, y: 400 }, CARD, VIEW);
    expect(b.left + CARD.width).toBeLessThanOrEqual(VIEW.width - M);
  });

  it.each([
    ["left edge", { x: 5, y: 400 }],
    ["right edge", { x: 1175, y: 400 }],
    ["top edge", { x: 590, y: 5 }],
    ["bottom edge", { x: 590, y: 815 }],
    ["top-left corner", { x: 5, y: 5 }],
    ["top-right corner", { x: 1175, y: 5 }],
    ["bottom-left corner", { x: 5, y: 815 }],
    ["bottom-right corner", { x: 1175, y: 815 }],
  ])("stays inside the map at the %s", (_, anchor) => {
    const b = placeCard(anchor, CARD, VIEW);
    expect(b.left).toBeGreaterThanOrEqual(M);
    expect(b.left + CARD.width).toBeLessThanOrEqual(VIEW.width - M);
    expect(b.top).toBeGreaterThanOrEqual(M);
    expect(b.top + CARD.height).toBeLessThanOrEqual(VIEW.height - M);
  });

  it("the ferry report: Kiel–Oslo clicked at y≈120 opens below, not cut off by the top", () => {
    const tall = { width: 280, height: 360 };
    const b = placeCard({ x: 600, y: 120 }, tall, VIEW);
    expect(b.side).toBe("below");
    expect(b.top).toBeGreaterThanOrEqual(120);
    expect(b.top + tall.height).toBeLessThanOrEqual(VIEW.height - M);
  });

  it("flips below an anchor too close to the top", () => {
    expect(placeCard({ x: 590, y: 100 }, CARD, VIEW).side).toBe("below");
  });

  it("keeps clear of the side list when it is open", () => {
    const b = placeCard({ x: 330, y: 400 }, CARD, VIEW, { left: 320 });
    expect(b.left).toBeGreaterThanOrEqual(320 + M);
    inside(b, VIEW, 320);
  });

  it("a card larger than the map aligns to the top-left margin rather than off it", () => {
    const b = placeCard({ x: 100, y: 100 }, { width: 2000, height: 2000 }, VIEW);
    expect(b).toMatchObject({ left: M, top: M });
  });
});

describe("placeTooltip", () => {
  it("sits right of and below the pointer when there is room", () => {
    expect(placeTooltip({ x: 100, y: 100 }, TIP, VIEW)).toEqual({
      left: 112,
      top: 112,
      side: "below",
    });
  });

  it.each([
    ["right edge", { x: 1170, y: 400 }],
    ["bottom edge", { x: 400, y: 815 }],
    ["bottom-right corner", { x: 1170, y: 815 }],
    ["top-left corner", { x: 2, y: 2 }],
  ])("stays inside the map at the %s", (_, pointer) => {
    const b = placeTooltip(pointer, TIP, VIEW);
    expect(b.left).toBeGreaterThanOrEqual(M);
    expect(b.left + TIP.width).toBeLessThanOrEqual(VIEW.width - M);
    expect(b.top).toBeGreaterThanOrEqual(M);
    expect(b.top + TIP.height).toBeLessThanOrEqual(VIEW.height - M);
  });

  it("flips to the pointer's left near the right edge instead of covering it", () => {
    const b = placeTooltip({ x: 1100, y: 400 }, TIP, VIEW);
    expect(b.left + TIP.width).toBeLessThanOrEqual(1100);
  });

  it("keeps clear of the side list", () => {
    expect(placeTooltip({ x: 300, y: 400 }, TIP, VIEW, { left: 320 }).left).toBeGreaterThanOrEqual(
      336
    );
  });
});
