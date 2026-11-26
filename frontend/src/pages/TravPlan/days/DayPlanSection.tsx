import { Card, EmptyState, Pill } from "../../../components/ui";
import { useTranslation } from "../../../hooks/useTranslation";
import type { PlanCtx } from "../planContext";
import { planDay, planRange } from "../format";
import { PlanLink, PlanNotice } from "../planLayout";
import { formatMinutes, nightTone, stageTone } from "../route/routeModel";
import { TONE } from "../route/RouteTimeline";
import { buildDayPlan, foldQuietDays, type DayLeg, type DaySpan } from "./dayPlan";

function LegLine({ leg, ctx }: { leg: DayLeg; ctx: PlanCtx }) {
  const { t } = useTranslation("travplan"),
    tone = stageTone(leg.stage, ctx.state.bookings),
    km = leg.stage.distanceKm === null ? null : `${Math.round(leg.stage.distanceKm)} km`,
    time = formatMinutes(leg.stage.durationMinutes);
  return (
    <li className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
      <span className="t-body">
        {t("route.mode." + leg.stage.mode)}: {leg.from.title} → {leg.to.title}
      </span>
      <span className="t-caption">
        {[km, time].filter(Boolean).join(" · ") || t("days.notMeasured")}
      </span>
      <Pill color={TONE[tone].color} dashed={TONE[tone].dashed}>
        {t("route.tone." + tone)}
      </Pill>
    </li>
  );
}

function DayCard({ span, last, ctx }: { span: DaySpan; last: boolean; ctx: PlanCtx }) {
  const { t } = useTranslation("travplan"),
    row = span.row,
    route = ctx.state.shape === "route",
    empty = !row.legs.length && !row.items.length && !row.bookings.length && !row.tasks.length;
  return (
    <Card>
      <div
        className="flex flex-wrap items-baseline justify-between"
        style={{ gap: "var(--ts-space-md)" }}
      >
        <h2 className="t-card-title">
          {span.first === span.last ? planDay(row.day) : planRange(row.day, span.lastDay)}
        </h2>
        <span className="t-caption">
          {span.first === span.last
            ? t("days.number", { n: span.first + 1 })
            : t("days.numbers", { from: span.first + 1, to: span.last + 1 })}
          {row.free ? " · " + t("options.free") : ""}
        </span>
      </div>
      <ul
        className="flex flex-col"
        style={{ gap: "var(--ts-space-sm)", marginTop: "var(--ts-space-md)" }}
      >
        {row.legs.map((leg) => (
          <LegLine key={leg.stage.id} leg={leg} ctx={ctx} />
        ))}
        {row.items.map((i) => (
          <li key={i.id} className="t-body">
            {i.time ? <span className="t-caption">{i.time} </span> : null}
            {i.title}
            {i.place ? <span className="t-caption"> · {i.place}</span> : null}
          </li>
        ))}
        {row.bookings.map((b) => (
          <li key={b.id} className="t-body">
            {b.time ? <span className="t-caption">{b.time} </span> : null}
            {b.title}
            <span className="t-caption">
              {" · "}
              {t(b.placeholder ? "route.tone.placeholder" : "route.tone.booked")}
            </span>
          </li>
        ))}
        {row.tasks.map((task) => (
          <li key={task.id} className="t-body">
            {t("days.task", { title: task.title })}
          </li>
        ))}
        {empty && <li className="t-caption">{t("days.empty")}</li>}
      </ul>
      {route && !last && (
        <p className="t-body" style={{ marginTop: "var(--ts-space-md)" }}>
          {row.night ? (
            <>
              {t("days.night", { place: row.night.title })}{" "}
              <Pill
                color={TONE[nightTone(row.night, ctx.state.bookings)].color}
                dashed={TONE[nightTone(row.night, ctx.state.bookings)].dashed}
              >
                {t("route.night." + row.night.night.kind)}
              </Pill>
            </>
          ) : (
            <span style={{ color: "var(--ts-warn)" }}>{t("days.nightUnknown")}</span>
          )}
        </p>
      )}
    </Card>
  );
}

/**
 * The trip day by day: where the night is spent, which leg is travelled, and what is planned,
 * booked or still to do on that day. A day the route cannot place yet says so instead of
 * borrowing the night before.
 */
export function DayPlanSection({ ctx }: { ctx: PlanCtx }) {
  const { t } = useTranslation("travplan"),
    { state, plan, days, prefix } = ctx,
    dayPlan = buildDayPlan(state, plan.schedule, days);
  if (!days.length)
    return <EmptyState title={t("days.noDates")} description={t("days.noDatesHint")} />;
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
      {dayPlan.undated.length > 0 && (
        <PlanNotice>
          {t("days.undated", {
            places: [...new Set(dayPlan.undated.map((s) => s.title))].join(", "),
          })}{" "}
          <PlanLink to={prefix + "/workspace"}>{t("days.toRoute")}</PlanLink>
        </PlanNotice>
      )}
      {foldQuietDays(dayPlan.days).map((span) => (
        <DayCard key={span.row.day} span={span} last={span.last === days.length - 1} ctx={ctx} />
      ))}
    </div>
  );
}
