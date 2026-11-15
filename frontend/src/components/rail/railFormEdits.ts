import type { MissingStep } from "../form";
import type { useTranslation } from "../../hooks/useTranslation";
import type { RailStationDraft } from "./RailStationField";
import { dayPart, isStationComplete, withClock, type RailFormDraft } from "./railFormModel";

type End = "departure" | "arrival";
type T = ReturnType<typeof useTranslation>["t"];

/**
 * Another station is another zone, where the old choice of occurrence means
 * nothing; a rename of the same station keeps it.
 */
export function withStation(prev: RailFormDraft, end: End, next: RailStationDraft): RailFormDraft {
  const moved = next.lat !== prev[end].lat || next.lon !== prev[end].lon;
  return {
    ...prev,
    [end]: next,
    ...(moved ? { [`${end}Fold`]: null } : {}),
  };
}

/**
 * A typed time ends the stored occurrence of a repeated hour: it was the old
 * clock's. Typing the clock the ride OPENED with, at the station it opened
 * with, gives it back — a change away and back must not move the ride.
 */
export function withTime(
  prev: RailFormDraft,
  opened: RailFormDraft,
  end: End,
  value: string
): RailFormDraft {
  const sameClock = value === opened[`${end}Local`] && !opened[`${end}DayOnly`];
  const sameStation = prev[end].lat === opened[end].lat && prev[end].lon === opened[end].lon;
  return {
    ...prev,
    [`${end}Local`]: value,
    [`${end}Fold`]: sameClock && sameStation ? opened[`${end}Fold`] : null,
  };
}

/** Switch one end between a day and a clock time; the stored occurrence no longer applies. */
export function withDayOnly(prev: RailFormDraft, end: End, dayOnly: boolean): RailFormDraft {
  const local = end === "departure" ? prev.departureLocal : prev.arrivalLocal;
  const next = dayOnly ? dayPart(local) : withClock(local);
  // The time is no longer the stored one, so neither is its occurrence.
  return end === "departure"
    ? { ...prev, departureDayOnly: dayOnly, departureLocal: next, departureFold: null }
    : { ...prev, arrivalDayOnly: dayOnly, arrivalLocal: next, arrivalFold: null };
}

/**
 * What keeps both save buttons greyed out, said beside them (forgejo#245);
 * the same conditions as `ready`, one item per gap, each focusing its field.
 */
export function missingSteps(
  draft: RailFormDraft,
  depBad: "lat" | "lon" | null,
  arrBad: "lat" | "lon" | null,
  departureTimeField: string,
  t: T
): MissingStep[] {
  return [
    ...stationGap(
      draft.departure,
      "rail-dep",
      t("rail:form.departureStation"),
      t("rail:form.missing.depName")
    ),
    ...(depBad === null
      ? []
      : [{ field: `rail-dep-${depBad}`, label: t("rail:form.missing.depCoordinates") }]),
    ...stationGap(
      draft.arrival,
      "rail-arr",
      t("rail:form.arrivalStation"),
      t("rail:form.missing.arrName")
    ),
    ...(arrBad === null
      ? []
      : [{ field: `rail-arr-${arrBad}`, label: t("rail:form.missing.arrCoordinates") }]),
    ...(draft.departureLocal === ""
      ? [{ field: departureTimeField, label: t("rail:form.missing.departureTime") }]
      : []),
  ];
}

/**
 * What a station still lacks, as a "still missing" item: the whole station
 * (no position yet — the search), or only its name (a map click or a pasted
 * coordinate leaves it empty — the name field of the geocoder mode).
 */
function stationGap(
  station: RailStationDraft,
  idPrefix: string,
  stationLabel: string,
  nameLabel: string
): MissingStep[] {
  if (isStationComplete(station)) return [];
  if (station.lat !== null && station.lon !== null && station.name.trim() === "") {
    return [{ field: `${idPrefix}-name`, label: nameLabel }];
  }
  return [{ field: `${idPrefix}-search`, label: stationLabel }];
}
