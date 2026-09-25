import type { CSSProperties, JSX } from "react";
import { Link } from "react-router-dom";

import Pill from "../ui/Pill";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import {
  arrivalDay,
  departureDay,
  isStayCancelled,
  stationRows,
} from "../../lib/roadtrip/roadtripView";
import type { RoadtripDayTour, RoadtripStation } from "../../types/roadtrip";
import type { TourLeg } from "../../types/tour";
import StationMarker from "./StationMarker";

const CHIP: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  borderRadius: 999,
  padding: "2px 9px",
  fontSize: 12,
};

const STATE_CHIP: Record<RoadtripStation["state"], CSSProperties> = {
  stay: {
    ...CHIP,
    background: "var(--domain-lodging-soft)",
    border: "1px solid color-mix(in srgb, var(--domain-lodging) 42%, transparent)",
    color: "var(--domain-lodging)",
  },
  free: {
    ...CHIP,
    background: "var(--domain-roadtrip-soft)",
    border: "1px solid color-mix(in srgb, var(--domain-roadtrip) 42%, transparent)",
    color: "var(--domain-roadtrip)",
  },
  pass: { ...CHIP, border: "1px solid var(--ts-border)", color: "var(--ts-muted)" },
};

/** The line between two stations carries the leg's pattern: road solid, ferry dotted. */
function legLine(leg: TourLeg, planned: boolean): CSSProperties {
  if (leg.mode === "ferry") {
    return {
      width: 3,
      background: "repeating-linear-gradient(var(--domain-cruise) 0 4px, transparent 4px 9px)",
    };
  }
  if (planned) {
    return {
      width: 3,
      background:
        "repeating-linear-gradient(color-mix(in srgb, var(--domain-roadtrip) 60%, transparent) 0 6px, transparent 6px 11px)",
    };
  }
  return { width: 3, borderRadius: 2, background: "var(--domain-roadtrip)" };
}

/**
 * A roadtrip read as the design draws it (board 2): stations under the day
 * they were reached, the state of each night as a shape AND a word, the leg
 * to the next station between them, and the day tours that set out from a
 * station hanging under it. Clicking a station selects it — the page rings
 * it on the map — and in edit mode a leg opens its own dialog.
 */
export default function StationTimeline({
  stations,
  legs,
  tours,
  startDate,
  today,
  selectedId,
  onSelect,
  onEditLeg,
  onStartTour,
}: {
  stations: RoadtripStation[];
  legs: TourLeg[];
  tours: RoadtripDayTour[];
  startDate: string | null;
  today: string;
  selectedId: string | null;
  onSelect: (station: RoadtripStation) => void;
  /** Present in edit mode: a leg becomes a button. */
  onEditLeg?: (leg: TourLeg, from: RoadtripStation, to: RoadtripStation) => void;
  /** Start a day tour from this station; absent = read-only. */
  onStartTour?: (station: RoadtripStation) => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips"]);
  const display = useDisplayFormat();
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const legFrom = new Map(legs.map((l) => [l.fromStopId, l]));
  const rows = stationRows(stations, startDate, today);

  const short = (day: string): string =>
    display.date(`${day}T00:00:00Z`, { timeZone: "UTC", omitYear: true });
  const weekday = (day: string): string =>
    new Intl.DateTimeFormat(i18n.language, { weekday: "short", timeZone: "UTC" }).format(
      new Date(`${day}T00:00:00Z`)
    );

  const nightText = (s: RoadtripStation): { text: string; warn: boolean } | null => {
    const from = arrivalDay(s);
    const to = departureDay(s);
    if (isStayCancelled(s)) return { text: t("roadtrips:timeline.cancelled"), warn: true };
    if (s.state === "pass") return from ? { text: short(from), warn: false } : null;
    if (from && !to) return { text: t("roadtrips:timeline.approxNight"), warn: true };
    if (!from) return null;
    const nights =
      s.state === "stay" && s.stay?.nights != null
        ? s.stay.nights
        : Math.max(1, Math.round((Date.parse(to as string) - Date.parse(from)) / 86_400_000));
    return {
      text: `${t("roadtrips:nightsCount", { count: nights })} · ${short(from)} – ${short(to as string)}`,
      warn: false,
    };
  };

  const duration = (minutes: number): string =>
    t("roadtrips:timeline.duration", {
      h: Math.floor(minutes / 60),
      m: String(minutes % 60).padStart(2, "0"),
    });

  if (stations.length === 0) {
    return <p className="t-caption">{t("roadtrips:stations.empty")}</p>;
  }

  return (
    <ol className="flex flex-col" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {rows.map(({ station: s, day, isToday, isPlanned }, index) => {
        const next = stations[index + 1];
        const leg = next ? legFrom.get(s.id) : undefined;
        const ownTours = tours.filter((tour) => tour.anchorStopId === s.id);
        const night = nightText(s);
        const selected = s.id === selectedId;
        const cancelled = isStayCancelled(s);
        return (
          <li key={s.id}>
            {day && (
              <div className="flex items-baseline" style={{ gap: 10, padding: "14px 0 6px 42px" }}>
                <span className="t-label-mono" style={{ color: "var(--domain-roadtrip)" }}>
                  {day.number !== null ? t("roadtrips:timeline.day", { n: day.number }) : ""}
                </span>
                <span className="t-caption">
                  {weekday(day.key)} {short(day.key)}
                </span>
              </div>
            )}
            <div
              className="grid"
              style={{
                gridTemplateColumns: "32px minmax(0, 1fr)",
                gap: 10,
                padding: "10px 12px 10px 0",
                borderRadius: "var(--ts-radius-button)",
                background: selected ? "var(--domain-roadtrip-soft)" : "transparent",
                boxShadow: selected
                  ? "inset 0 0 0 1px color-mix(in srgb, var(--domain-roadtrip) 35%, transparent)"
                  : undefined,
                opacity: isPlanned ? 0.8 : 1,
              }}
            >
              <div className="flex justify-center" style={{ paddingTop: 2 }}>
                <StationMarker state={s.state} cancelled={cancelled} selected={selected} />
              </div>
              <div className="flex min-w-0 flex-col" style={{ gap: 5 }}>
                <button
                  type="button"
                  onClick={() => onSelect(s)}
                  aria-pressed={selected}
                  className="flex flex-wrap items-baseline text-left"
                  style={{
                    gap: 8,
                    background: "none",
                    border: 0,
                    padding: 0,
                    color: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontSize: 16, fontWeight: 800, color: "var(--ts-text-bright)" }}>
                    {s.title}
                  </span>
                  {isToday && (
                    <Pill color="var(--ts-text-bright)">{t("roadtrips:timeline.today")}</Pill>
                  )}
                  {isPlanned && (
                    <Pill color="var(--ts-info)">{t("roadtrips:timeline.planned")}</Pill>
                  )}
                </button>
                <div className="flex flex-wrap items-center" style={{ gap: 8, fontSize: 13 }}>
                  <span style={STATE_CHIP[s.state]}>
                    {t(`roadtrips:editor.choice.${s.state}.label`)}
                  </span>
                  {s.stay && (
                    <Link
                      to={`/lodging/${s.stay.lodgingId}`}
                      style={{
                        color: "var(--domain-lodging)",
                        textDecoration: cancelled ? "line-through" : undefined,
                      }}
                    >
                      {s.stay.lodgingName}
                    </Link>
                  )}
                  {night && (
                    <span style={{ color: night.warn ? "var(--ts-warn)" : "var(--ts-muted)" }}>
                      {night.text}
                    </span>
                  )}
                </div>
                {(ownTours.length > 0 || onStartTour) && (
                  <div className="flex flex-col" style={{ gap: 6 }}>
                    {ownTours.map((tour) => (
                      <Link
                        key={tour.id}
                        to={`/tours/${tour.id}`}
                        className="flex items-center"
                        style={{
                          gap: 8,
                          padding: "7px 10px",
                          borderRadius: 10,
                          background: "var(--domain-tour-soft)",
                          border:
                            "1px solid color-mix(in srgb, var(--domain-tour) 30%, transparent)",
                          color: "inherit",
                          textDecoration: "none",
                          fontSize: 13,
                        }}
                      >
                        <span style={{ fontWeight: 700 }}>{tour.name}</span>
                        <span className="t-caption">
                          {[
                            tour.activity ? t(`roadtrips:activity.${tour.activity}`) : null,
                            tour.distanceKm > 0 ? `${nf.format(tour.distanceKm)} km` : null,
                            tour.ascentM !== null ? `↑ ${nf.format(tour.ascentM)} m` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </Link>
                    ))}
                    {onStartTour && (
                      <button
                        type="button"
                        onClick={() => onStartTour(s)}
                        className="self-start t-caption"
                        style={{
                          ...CHIP,
                          border: "1px dashed var(--ts-border)",
                          background: "none",
                          cursor: "pointer",
                        }}
                      >
                        {t("roadtrips:startTour")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            {leg && next && (
              <div
                className="grid items-center"
                style={{ gridTemplateColumns: "32px minmax(0, 1fr)", gap: 10, minHeight: 40 }}
              >
                <div className="flex justify-center self-stretch">
                  <div style={legLine(leg, rows[index + 1].isPlanned)} />
                </div>
                <LegLabel
                  leg={leg}
                  km={nf.format(leg.distanceKm)}
                  duration={leg.drivingMinutes !== null ? duration(leg.drivingMinutes) : null}
                  onEdit={onEditLeg ? () => onEditLeg(leg, s, next) : undefined}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function LegLabel({
  leg,
  km,
  duration,
  onEdit,
}: {
  leg: TourLeg;
  km: string;
  duration: string | null;
  onEdit?: () => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  const ferry = leg.mode === "ferry";
  const content = (
    <>
      <span
        style={{
          fontSize: 12,
          padding: "2px 8px",
          borderRadius: 7,
          border: `1.5px solid ${ferry ? "var(--domain-cruise)" : "color-mix(in srgb, var(--domain-roadtrip) 60%, transparent)"}`,
          color: ferry ? "var(--domain-cruise)" : "var(--domain-roadtrip)",
        }}
      >
        {t(`roadtrips:timeline.leg.${leg.mode}`)}
      </span>
      <span className="t-meta-mono">
        {km} km{duration ? ` · ${duration}` : ""}
      </span>
      <span className="t-caption">{t(`roadtrips:timeline.source.${leg.source}`)}</span>
    </>
  );
  if (!onEdit) {
    return (
      <div
        className="flex flex-wrap items-center"
        style={{ gap: 10, fontSize: 13, color: "var(--ts-muted)" }}
      >
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={t("roadtrips:timeline.legEdit")}
      className="flex flex-wrap items-center self-start"
      style={{
        gap: 10,
        fontSize: 13,
        color: "var(--ts-muted)",
        padding: "4px 10px",
        borderRadius: "var(--ts-radius-button)",
        border: "1px dashed var(--ts-border-button)",
        background: "none",
        cursor: "pointer",
      }}
    >
      {content}
    </button>
  );
}
