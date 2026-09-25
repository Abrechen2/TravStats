import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate } from "react-router-dom";

import Button from "../ui/Button";
import Pill from "../ui/Pill";
import { useTranslation } from "../../hooks/useTranslation";
import { roadtripsApi } from "../../lib/api/roadtrips";
import { logger } from "../../lib/logger";
import {
  currentStationIndex,
  dayNumber,
  nextStation,
  spanDays,
} from "../../lib/roadtrip/roadtripView";
import type { RoadtripDetail, RoadtripSummary } from "../../types/roadtrip";
import RoadtripSketch from "./RoadtripSketch";
import { useRoadtripSpan } from "./RoadtripCard";

/**
 * The roadtrip the reader is on right now, first on the list (board 1).
 * What matters on the road is where you are tonight and what comes next, so
 * the card says both and offers the one thing most often done from here:
 * recording tonight's night.
 *
 * The station names need the detail — the list carries only the summary —
 * so they arrive a moment later; until then the card shows what it has.
 */
export default function UnderwayCard({
  roadtrip: r,
  today,
}: {
  roadtrip: RoadtripSummary;
  today: string;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  const span = useRoadtripSpan();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<RoadtripDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    roadtripsApi
      .get(r.id)
      .then((d) => !cancelled && setDetail(d))
      // The card stands without the station names; say so in the log only.
      .catch((err: unknown) => logger.warn("Loading the current roadtrip's stations failed", err));
    return () => {
      cancelled = true;
    };
  }, [r.id]);

  const day = dayNumber(r.startDate, today);
  const total = spanDays(r.startDate, r.endDate);
  const current = detail ? detail.stations[currentStationIndex(detail.stations, today)] : undefined;
  const next = detail ? nextStation(detail.stations, today) : null;

  return (
    <div
      className="grid overflow-hidden md:grid-cols-[280px_minmax(0,1fr)_260px]"
      style={{
        borderRadius: "var(--ts-radius-card)",
        background: "var(--ts-surface)",
        border: "1px solid color-mix(in srgb, var(--domain-roadtrip) 45%, transparent)",
      }}
    >
      <RoadtripSketch points={r.points} height={170} />
      <div
        className="flex flex-col"
        style={{ padding: "var(--ts-space-lg)", gap: "var(--ts-space-sm)" }}
      >
        <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
          {r.vehicle && (
            <Pill color="var(--domain-roadtrip)">
              {t(`roadtrips:vehicle.${r.vehicle}`)}
              {r.vehicleName ? ` · „${r.vehicleName}“` : ""}
            </Pill>
          )}
          {day !== null && (
            <Pill color="var(--ts-good)">
              {total !== null
                ? t("roadtrips:phase.underway", { day, total })
                : t("roadtrips:phase.underwayOpen", { day })}
            </Pill>
          )}
        </div>
        <span style={{ fontSize: 22, fontWeight: 800, color: "var(--ts-text-bright)" }}>
          {r.name}
        </span>
        <span className="t-caption">
          {[span(r), r.countries.join(" · ") || null, r.tripName].filter(Boolean).join(" · ")}
        </span>
        {current && (
          <span style={{ fontSize: 14 }}>
            {current.stay
              ? t("roadtrips:list.todayStay", {
                  station: current.title,
                  stay: current.stay.lodgingName,
                })
              : t("roadtrips:list.today", { station: current.title })}
          </span>
        )}
        {next && (
          <span className="t-caption">{t("roadtrips:list.next", { station: next.title })}</span>
        )}
      </div>
      <div
        className="flex flex-col justify-center md:border-l"
        style={{
          padding: "var(--ts-space-lg)",
          gap: "var(--ts-space-sm)",
          borderColor: "var(--ts-border)",
        }}
      >
        <Button
          variant="primary"
          block
          onClick={() => navigate(`/roadtrips/${r.id}?station=heute`)}
        >
          {t("roadtrips:list.enterTonight")}
        </Button>
        <Link
          to={`/roadtrips/${r.id}`}
          className="flex items-center justify-center"
          style={{
            minHeight: "var(--ts-size-touch-min)",
            borderRadius: "var(--ts-radius-button)",
            border: "1px solid var(--ts-border-button)",
            color: "var(--ts-text)",
            textDecoration: "none",
            fontSize: 14,
          }}
        >
          {t("roadtrips:list.open")}
        </Link>
      </div>
    </div>
  );
}
