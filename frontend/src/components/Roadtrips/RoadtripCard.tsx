import type { JSX, ReactNode } from "react";
import { Link } from "react-router-dom";

import Pill from "../ui/Pill";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import type { RoadtripPhase } from "../../lib/roadtrip/roadtripView";
import type { RoadtripSummary } from "../../types/roadtrip";
import RoadtripSketch from "./RoadtripSketch";

/** "18.09. – 28.09.2026", or the undated word. */
export function useRoadtripSpan(): (r: Pick<RoadtripSummary, "startDate" | "endDate">) => string {
  const { t } = useTranslation(["roadtrips"]);
  const display = useDisplayFormat();
  return (r) => {
    if (!r.startDate) return t("roadtrips:undated");
    const to = r.endDate ?? r.startDate;
    if (to.slice(0, 10) === r.startDate.slice(0, 10)) {
      return display.date(r.startDate, { timeZone: "UTC" });
    }
    return `${display.date(r.startDate, { timeZone: "UTC", omitYear: true })} – ${display.date(to, { timeZone: "UTC" })}`;
  };
}

function Figure({
  value,
  label,
  title,
}: {
  value: ReactNode;
  label: string;
  title?: string;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col" title={title}>
      <span
        className="t-meta-mono"
        style={{ fontSize: 15, fontWeight: 600, color: "var(--ts-text-bright)" }}
      >
        {value}
      </span>
      <span className="t-caption">{label}</span>
    </div>
  );
}

/**
 * One roadtrip in the list (design 2026-09-25, board 1): the route sketch,
 * the vehicle, the name, when and where, and four figures. A figure that is
 * not known is a dash with its reason on hover — never a zero — and a night
 * count that is only a lower bound carries "≈".
 */
export default function RoadtripCard({
  roadtrip: r,
  phase,
}: {
  roadtrip: RoadtripSummary;
  phase: RoadtripPhase;
}): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips"]);
  const span = useRoadtripSpan();
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const vehicle = [
    r.vehicle ? t(`roadtrips:vehicle.${r.vehicle}`) : null,
    r.vehicleName ? `„${r.vehicleName}“` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // Legs are measured when a save creates them, so a distance exists as soon
  // as there are two stations; before that there is nothing to measure.
  const kmKnown = r.stationCount >= 2;

  return (
    <Link
      to={`/roadtrips/${r.id}`}
      className="flex flex-col overflow-hidden"
      style={{
        borderRadius: "var(--ts-radius-card)",
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-border)",
        color: "inherit",
        textDecoration: "none",
      }}
    >
      <div className="relative">
        <RoadtripSketch points={r.points} planned={phase === "planned"} />
        {phase === "planned" && (
          <span className="absolute" style={{ top: 10, left: 10 }}>
            <Pill color="var(--ts-info)">{t("roadtrips:phase.planned")}</Pill>
          </span>
        )}
      </div>
      <div
        className="flex flex-col"
        style={{ padding: "var(--ts-space-lg)", gap: "var(--ts-space-sm)" }}
      >
        {vehicle && (
          <span style={{ fontSize: 12, color: "var(--domain-roadtrip)" }}>{vehicle}</span>
        )}
        <span style={{ fontSize: 17, fontWeight: 800, color: "var(--ts-text-bright)" }}>
          {r.name}
        </span>
        <span className="t-caption">
          {[span(r), r.countries.join(" · ") || null, r.tripName].filter(Boolean).join(" · ")}
        </span>
        <div
          className="grid grid-cols-4"
          style={{
            gap: "var(--ts-space-sm)",
            paddingTop: "var(--ts-space-sm)",
            borderTop: "1px solid var(--ts-border)",
          }}
        >
          <Figure
            value={kmKnown ? nf.format(r.drivenKm) : "—"}
            label={t("roadtrips:list.figKm")}
            title={kmKnown ? undefined : t("roadtrips:list.kmUnknown")}
          />
          <Figure
            value={`${r.nightsKnown ? "" : "≈ "}${nf.format(r.nights)}`}
            label={t("roadtrips:list.figNights")}
            title={r.nightsKnown ? undefined : t("roadtrips:list.nightsApprox")}
          />
          <Figure value={nf.format(r.stationCount)} label={t("roadtrips:list.figStations")} />
          <Figure
            value={<span style={{ color: "var(--domain-tour)" }}>{nf.format(r.tourCount)}</span>}
            label={t("roadtrips:list.figTours")}
          />
        </div>
      </div>
    </Link>
  );
}
