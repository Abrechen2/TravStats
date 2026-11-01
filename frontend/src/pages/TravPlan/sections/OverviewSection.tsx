import { useTranslation } from "../../../hooks/useTranslation";
import { Card, HeroCard, Pill, StatTile, StatusPill } from "../../../components/ui";
import { daysBetween, todayIn } from "../../../shared/time";
import { PlanCardHead, PlanGrid, PlanGrow, PlanLink, PlanRow, PlanStack } from "../planLayout";
import { PlanMetrics } from "../PlanParts";
import { shortDay } from "../route/RouteTimeline";
import { FindingCards } from "./FindingCards";
import type { PlanCtx } from "../planContext";

const NIGHT_CODES = ["nightGap", "nightUndecided", "hotelDates"];
const TRANSPORT_CODES = ["stageUndecided", "stageMissing", "transferOpen", "durationMissing"];

/** A countdown that never claims more than the dates say. */
function countdown(start: string | null, end: string | null, today: string) {
  if (!start) return { key: "unknown", count: 0 };
  const until = daysBetween(today, start);
  if (until > 1) return { key: "in", count: until };
  if (until === 1) return { key: "tomorrow", count: 1 };
  if (end && today > end) return { key: "over", count: 0 };
  return until === 0 ? { key: "today", count: 0 } : { key: "running", count: -until + 1 };
}

/**
 * Overview (board 1): countdown, what is ready, the money, the next three things to do, and the
 * way on to the handover. Tasks live in "Packen & Aufgaben" only - shown once.
 */
export function OverviewSection({ ctx }: { ctx: PlanCtx }) {
  const { t } = useTranslation("travplan"),
    { plan, state, prefix } = ctx,
    today = todayIn(state.timezone ?? "UTC"),
    count = countdown(state.startDay, state.endDay, today),
    codes = new Set(plan.findings.map((f) => f.code)),
    openTasks = state.tasks.filter((x) => !x.done).length,
    packedAll = state.packing.length > 0 && state.packing.every((p) => p.packed),
    planned = state.shape === "route" ? state.stations.length > 0 : state.items.length > 0,
    readiness: { key: string; ok: boolean; to: string }[] = [
      { key: "planned", ok: planned, to: "workspace" },
      { key: "nights", ok: planned && !NIGHT_CODES.some((c) => codes.has(c)), to: "workspace" },
      {
        key: "transport",
        ok: planned && !TRANSPORT_CODES.some((c) => codes.has(c)),
        to: "transfer",
      },
      { key: "tasks", ok: state.tasks.length > 0 && openTasks === 0, to: "packing" },
      { key: "packing", ok: packedAll, to: "packing" },
    ],
    forecastDay = state.forecast?.days.find((d) => d.max !== null || d.min !== null);
  return (
    <>
      <HeroCard>
        <PlanStack>
          <div>
            <StatusPill status={state.status === "ready" ? "flown" : "scheduled"}>
              {t(state.status === "ready" ? "readyStatus" : "planningStatus")}
            </StatusPill>
          </div>
          <h2 className="t-card-title">{state.destination || plan.name}</h2>
          <p className="t-body">
            {t("overview.countdown." + count.key, { count: count.count })}
            {state.startDay &&
              ` · ${shortDay(state.startDay)}${state.endDay ? " – " + shortDay(state.endDay) : ""}`}
          </p>
          <div>
            <PlanLink variant="primary" to={prefix + "/workspace"}>
              {t("continue")}
            </PlanLink>
          </div>
        </PlanStack>
      </HeroCard>
      <div
        className="grid grid-cols-2 lg:grid-cols-4"
        style={{ gap: "var(--ts-space-lg)", marginTop: "var(--ts-space-xl)" }}
      >
        <StatTile
          value={state.shape === "route" ? state.stations.length : state.items.length}
          label={t(state.shape === "route" ? "route.stats.stations" : "overview.items")}
        />
        <StatTile value={state.bookings.length} label={t("sections.import")} />
        <StatTile value={state.ideas.length} label={t("overview.ideas")} />
        <StatTile value={openTasks} label={t("overview.openTasks")} />
      </div>
      <PlanMetrics budget={plan.budget} />
      <PlanGrid>
        <PlanStack>
          <h2 className="t-card-title">{t("overview.next")}</h2>
          {plan.findings.length === 0 && <p className="t-body">{t("overview.nothingNext")}</p>}
          <FindingCards ctx={ctx} />
          <p className="t-caption">{t("noPush")}</p>
        </PlanStack>
        <PlanStack>
          <Card>
            <PlanCardHead title={t("overview.ready")} />
            {readiness.map((r) => (
              <PlanRow key={r.key}>
                <PlanGrow>{t("overview.readiness." + r.key)}</PlanGrow>
                <Pill color={r.ok ? "var(--ts-good)" : "var(--ts-warn)"} dashed={!r.ok}>
                  {t(r.ok ? "overview.done" : "overview.open")}
                </Pill>
                {!r.ok && <PlanLink to={prefix + "/" + r.to}>{t("edit")}</PlanLink>}
              </PlanRow>
            ))}
          </Card>
          <Card>
            <PlanCardHead title={t("overview.weather")} />
            <p className="t-body">
              {forecastDay
                ? `${shortDay(forecastDay.day)} · ${forecastDay.min ?? "–"}° / ${forecastDay.max ?? "–"}°`
                : t("weatherUnknown")}
            </p>
            <PlanLink to={prefix + "/packing"}>{t("overview.weatherMore")}</PlanLink>
          </Card>
          <Card>
            <PlanCardHead title={t("sections.handover")} />
            <p className="t-body">{t("overview.handoverBody")}</p>
            <PlanLink to={prefix + "/handover"}>{t("overview.handoverOpen")}</PlanLink>
          </Card>
        </PlanStack>
      </PlanGrid>
    </>
  );
}
