/**
 * A roadtrip's costs in the spreadsheet (forgejo#140): one row per ferry
 * ticket, toll, pitch fee or fuel stop, pointing at its roadtrip and, where it
 * has one, at its station or at the two stations of its leg — all as
 * "Name [id]" like every reference in the workbook. Read back by
 * `backend/src/services/xlsxImport/roadtripExpenses.ts`; the keys below are
 * the columns that importer reads.
 *
 * Without this sheet a roadtrip moved into another account would arrive
 * without its costs — and, since the leg toll became an expense, without the
 * tolls its legs used to carry.
 */

import type { TripExpense } from "../../types/expense";
import type { RoadtripDetail } from "../../types/roadtrip";
import { refCell, type SheetSpec } from "./sheetSpec";

type T = (key: string) => string;

export interface RoadtripExpenseRow extends TripExpense {
  roadtripLabel: string;
  stationLabel: (id: string | null) => string | null;
}

/** Every roadtrip's costs, in the order the detail lists them. */
export function roadtripExpenseRows(details: readonly RoadtripDetail[]): RoadtripExpenseRow[] {
  return details.flatMap((d) => {
    const titles = new Map(d.stations.map((s) => [s.id, s.title]));
    const stationLabel = (id: string | null) => (id ? refCell(titles.get(id), id) : null);
    return (d.expenses ?? []).map((e) => ({
      ...e,
      // A cost stored on a section is the roadtrip's; the column points there.
      routeId: e.routeId ?? d.roadtrip.id,
      roadtripLabel: d.roadtrip.name,
      stationLabel,
    }));
  });
}

export function roadtripExpenseSheet(t: T): SheetSpec<RoadtripExpenseRow> {
  return {
    key: "roadtripExpenses",
    name: t("xlsx:sheets.roadtripExpenses"),
    hint: t("xlsx:hints.roadtripExpenses"),
    columns: [
      {
        key: "id",
        header: t("xlsx:columns.id"),
        kind: "text",
        width: 38,
        locked: true,
        value: (e) => e.id,
      },
      {
        key: "roadtripId",
        header: t("xlsx:columns.roadtrip"),
        kind: "text",
        width: 30,
        reference: true,
        value: (e) => refCell(e.roadtripLabel, e.routeId),
      },
      // ferry / toll / pitch / fuel / parking / other — listed in the hint.
      {
        key: "kind",
        header: t("xlsx:columns.expenseKind"),
        kind: "text",
        width: 10,
        value: (e) => e.kind,
      },
      {
        key: "amount",
        header: t("xlsx:columns.amount"),
        kind: "number",
        width: 12,
        value: (e) => e.amount,
      },
      {
        key: "currency",
        header: t("xlsx:columns.currency"),
        kind: "text",
        width: 9,
        value: (e) => e.currency,
      },
      {
        key: "date",
        header: t("xlsx:columns.paidOn"),
        kind: "date",
        width: 12,
        value: (e) => (e.date ? `${e.date}T00:00:00.000Z` : null),
      },
      {
        key: "stopId",
        header: t("xlsx:columns.station"),
        kind: "text",
        width: 26,
        reference: true,
        value: (e) => e.stationLabel(e.stopId),
      },
      {
        key: "legFromStopId",
        header: t("xlsx:columns.legFrom"),
        kind: "text",
        width: 26,
        reference: true,
        value: (e) => e.stationLabel(e.legFromStopId),
      },
      {
        key: "legToStopId",
        header: t("xlsx:columns.legTo"),
        kind: "text",
        width: 26,
        reference: true,
        value: (e) => e.stationLabel(e.legToStopId),
      },
      {
        key: "note",
        header: t("xlsx:columns.notes"),
        kind: "text",
        width: 40,
        value: (e) => e.note,
      },
    ],
  };
}
