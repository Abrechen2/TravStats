import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { GlobeLabelsOverlay } from "../GlobeLabelsOverlay";
import type { GlobeExtraLabel } from "../globePinLabels";
import type { LabelsMode } from "../../map/labelPriority";
import { MAP_CHROME } from "../../map/mapChrome";

/**
 * beta.22 UAT: on the globe, "Vigelandsparken" was drawn across the activity
 * histogram at the top of the map. The label cull only looked at other
 * labels; the map's own controls — the histogram, the control panel, the
 * key, the domain filter — sat in the same pixels and nothing reserved them.
 *
 * jsdom has no layout, so the boxes are handed in through
 * `getBoundingClientRect`: the map fills 800 × 600, and a control spans
 * x 50–250, y 60–100. Oslo projects into it; Bergen lands in open sea.
 */
const OSLO: GlobeExtraLabel = {
  kind: "place",
  id: "p1",
  text: "Vigelandsparken",
  lng: 10.7,
  lat: 59.9,
  weight: 5,
  color: "rgb(94, 194, 178)",
};
const BERGEN: GlobeExtraLabel = { ...OSLO, id: "p2", text: "Bryggen", lng: 5.3, lat: 60.4 };

function fakeMapRef(): React.RefObject<MapRef | null> {
  const ref = createRef<MapRef>() as React.RefObject<MapRef | null>;
  const map = {
    getCenter: () => ({ lng: 10, lat: 58 }),
    getZoom: () => 4,
    project: ([lng]: [number, number]) => (lng > 10 ? { x: 150, y: 100 } : { x: 500, y: 400 }),
    on: vi.fn(),
    off: vi.fn(),
  };
  ref.current = { getMap: () => map } as unknown as MapRef;
  return ref;
}

const rect = (left: number, top: number, right: number, bottom: number): DOMRect =>
  ({
    left,
    top,
    right,
    bottom,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  }) as DOMRect;

afterEach(() => {
  vi.restoreAllMocks();
});

function renderWithControl(mode: LabelsMode) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return this.hasAttribute("data-map-chrome") ? rect(50, 60, 250, 100) : rect(0, 0, 800, 600);
  });
  render(
    <div>
      <div {...MAP_CHROME}>histogram</div>
      <GlobeLabelsOverlay
        mapRef={fakeMapRef()}
        mapReady
        airports={[]}
        ports={[]}
        extras={[OSLO, BERGEN]}
        mode={mode}
      />
    </div>
  );
}

describe("GlobeLabelsOverlay keeps its labels off the map's controls", () => {
  for (const mode of ["important", "all"] as const) {
    it(`hides a label that would print over a control ("${mode}")`, () => {
      renderWithControl(mode);
      expect(screen.getByText("Vigelandsparken").style.display).toBe("none");
      expect(screen.getByText("Bryggen").style.display).toBe("");
    });
  }
});
