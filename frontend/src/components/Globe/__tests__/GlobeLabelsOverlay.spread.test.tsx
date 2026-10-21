import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { GlobeLabelsOverlay } from "../GlobeLabelsOverlay";
import type { GlobeExtraLabel } from "../globePinLabels";

/**
 * beta.22 UAT, shot 35: with "Alle" chosen, the globe printed "Köln Hbf",
 * "Koblenz Hbf" and "Cochem (Mosel)" over one another — "all" skipped the
 * overlay's collision cull. It now moves a label that would touch another
 * beside its dot, and hides it until the next zoom only where no spot is free.
 *
 * jsdom has no layout; `map.project` hands each town the screen point the
 * zoomed-out globe gives it — a few pixels apart.
 */
const SCREEN: Record<string, { x: number; y: number }> = {
  "6.96": { x: 400, y: 300 },
  "7.59": { x: 406, y: 312 },
  "7.17": { x: 402, y: 318 },
};
const label = (id: string, text: string, lng: number, weight: number): GlobeExtraLabel => ({
  kind: "station",
  id,
  text,
  lng,
  lat: 50.3,
  weight,
  color: "rgb(160, 140, 255)",
});
const LABELS = [
  label("k", "Köln Hbf", 6.96, 3),
  label("ko", "Koblenz Hbf", 7.59, 2),
  label("c", "Cochem (Mosel)", 7.17, 1),
];

function fakeMapRef(): React.RefObject<MapRef | null> {
  const ref = createRef<MapRef>() as React.RefObject<MapRef | null>;
  const map = {
    getCenter: () => ({ lng: 7, lat: 50 }),
    getZoom: () => 4,
    project: ([lng]: [number, number]) => SCREEN[lng.toFixed(2)],
    on: vi.fn(),
    off: vi.fn(),
  };
  ref.current = { getMap: () => map } as unknown as MapRef;
  return ref;
}

/** The pill's box from its transform: centred on x, its bottom edge at y. */
function boxOf(el: HTMLElement) {
  const m = /translate\(-50%, -100%\) translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(
    el.style.transform
  );
  if (!m) throw new Error(`no position: ${el.style.transform}`);
  const w = (el.textContent ?? "").length * 7 + 12;
  const x = Number(m[1]);
  const y = Number(m[2]);
  return { x0: x - w / 2, x1: x + w / 2, y0: y - 16, y1: y };
}

describe('GlobeLabelsOverlay in "all"', () => {
  it("prints no label over another, moving one beside its dot instead", () => {
    render(
      <GlobeLabelsOverlay
        mapRef={fakeMapRef()}
        mapReady
        airports={[]}
        ports={[]}
        extras={LABELS}
        mode="all"
      />
    );
    const shown = LABELS.map((l) => screen.getByText(l.text)).filter(
      (el) => el.style.display !== "none"
    );
    // More than "important" would keep: a crowded cluster still shows names.
    expect(shown.length).toBeGreaterThanOrEqual(2);
    const boxes = shown.map(boxOf);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        const overlap = a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
        expect(overlap, `${shown[i].textContent} × ${shown[j].textContent}`).toBe(false);
      }
    }
  });
});
