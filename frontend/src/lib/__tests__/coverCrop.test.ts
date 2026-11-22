import { describe, expect, it } from "vitest";

import {
  clampCrop,
  cropLayout,
  COVER_ZOOM_MAX,
  DEFAULT_COVER_CROP,
  panCrop,
  zoomCrop,
} from "../coverCrop";

const frame = { width: 400, height: 100 };
const wide = { width: 3000, height: 1000 }; // 3:1 — fills the 4:1 frame by width
const tall = { width: 1000, height: 3000 };

/** The frame is filled when the image covers [0,W]x[0,H]. */
const fills = (c: Parameters<typeof cropLayout>[0], img: typeof wide): boolean => {
  const l = cropLayout(c, frame, img);
  const eps = 1e-6;
  return (
    l.left <= eps &&
    l.top <= eps &&
    l.left + l.width >= frame.width - eps &&
    l.top + l.height >= frame.height - eps
  );
};

describe("cover crop math", () => {
  it("no crop renders like object-fit: cover, centred", () => {
    const l = cropLayout(null, frame, wide);
    expect(l.width).toBeCloseTo(400);
    expect(l.height).toBeCloseTo(133.33, 1);
    expect(l.left).toBeCloseTo(0);
    expect(l.top).toBeCloseTo(-16.67, 1);
  });

  it("clamps pan so the frame stays filled, at every zoom and both orientations", () => {
    for (const img of [wide, tall]) {
      for (const zoom of [1, 1.7, 4, COVER_ZOOM_MAX]) {
        for (const [x, y] of [
          [0, 0],
          [1, 1],
          [-3, 9],
          [0.5, 0.5],
        ]) {
          expect(fills({ x, y, zoom }, img)).toBe(true);
        }
      }
    }
  });

  it("clamps zoom into 1..max and never zooms out past the cover fit", () => {
    expect(clampCrop({ x: 0.5, y: 0.5, zoom: 0.2 }, frame, wide).zoom).toBe(1);
    expect(clampCrop({ x: 0.5, y: 0.5, zoom: 99 }, frame, wide).zoom).toBe(COVER_ZOOM_MAX);
  });

  it("dragging the picture right moves the focal point left, and stops at the edge", () => {
    const z = { x: 0.5, y: 0.5, zoom: 2 };
    const moved = panCrop(z, 40, 0, frame, wide);
    expect(moved.x).toBeLessThan(0.5);
    const far = panCrop(z, 1e6, -1e6, frame, wide);
    expect(far.x).toBeGreaterThanOrEqual(0);
    expect(far.y).toBeLessThanOrEqual(1);
    expect(fills(far, wide)).toBe(true);
  });

  it("at zoom 1 an image that fits by width cannot pan sideways, only vertically", () => {
    const c = panCrop(DEFAULT_COVER_CROP, 50, 20, frame, wide);
    expect(c.x).toBeCloseTo(0.5);
    expect(c.y).not.toBeCloseTo(0.5);
  });

  it("zooming keeps the focal point and re-clamps it near an edge", () => {
    const edge = { x: 0.5, y: 0.5, zoom: 1 };
    expect(zoomCrop(edge, 3, frame, wide).x).toBeCloseTo(0.5);
    const near = zoomCrop({ x: 0.02, y: 0.5, zoom: 4 }, 1, frame, wide);
    expect(fills(near, wide)).toBe(true);
  });

  it("the same crop shows the same focal point in frames of different shapes", () => {
    const card = { width: 320, height: 110 };
    const crop = { x: 0.3, y: 0.5, zoom: 2 };
    const a = cropLayout(crop, frame, wide);
    const b = cropLayout(crop, card, wide);
    expect((frame.width / 2 - a.left) / a.width).toBeCloseTo(0.3);
    expect((card.width / 2 - b.left) / b.width).toBeCloseTo(0.3);
  });
});
