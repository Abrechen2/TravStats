import type { ReactNode } from "react";
import { appLocale } from "../../../lib/units";
import { formatDayLong } from "../../../shared/time";
import { Button, Card, Pill } from "../../../components/ui";
import { useTranslation } from "../../../hooks/useTranslation";
import type {
  PlanStage,
  PlanState,
  PlanStation,
  PlanStationWeather,
  RouteSchedule,
} from "../../../lib/api/travplan";
import { PlanActions, PlanGrow } from "../planLayout";
import {
  dayTripsOf,
  formatMinutes,
  linkOf,
  nightTone,
  stageTone,
  wroteRecords,
  type RouteTone,
} from "./routeModel";

/** Booked is solid, a placeholder dashed in the accent, spontaneous dashed and neutral, own driving good. */
export const TONE: Record<RouteTone, { color: string; dashed: boolean }> = {
  booked: { color: "var(--ts-info)", dashed: false },
  placeholder: { color: "var(--ts-accent)", dashed: true },
  own: { color: "var(--ts-good)", dashed: false },
  spontaneous: { color: "var(--ts-muted)", dashed: true },
  undecided: { color: "var(--ts-warn)", dashed: true },
  idea: { color: "var(--ts-info)", dashed: true },
};

export const shortDay = (day: string | null) =>
  day
    ? formatDayLong(day, appLocale(), { weekday: "short", day: "numeric", month: "short" })
    : null;

function TonePill({ tone }: { tone: RouteTone }) {
  const { t } = useTranslation("travplan");
  return (
    <Pill color={TONE[tone].color} dashed={TONE[tone].dashed}>
      {t("route.tone." + tone)}
    </Pill>
  );
}

function weatherLine(
  weather: PlanStationWeather | undefined,
  t: (k: string, o?: Record<string, unknown>) => string
) {
  const day = weather?.days.find((d) => d.max !== null || d.min !== null);
  if (!weather || !day) return t("route.station.noWeather");
  const range = [day.min, day.max].map((v) => (v === null ? "–" : `${Math.round(v)}°`)).join(" / ");
  return `${t("route.station.weather." + weather.kind)} · ${range}${weather.window ? " · " + weather.window : ""}`;
}

export function StationCard({
  state,
  station,
  index,
  total,
  schedule,
  canHandOver,
  busy,
  onEdit,
  onMove,
  onRemove,
  onHandover,
  onWithdraw,
}: {
  state: PlanState;
  station: PlanStation;
  index: number;
  total: number;
  schedule: RouteSchedule | undefined;
  canHandOver: boolean;
  busy: boolean;
  onEdit: () => void;
  onMove: (toIndex: number) => void;
  onRemove: () => void;
  onHandover: () => void;
  onWithdraw: () => void;
}) {
  const { t } = useTranslation("travplan"),
    tone = nightTone(station, state.bookings),
    when = schedule?.stations.find((s) => s.stationId === station.id),
    link = linkOf(state, station.id),
    trips = dayTripsOf(state, station.id),
    weather = state.stationWeather.find((w) => w.stationId === station.id);
  const arrive = shortDay(when?.arriveDay ?? null),
    depart = shortDay(when?.departDay ?? null);
  const candidates = station.night.kind === "idea" ? station.night.candidates : [];
  return (
    <Card
      style={{
        borderStyle: TONE[tone].dashed ? "dashed" : "solid",
        borderColor: TONE[tone].color,
      }}
    >
      <div className="flex min-w-0 flex-wrap items-start" style={{ gap: "var(--ts-space-lg)" }}>
        <PlanGrow>
          <p className="t-label-mono">
            {index + 1} / {total}
            {arrive
              ? ` · ${arrive}${depart && station.nights > 0 ? " – " + depart : ""}`
              : ` · ${t("route.station.dayUnknown")}`}
          </p>
          <h3 className="t-card-title">{station.title}</h3>
          <p className="t-caption">
            {[station.place.country, station.place.zone].filter(Boolean).join(" · ")}
          </p>
        </PlanGrow>
        <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
          <Pill color="var(--ts-muted)">
            {t("route.station.nightsCount", { count: station.nights })}
          </Pill>
          <TonePill tone={tone} />
          {link && <Pill color="var(--ts-good)">{t("route.handover.inLogbook")}</Pill>}
        </div>
      </div>
      <p className="t-body">{t("route.night." + station.night.kind)}</p>
      {candidates.length > 0 && (
        <ul className="t-body" style={{ paddingLeft: "var(--ts-space-xl)", listStyle: "disc" }}>
          {candidates.map((c) => (
            <li key={c.id}>{c.title}</li>
          ))}
        </ul>
      )}
      {trips.length > 0 && (
        <p className="t-caption">
          {t("route.station.dayTrips", { count: trips.length })}:{" "}
          {trips.map((i) => i.title).join(", ")}
        </p>
      )}
      <p className="t-caption">{weatherLine(weather, t)}</p>
      {station.note && <p className="t-body">{station.note}</p>}
      {link && link.created.length > 0 && (
        <p className="t-caption">{t("route.handover.records", { count: link.created.length })}</p>
      )}
      <PlanActions>
        <Button disabled={busy} onClick={onEdit}>
          {t("edit")}
        </Button>
        <Button
          disabled={busy || index === 0}
          aria-label={t("route.station.up")}
          onClick={() => onMove(index - 1)}
        >
          ↑
        </Button>
        <Button
          disabled={busy || index === total - 1}
          aria-label={t("route.station.down")}
          onClick={() => onMove(index + 1)}
        >
          ↓
        </Button>
        <Button variant="danger" disabled={busy} onClick={onRemove}>
          {t("delete")}
        </Button>
        {canHandOver && !wroteRecords(state, station.id) && (
          <Button disabled={busy} onClick={onHandover}>
            {t("route.handover.confirm")}
          </Button>
        )}
        {wroteRecords(state, station.id) && (
          <Button disabled={busy} onClick={onWithdraw}>
            {t("route.handover.withdraw")}
          </Button>
        )}
      </PlanActions>
    </Card>
  );
}

export function StageRow({
  state,
  stage,
  from,
  to,
  busy,
  routing,
  onEdit,
  onRoute,
  onPlaceholder,
}: {
  state: PlanState;
  stage: PlanStage;
  from: PlanStation;
  to: PlanStation;
  busy: boolean;
  routing: boolean;
  onEdit: () => void;
  onRoute: () => void;
  onPlaceholder: () => void;
}) {
  const { t } = useTranslation("travplan"),
    tone = stageTone(stage, state.bookings),
    km = stage.distanceKm === null ? null : `${Math.round(stage.distanceKm)} km`,
    time = formatMinutes(stage.durationMinutes),
    figures: ReactNode =
      km || time ? [km, time].filter(Boolean).join(" · ") : t("route.stage.notMeasured"),
    routable = stage.mode === "drive" || stage.mode === "ferry";
  return (
    <div
      className="flex min-w-0 flex-wrap items-center"
      style={{
        gap: "var(--ts-space-md)",
        marginLeft: "var(--ts-space-xl)",
        paddingLeft: "var(--ts-space-lg)",
        borderLeft: `thick ${TONE[tone].dashed ? "dashed" : "solid"} ${TONE[tone].color}`,
      }}
    >
      <PlanGrow>
        <p className="t-body">
          {t("route.mode." + stage.mode)}
          {stage.overnight ? ` · ${t("route.stage.overnightShort")}` : ""} · {from.title} →{" "}
          {to.title}
        </p>
        <p className="t-caption">
          {figures}
          {stage.metricsSource && ` · ${t("route.stage.source." + stage.metricsSource)}`}
        </p>
        {stage.fallbackReason && (
          <p className="t-caption" role="status" style={{ color: "var(--ts-warn)" }}>
            {t("route.stage.reason", {
              reason: t("route.stage.reasons." + stage.fallbackReason, {
                defaultValue: stage.fallbackReason,
              }),
            })}
          </p>
        )}
      </PlanGrow>
      <TonePill tone={tone} />
      <PlanActions>
        {routable && (
          <Button disabled={busy || routing} onClick={onRoute}>
            {routing ? t("route.stage.routing") : t("route.stage.recalculate")}
          </Button>
        )}
        {tone === "undecided" && (
          <Button disabled={busy} onClick={onPlaceholder}>
            {t("route.stage.placeholder")}
          </Button>
        )}
        <Button disabled={busy} onClick={onEdit}>
          {t("edit")}
        </Button>
      </PlanActions>
    </div>
  );
}
