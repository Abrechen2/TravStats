import { useState } from "react";
import { Button, Card, EmptyState, Pill, Select } from "../../../components/ui";
import { useTranslation } from "../../../hooks/useTranslation";
import { entryRecord, type PlanCtx } from "../planContext";
import { newEntry } from "../editorModel";
import { PlanCheck } from "../PlanParts";
import { StageEditor } from "../route/StageEditor";
import { NightStepper } from "../route/NightStepper";
import { planDay, planRange } from "../format";
import { PlanLink, PlanNotice } from "../planLayout";
import { formatMinutes, nightTone, stageTone } from "../route/routeModel";
import { TONE } from "../route/RouteTimeline";
import { assignIdeaToDay } from "../ideaAssignment";
import { buildDayPlan, foldQuietDays, type DayLeg, type DaySpan } from "./dayPlan";
import { IdeaPicker, unplannedIdeas } from "./IdeaPicker";
import { ItemLine } from "./ItemLine";
import { QuickStop } from "./QuickStop";

function LegLine({ leg, ctx, onEdit }: { leg: DayLeg; ctx: PlanCtx; onEdit: () => void }) {
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
      <Button
        disabled={ctx.busy}
        aria-label={t("days.editLeg", { from: leg.from.title, to: leg.to.title })}
        onClick={onEdit}
      >
        {t("edit")}
      </Button>
    </li>
  );
}

function DayCard({
  span,
  last,
  ctx,
  onEditLeg,
}: {
  span: DaySpan;
  last: boolean;
  ctx: PlanCtx;
  onEditLeg: (stageId: string) => void;
}) {
  const { t } = useTranslation("travplan"),
    row = span.row,
    spanDays = ctx.days.slice(span.first, span.last + 1),
    [chosen, setChosen] = useState(row.day),
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
          <LegLine key={leg.stage.id} leg={leg} ctx={ctx} onEdit={() => onEditLeg(leg.stage.id)} />
        ))}
        {row.items.map((i) => (
          <ItemLine
            key={i.id}
            item={i}
            state={ctx.state}
            days={ctx.days}
            busy={ctx.busy}
            onWrite={(op) => void ctx.mutate(op)}
          />
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
          <li key={task.id}>
            <PlanCheck
              checked={task.done}
              disabled={ctx.busy}
              onChange={(done) =>
                void ctx.mutate({
                  type: "upsert",
                  collection: "tasks",
                  value: entryRecord({ ...task, done }),
                })
              }
            >
              {t("days.task", { title: task.title })}
            </PlanCheck>
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
      {route && !last && row.night && (
        <div style={{ marginTop: "var(--ts-space-sm)" }}>
          <NightStepper
            state={ctx.state}
            station={row.night}
            busy={ctx.busy}
            onWrite={(op) => void ctx.mutate(op)}
          />
        </div>
      )}
      <div
        className="flex flex-wrap items-center"
        style={{ gap: "var(--ts-space-sm)", marginTop: "var(--ts-space-md)" }}
      >
        {spanDays.length > 1 && (
          <Select
            aria-label={t("days.pickDay")}
            value={chosen}
            disabled={ctx.busy}
            onChange={(e) => setChosen(e.target.value)}
            style={{ width: "12rem", flex: "none" }}
          >
            {spanDays.map((d) => (
              <option key={d} value={d}>
                {planDay(d)}
              </option>
            ))}
          </Select>
        )}
        <Button
          disabled={ctx.busy}
          onClick={() =>
            ctx.edit("items", newEntry("items", ctx.state.timezone, ctx.state.currency, chosen))
          }
        >
          {t("days.addEntry")}
        </Button>
        <QuickStop
          vehicle={ctx.state.vehicle?.kind ?? null}
          busy={ctx.busy}
          onPick={(title, duration) =>
            ctx.edit("items", {
              ...newEntry("items", ctx.state.timezone, ctx.state.currency, chosen),
              title,
              duration,
            })
          }
        />
        <IdeaPicker
          day={chosen}
          ideas={unplannedIdeas(ctx.state)}
          busy={ctx.busy}
          onAssign={(ideaId, day) => {
            const op = assignIdeaToDay(ctx.state, ideaId, day);
            if (op) void ctx.mutate(op);
          }}
        />
      </div>
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
    dayPlan = buildDayPlan(state, plan.schedule, days),
    [editStage, setEditStage] = useState<string | null>(null),
    stage = state.stages.find((g) => g.id === editStage);
  if (!days.length)
    return (
      <EmptyState
        title={t("days.noDates")}
        description={t("days.noDatesHint")}
        action={
          ctx.editTrip ? (
            <Button variant="primary" onClick={ctx.editTrip}>
              {t("days.setDates")}
            </Button>
          ) : undefined
        }
      />
    );
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
        <DayCard
          key={span.row.day}
          span={span}
          last={span.last === days.length - 1}
          ctx={ctx}
          onEditLeg={setEditStage}
        />
      ))}
      {stage && (
        <StageEditor
          key={stage.id}
          stage={stage}
          title={t("route.stage.edit")}
          busy={ctx.busy}
          onClose={() => setEditStage(null)}
          onSave={(value) =>
            ctx.mutate({ type: "upsert", collection: "stages", value: entryRecord(value) })
          }
        />
      )}
    </div>
  );
}
