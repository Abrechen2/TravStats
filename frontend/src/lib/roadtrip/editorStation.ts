import type { RoadtripStation } from "../../types/roadtrip";
import type { StationDraft } from "./roadtripView";

/** A station in the editor: a draft plus what only the editor needs. */
export interface EditorStation extends StationDraft {
  /** Stable across saves; a new station has no id until the server gives it one. */
  key: string;
  stayLabel?: string;
  stayCancelled?: boolean;
  /** The linked stay's lodging, to find where it is in the lodging library. */
  stayLodgingId?: string;
  /**
   * Where the lodging picked in this session is. A lodging made by the picker
   * is not in the library the editor loaded, so its point travels here.
   */
  stayPlace?: { lat: number | null; lon: number | null };
  /** The name of the place a pass-through names, for the card. */
  placeLabel?: string;
}

/**
 * The night a loaded station is edited as. Every state maps to itself: a
 * route correction read as "pass" would be saved back as a counted, named
 * station on the next autosave (tester 2026-09-26).
 */
function nightOf(s: RoadtripStation): EditorStation["night"] {
  if (s.state === "stay" && s.lodgingStayId)
    return { kind: "stay", lodgingStayId: s.lodgingStayId };
  if (s.state === "free") return { kind: "free" };
  if (s.state === "via") return { kind: "via" };
  // The place travels with the night: dropping it here would unlink it on
  // the next autosave of any other change.
  return s.placeId ? { kind: "pass", placeId: s.placeId } : { kind: "pass" };
}

export function toEditorStation(s: RoadtripStation): EditorStation {
  return {
    key: s.id,
    id: s.id,
    title: s.title,
    lat: s.lat,
    lon: s.lon,
    startDate: s.startDate,
    endDate: s.endDate,
    notes: s.notes,
    night: nightOf(s),
    stayLabel: s.stay?.lodgingName,
    stayLodgingId: s.stay?.lodgingId,
    stayCancelled: s.stay?.status === "cancelled",
    placeLabel: s.place?.name,
  };
}
