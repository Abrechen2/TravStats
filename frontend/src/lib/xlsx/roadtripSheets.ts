/**
 * Roadtrips, their stations and day tours in the spreadsheet (2.7).
 *
 * Same two rules as every other sheet (`sheets.ts`): column A is the id, and a
 * pointer to another row is "Name [id]". What is special here is the station
 * sheet: its ORDER column is the authority on sequence. Export writes 1..n;
 * a reader moves a station by changing its number and inserts one between
 * two others with a decimal (2.5 goes between 2 and 3). The server applies
 * the list through the same writer as the station editor.
 *
 * Tours are export-only: a tour is measured by its recording, and a
 * recording is a line of points no cell can hold. The sheet says so.
 */

import type { TourSummary } from "../api/tourIndex";
import type { RoadtripDetail, RoadtripStation } from "../../types/roadtrip";
import { refCell, type SheetSpec } from "./sheetSpec";

type T = (key: string) => string;

export interface RoadtripRow {
  id: string;
  name: string;
  vehicle: string | null;
  vehicleName: string | null;
  tripName: string | null;
  startDate: string | null;
  endDate: string | null;
  drivenKm: number;
  distanceKm: number;
  nights: number;
  nightsKnown: boolean;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  notes: string | null;
}

export interface RoadtripStationRow extends RoadtripStation {
  roadtripId: string;
  roadtripLabel: string;
  position: number;
}

const id = <R extends { id: string }>(header: string) => ({
  key: "id",
  header,
  kind: "text" as const,
  width: 38,
  locked: true,
  value: (r: R) => r.id,
});

/** Flatten one roadtrip detail into its sheet rows. */
export function roadtripRows(details: readonly RoadtripDetail[]): {
  roadtrips: RoadtripRow[];
  stations: RoadtripStationRow[];
} {
  const roadtrips: RoadtripRow[] = [];
  const stations: RoadtripStationRow[] = [];
  for (const d of details) {
    const r = d.roadtrip;
    roadtrips.push({
      id: r.id,
      name: r.name,
      vehicle: r.vehicle,
      vehicleName: r.vehicleName,
      tripName: d.trip?.name ?? null,
      startDate: d.startDate,
      endDate: d.endDate,
      drivenKm: r.drivenKm,
      distanceKm: r.distanceKm,
      nights: d.nights.nights,
      nightsKnown: d.nights.nightsKnown,
      startOdometerKm: r.startOdometerKm,
      endOdometerKm: r.endOdometerKm,
      notes: r.notes,
    });
    d.stations.forEach((s, i) =>
      stations.push({ ...s, roadtripId: r.id, roadtripLabel: r.name, position: i + 1 })
    );
  }
  return { roadtrips, stations };
}

export function roadtripSheet(t: T): SheetSpec<RoadtripRow> {
  return {
    key: "roadtrips",
    name: t("xlsx:sheets.roadtrips"),
    hint: t("xlsx:hints.roadtrips"),
    columns: [
      id<RoadtripRow>(t("xlsx:columns.id")),
      {
        key: "name",
        header: t("xlsx:columns.name"),
        kind: "text",
        width: 30,
        value: (r) => r.name,
      },
      {
        key: "vehicle",
        header: t("xlsx:columns.vehicle"),
        kind: "text",
        width: 14,
        value: (r) => r.vehicle,
      },
      {
        key: "vehicleName",
        header: t("xlsx:columns.vehicleName"),
        kind: "text",
        width: 18,
        value: (r) => r.vehicleName,
      },
      // Which trip it belongs to is moved in the app, where the trip list is;
      // shown here so the sheet reads, locked so an edit is not silently lost.
      {
        key: "trip",
        header: t("xlsx:columns.trip"),
        kind: "text",
        width: 24,
        locked: true,
        value: (r) => r.tripName,
      },
      {
        key: "startDate",
        header: t("xlsx:columns.startDate"),
        kind: "date",
        width: 12,
        locked: true,
        value: (r) => r.startDate,
      },
      {
        key: "endDate",
        header: t("xlsx:columns.endDate"),
        kind: "date",
        width: 12,
        locked: true,
        value: (r) => r.endDate,
      },
      {
        key: "drivenKm",
        header: t("xlsx:columns.drivenKm"),
        kind: "number",
        width: 10,
        locked: true,
        value: (r) => Math.round(r.drivenKm),
      },
      {
        key: "distanceKm",
        header: t("xlsx:columns.distanceKm"),
        kind: "number",
        width: 10,
        locked: true,
        value: (r) => Math.round(r.distanceKm),
      },
      // A lower bound is not a count: a soft total is left empty rather than
      // written as a number someone sums.
      {
        key: "nights",
        header: t("xlsx:columns.nights"),
        kind: "number",
        width: 8,
        locked: true,
        value: (r) => (r.nightsKnown ? r.nights : null),
      },
      {
        key: "startOdometerKm",
        header: t("xlsx:columns.startOdometerKm"),
        kind: "number",
        width: 12,
        value: (r) => r.startOdometerKm,
      },
      {
        key: "endOdometerKm",
        header: t("xlsx:columns.endOdometerKm"),
        kind: "number",
        width: 12,
        value: (r) => r.endOdometerKm,
      },
      {
        key: "notes",
        header: t("xlsx:columns.notes"),
        kind: "text",
        width: 40,
        value: (r) => r.notes,
      },
    ],
  };
}

export function roadtripStationSheet(t: T): SheetSpec<RoadtripStationRow> {
  return {
    key: "roadtripStations",
    name: t("xlsx:sheets.roadtripStations"),
    hint: t("xlsx:hints.roadtripStations"),
    columns: [
      id<RoadtripStationRow>(t("xlsx:columns.id")),
      {
        key: "roadtripId",
        header: t("xlsx:columns.roadtrip"),
        kind: "text",
        width: 30,
        reference: true,
        value: (s) => refCell(s.roadtripLabel, s.roadtripId),
      },
      {
        key: "order",
        header: t("xlsx:columns.order"),
        kind: "number",
        width: 8,
        value: (s) => s.position,
      },
      {
        key: "title",
        header: t("xlsx:columns.name"),
        kind: "text",
        width: 26,
        value: (s) => s.title,
      },
      { key: "lat", header: t("xlsx:columns.lat"), kind: "number", width: 11, value: (s) => s.lat },
      { key: "lon", header: t("xlsx:columns.lon"), kind: "number", width: 11, value: (s) => s.lon },
      {
        key: "startDate",
        header: t("xlsx:columns.stationArrival"),
        kind: "date",
        width: 12,
        value: (s) => s.startDate,
      },
      {
        key: "endDate",
        header: t("xlsx:columns.stationDeparture"),
        kind: "date",
        width: 12,
        value: (s) => s.endDate,
      },
      // stay / free / pass — the words the importer reads, listed in the hint.
      {
        key: "night",
        header: t("xlsx:columns.night"),
        kind: "text",
        width: 10,
        value: (s) => s.state,
      },
      {
        key: "lodgingStayId",
        header: t("xlsx:columns.stay"),
        kind: "text",
        width: 30,
        reference: true,
        value: (s) => (s.lodgingStayId ? refCell(s.stay?.lodgingName, s.lodgingStayId) : null),
      },
      {
        key: "notes",
        header: t("xlsx:columns.notes"),
        kind: "text",
        width: 40,
        value: (s) => s.notes,
      },
    ],
  };
}

export function tourSheet(t: T): SheetSpec<TourSummary> {
  return {
    key: "tours",
    name: t("xlsx:sheets.tours"),
    hint: t("xlsx:hints.tours"),
    columns: [
      id<TourSummary>(t("xlsx:columns.id")),
      {
        key: "name",
        header: t("xlsx:columns.name"),
        kind: "text",
        width: 30,
        locked: true,
        value: (r) => r.name,
      },
      {
        key: "activity",
        header: t("xlsx:columns.activity"),
        kind: "text",
        width: 12,
        locked: true,
        value: (r) => r.activity,
      },
      {
        key: "trip",
        header: t("xlsx:columns.trip"),
        kind: "text",
        width: 24,
        locked: true,
        value: (r) => r.tripName,
      },
      {
        key: "startDate",
        header: t("xlsx:columns.startDate"),
        kind: "date",
        width: 12,
        locked: true,
        value: (r) => r.startDate,
      },
      {
        key: "distanceKm",
        header: t("xlsx:columns.distanceKm"),
        kind: "number",
        width: 10,
        locked: true,
        value: (r) => Math.round(r.distanceKm * 10) / 10,
      },
      {
        key: "ascentM",
        header: t("xlsx:columns.ascentM"),
        kind: "number",
        width: 10,
        locked: true,
        value: (r) => (r.ascentM === null ? null : Math.round(r.ascentM)),
      },
      {
        key: "movingMinutes",
        header: t("xlsx:columns.movingMinutes"),
        kind: "number",
        width: 12,
        locked: true,
        value: (r) => (r.movingSeconds === null ? null : Math.round(r.movingSeconds / 60)),
      },
    ],
  };
}
