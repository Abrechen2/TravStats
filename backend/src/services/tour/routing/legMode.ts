import { LEG_MODES, type LegMode } from "../tourDistance";
import { isRoutableMode, type RoutableMode } from "./types";

/** A stored leg mode string as a mode a road router can answer, or null. */
export function asRoutableMode(mode: string): RoutableMode | null {
  const known = LEG_MODES.find((m): m is LegMode => m === mode);
  return known !== undefined && isRoutableMode(known) ? known : null;
}
