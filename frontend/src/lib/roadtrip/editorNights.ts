import { countRoadtripNights, type CountableStation } from "../../shared/tour/roadtrip";
import type { Lodging, LodgingStay } from "../../types/lodging";
import type { EditorStation } from "./editorStation";

/** What the editor shows about nights: derived from the drafts, never typed in. */
export interface EditorNights {
  nights: number;
  /** False when some night rests on a guess (no dates, no stay length, library not loaded). */
  nightsKnown: boolean;
  placesSlept: number;
  /** Per station key: its own nights, or null for a pass-through / route correction. */
  byStation: Map<string, { nights: number; known: boolean } | null>;
}

function asDate(day: string | null | undefined): Date | null {
  return day ? new Date(day) : null;
}

/**
 * The nights of the stations as they stand in the editor — the SAME rule the
 * server and the figures band use (`countRoadtripNights`), applied to the
 * drafts, so the counter moves while the reader edits instead of waiting for
 * the next save. A stay's length comes from the lodging library: `lodgings`
 * still null (loading) or lacking the stay counts as "not known", never as 0.
 */
export function editorNights(
  drafts: readonly EditorStation[],
  lodgings: readonly Lodging[] | null
): EditorNights {
  const stays = new Map<string, { stay: LodgingStay; type: string }>();
  for (const l of lodgings ?? [])
    for (const s of l.stays) stays.set(s.id, { stay: s, type: l.type });

  const toCountable = (d: EditorStation): CountableStation => {
    const stayId = d.night.kind === "stay" ? d.night.lodgingStayId : null;
    const found = stayId ? stays.get(stayId) : undefined;
    return {
      lodgingStayId: stayId,
      overnight: d.night.kind === "free",
      viaPoint: d.night.kind === "via",
      startDate: asDate(d.startDate),
      endDate: asDate(d.endDate),
      stay: found
        ? {
            checkIn: asDate(found.stay.checkIn),
            checkOut: asDate(found.stay.checkOut),
            datePrecision: found.stay.datePrecision,
            nights: found.stay.nights ?? null,
            status: found.stay.status,
            lodgingType: found.type,
          }
        : null,
    };
  };

  const total = countRoadtripNights(drafts.map(toCountable));
  const byStation = new Map<string, { nights: number; known: boolean } | null>();
  for (const d of drafts) {
    const unlinkedStay = d.night.kind === "stay" && !d.night.lodgingStayId;
    if (d.night.kind === "pass" || d.night.kind === "via" || unlinkedStay) {
      byStation.set(d.key, null);
      continue;
    }
    const own = countRoadtripNights([toCountable(d)]);
    byStation.set(d.key, { nights: own.nights, known: own.nightsKnown });
  }
  return {
    nights: total.nights,
    nightsKnown: total.nightsKnown,
    placesSlept: total.placesSlept,
    byStation,
  };
}
