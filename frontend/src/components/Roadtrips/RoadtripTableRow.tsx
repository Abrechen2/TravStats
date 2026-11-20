import type { JSX } from "react";

import Pill from "../ui/Pill";
import { TableRow, type TableColumn } from "../ui/Table";
import { useTranslation } from "../../hooks/useTranslation";
import type { RoadtripPhase } from "../../lib/roadtrip/roadtripView";
import { countryName } from "../../shared/geo/countryCode";
import type { RoadtripSummary } from "../../types/roadtrip";
import { useRoadtripSpan } from "./useRoadtripSpan";

export type RoadtripColumnId =
  "name" | "vehicle" | "dates" | "trip" | "countries" | "stations" | "distance";

export const ROADTRIP_COLUMN_IDS: readonly RoadtripColumnId[] = [
  "name",
  "vehicle",
  "dates",
  "trip",
  "countries",
  "stations",
  "distance",
];

/** The name grows; figures are mono and step aside last-first, as in the other logbook tables. */
export const ROADTRIP_COLUMN_LAYOUT: Record<
  RoadtripColumnId,
  Omit<TableColumn, "key" | "label">
> = {
  name: { min: 220, grow: 2, onNarrow: "title" },
  vehicle: { min: 120, grow: 1, priority: 2 },
  dates: { min: 190, mono: true, onNarrow: "subtitle" },
  trip: { min: 120, grow: 1, priority: 3 },
  countries: { min: 130, grow: 1, priority: 3 },
  stations: { min: 90, align: "end", mono: true, priority: 2 },
  distance: { min: 100, align: "end", mono: true, onNarrow: "trailing" },
};

interface Props {
  roadtrip: RoadtripSummary;
  phase: RoadtripPhase;
  columns: readonly TableColumn[];
  onOpen: () => void;
}

/**
 * One roadtrip as a table row. A figure that is not known is a dash and the
 * reason is written under the name — never a zero, never hover-only
 * (forgejo#249).
 */
export function RoadtripTableRow({ roadtrip: r, phase, columns, onOpen }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips"]);
  const span = useRoadtripSpan();
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  // Legs are measured when a save creates them, so a distance exists as soon
  // as there are two stations; before that there is nothing to measure.
  const kmKnown = r.stationCount >= 2;
  const reason = kmKnown ? null : t("roadtrips:list.kmUnknown");

  const cell: Record<string, JSX.Element | string> = {
    name: (
      <span className="flex min-w-0 flex-col" style={{ gap: 2 }}>
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{r.name}</span>
          {phase === "planned" && (
            <Pill color="var(--ts-info)">{t("roadtrips:phase.planned")}</Pill>
          )}
        </span>
        {reason && (
          <span className="t-caption" data-testid="roadtrip-row-reasons">
            {reason}
          </span>
        )}
      </span>
    ),
    vehicle: (
      <span style={{ color: "var(--domain-roadtrip)" }}>
        {[
          r.vehicle ? t(`roadtrips:vehicle.${r.vehicle}`) : null,
          r.vehicleName ? `„${r.vehicleName}“` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "—"}
      </span>
    ),
    dates: span(r),
    trip: <span className="text-(--text-muted)">{r.tripName ?? "—"}</span>,
    countries: r.countries.map((c) => countryName(c, i18n.language) || c).join(" · ") || "—",
    stations: nf.format(r.stationCount),
    distance: kmKnown ? `${nf.format(r.drivenKm)} km` : "—",
  };

  return (
    <TableRow
      columns={columns}
      onClick={onOpen}
      testId={`roadtrip-row-${r.id}`}
      cells={columns.map((column) => cell[column.key])}
    />
  );
}
