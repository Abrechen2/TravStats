import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { TRIP_MAP_CHROME } from "../tripMapColors";

/**
 * The trip recording on the trip map (forgejo#316): one path per stretch the
 * server cut, so a gap is a break in the line and never a straight jump
 * across it; a stretch of a single fix is a dot, since a path needs two.
 *
 * Its own colour, not a domain colour: a recording is not a flight, a ride or
 * a tour, and borrowing one of their colours would make it read as one.
 */
export const RECORDING_RGB: [number, number, number] = [219, 39, 119];

type Segment = Array<[number, number]>;

export function buildRecordingLayers(segments: readonly Segment[]): Layer[] {
  const lines = segments.filter((s) => s.length >= 2);
  const dots = segments.filter((s) => s.length === 1).map((s) => s[0]);
  const layers: Layer[] = [];
  if (lines.length > 0) {
    // A recorded track is cased in the label-text colour, so it never reads as
    // one of the schematic connections (flights, rides), which are plain lines
    // between two known points. The legend's swatch draws the same casing.
    layers.push(
      new PathLayer<Segment>({
        id: "trip-recording-casing",
        data: lines,
        getPath: (d) => d,
        getColor: [...TRIP_MAP_CHROME.labelText.slice(0, 3), 200] as [
          number,
          number,
          number,
          number,
        ],
        getWidth: 6,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        pickable: false,
      })
    );
    layers.push(
      new PathLayer<Segment>({
        id: "trip-recording-lines",
        data: lines,
        getPath: (d) => d,
        getColor: [...RECORDING_RGB, 220],
        getWidth: 3.5,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        pickable: false,
      })
    );
  }
  if (dots.length > 0) {
    layers.push(
      new ScatterplotLayer<[number, number]>({
        id: "trip-recording-dots",
        data: dots,
        getPosition: (d) => d,
        getFillColor: [...RECORDING_RGB, 220],
        getRadius: 4,
        radiusUnits: "pixels",
        pickable: false,
      })
    );
  }
  return layers;
}

/** Every point the recording covers, for framing the map around it. */
export function recordingPoints(segments: readonly Segment[]): Array<[number, number]> {
  return segments.flat();
}
