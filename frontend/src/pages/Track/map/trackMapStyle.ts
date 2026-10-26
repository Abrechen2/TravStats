import type { CSSProperties } from "react";
import { alpha, token } from "../../../components/ui/tokens";
import { TRACK_COLOR } from "./trackMapLayers";

/**
 * The Track map's panels and pills, after the concept board "Track-Karte":
 * TravTrack's area colour marks what is on, the rest is the app's tokens.
 */

export const panelStyle: CSSProperties = {
  background: token("surface"),
  border: `1px solid ${token("border")}`,
  borderRadius: token("radius-card"),
  padding: 16,
};

export function pillStyle(on: boolean): CSSProperties {
  return {
    minHeight: 40,
    padding: "0 12px",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 14,
    border: `1px solid ${on ? TRACK_COLOR : token("border-button")}`,
    background: on ? alpha(TRACK_COLOR, 16) : "transparent",
    color: on ? TRACK_COLOR : token("text"),
    fontWeight: on ? 600 : 400,
  };
}
