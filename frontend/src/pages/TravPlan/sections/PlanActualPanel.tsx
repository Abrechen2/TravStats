import { useEffect, useState } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { Button, Card, EmptyState, StatusPill } from "../../../components/ui";
import { travplanApi, type PlanActual, type PlanStationStatus } from "../../../lib/api/travplan";
import { formatLocalDate } from "../../../lib/displayFormat";
import { PlanActions, PlanCardHead, PlanGrow, PlanNotice, PlanRow, PlanStack } from "../planLayout";
import type { PlanCtx } from "../planContext";
import { PlanActualSketch } from "./PlanActualSketch";

/**
 * Plan versus actual (TravTrack plan L5): where the route was planned to go
 * beside where the trip's track and accepted stays say it went. Read-only —
 * there is deliberately no "apply": the plan is never changed from here.
 */

const PILL: Record<PlanStationStatus, string> = {
  visited: "completed",
  shifted: "review",
  skipped: "cancelled",
  unknown: "historical",
};

const day = (d: string | null) => (d ? formatLocalDate(d, { omitYear: true }) : "—");
const span = (from: string | null, until: string | null) =>
  !from ? "—" : !until || until === from ? day(from) : `${day(from)} – ${day(until)}`;

type Load = { state: "loading" } | { state: "failed" } | { state: "ready"; data: PlanActual };

/**
 * What the comparison depends on in the plan: the trip's days and the
 * route's stations with the days the plan gives them. A packing item or a
 * note raises the revision without touching any of it, and must not cost a
 * read of the whole trip's track (Codex review of L5).
 */
function routeKey(ctx: PlanCtx): string {
  const { tripId, state, plan } = ctx;
  return JSON.stringify([
    tripId,
    state.startDay,
    state.endDay,
    state.stations.map((s) => [s.id, s.place.lat, s.place.lon, s.place.zone]),
    plan.schedule?.stations ?? null,
  ]);
}

export function PlanActualPanel({ ctx }: { ctx: PlanCtx }) {
  const { t } = useTranslation("travplan"),
    { state, tripId, onError } = ctx,
    [load, setLoad] = useState<Load>({ state: "loading" }),
    [reloads, setReloads] = useState(0),
    key = routeKey(ctx);
  // Asked on opening, when the route or the trip's days change, and on the user's refresh.
  useEffect(() => {
    if (state.stations.length === 0) return;
    let live = true;
    setLoad({ state: "loading" });
    travplanApi
      .actual(tripId)
      .then((data) => {
        if (live) setLoad({ state: "ready", data });
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setLoad({ state: "failed" });
        onError(cause);
      });
    return () => {
      live = false;
    };
  }, [key, reloads]);

  if (state.stations.length === 0)
    return <EmptyState title={t("actual.noRoute")} description={t("actual.noRouteHint")} />;
  if (load.state === "loading") return <EmptyState kind="pending" title={t("loading")} />;
  if (load.state === "failed")
    return (
      <EmptyState kind="degraded" title={t("actual.failed")} description={t("errors.unknown")} />
    );

  const { data } = load;
  const titles = new Map(data.stations.map((s) => [s.stationId, s.title]));
  const delta = (s: PlanActual["stations"][number]) =>
    s.deltaDays === null || s.deltaDays === 0
      ? null
      : t(s.deltaDays > 0 ? "actual.later" : "actual.earlier", { count: Math.abs(s.deltaDays) });
  return (
    <PlanStack>
      <p className="t-body">{t("actual.intro")}</p>
      <PlanActions>
        <Button onClick={() => setReloads((n) => n + 1)}>{t("actual.refresh")}</Button>
      </PlanActions>
      {data.actual === null ? (
        <PlanNotice>{t("actual.noTrack")}</PlanNotice>
      ) : (
        <>
          <p className="t-caption">{t("actual.origin." + data.actual.origin)}</p>
          {data.actual.coverage === "truncated" && <PlanNotice>{t("actual.truncated")}</PlanNotice>}
          {data.actual.coverage === "unreachable" && (
            <PlanNotice tone="bad">{t("actual.unreachable")}</PlanNotice>
          )}
        </>
      )}
      <PlanActualSketch stations={state.stations} actual={data.actual} />
      <Card>
        <PlanCardHead title={t("actual.stations")} />
        {data.stations.map((s) => (
          <PlanRow key={s.stationId}>
            <PlanGrow>
              <div className="t-card-title">{s.title}</div>
              <div className="t-caption">
                {t("actual.planned")}: {span(s.plannedFrom, s.plannedUntil)}
                {s.actualFrom && ` · ${t("actual.there")}: ${span(s.actualFrom, s.actualUntil)}`}
                {delta(s) && ` · ${delta(s)}`}
              </div>
            </PlanGrow>
            <StatusPill status={PILL[s.status]}>{t("actual.status." + s.status)}</StatusPill>
          </PlanRow>
        ))}
      </Card>
      {data.stages.length > 0 && (
        <Card>
          <PlanCardHead title={t("actual.stages")} />
          {data.stages.map((g) => (
            <PlanRow key={g.stageId}>
              <PlanGrow>
                <div className="t-body">
                  {titles.get(g.fromStationId)} → {titles.get(g.toStationId)}
                </div>
                <div className="t-caption">
                  {t("actual.plannedKm", {
                    km: g.plannedKm === null ? "—" : Math.round(g.plannedKm),
                  })}
                  {" · "}
                  {g.actualKm === null
                    ? t("actual.actualKmUnknown")
                    : t("actual.actualKm", { km: Math.round(g.actualKm) })}
                </div>
              </PlanGrow>
            </PlanRow>
          ))}
        </Card>
      )}
      {data.unplanned.length > 0 && (
        <Card>
          <PlanCardHead title={t("actual.unplanned")} />
          {data.unplanned.map((u, i) => (
            <PlanRow key={`${u.kind}-${u.day}-${i}`}>
              <PlanGrow>
                <div className="t-body">{u.label}</div>
                <div className="t-caption">
                  {t("actual.stayKind." + u.kind)} · {day(u.day)}
                </div>
              </PlanGrow>
            </PlanRow>
          ))}
        </Card>
      )}
      <p className="t-caption">{t("actual.readOnly")}</p>
    </PlanStack>
  );
}
