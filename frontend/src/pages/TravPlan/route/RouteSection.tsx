import { lazy, Suspense, useState } from "react";
import { Button, Card, EmptyState, Pill, StatTile } from "../../../components/ui";
import { useTranslation } from "../../../hooks/useTranslation";
import { probeWebGL2 } from "../../../lib/webgl2";
import { todayIn } from "../../../shared/time";
import { newPlanId } from "../../../lib/travplanId";
import {
  travplanApi,
  type PlanBooking,
  type PlanPlace,
  type PlanStage,
  type PlanStation,
} from "../../../lib/api/travplan";
import { entryRecord, type PlanCtx } from "../planContext";
import { PlanCardHead, PlanStack } from "../planLayout";
import { FindingCards } from "../sections/FindingCards";
import { PlacePicker } from "./PlacePicker";
import { StageEditor } from "./StageEditor";
import { StationEditor } from "./StationEditor";
import { StageRow, StationCard, TONE } from "./RouteTimeline";
import { VariantsPanel } from "./VariantsPanel";
import {
  canHandOver,
  formatMinutes,
  newStage,
  newStation,
  routeTotals,
  stageBetween,
  stationDays,
  type RouteTone,
} from "./routeModel";

const RouteMap = lazy(() => import("./RouteMap"));
export const ROUTE_FINDINGS = [
  "stageUndecided",
  "placeholderDue",
  "nightUndecided",
  "scheduleConflict",
  "longDrive",
  "ferryConnection",
  "dayTripOutside",
  "stageMissing",
  "durationMissing",
] as const;
const LEGEND: RouteTone[] = ["booked", "placeholder", "spontaneous", "own"];

/** The route plan's canvas (board 7): totals, legend, the timeline of stations and stages, the map. */
export function RouteSection({ ctx }: { ctx: PlanCtx }) {
  const { t } = useTranslation("travplan"),
    { plan, state, busy, mutate, setPlan, onError } = ctx,
    [editStation, setEditStation] = useState<string | null>(null),
    [editStage, setEditStage] = useState<string | null>(null),
    [routing, setRouting] = useState<string | null>(null);
  const totals = routeTotals(state),
    today = todayIn(state.timezone ?? "UTC"),
    handed = new Set(state.stationLinks.map((l) => l.stationId));
  const station = state.stations.find((s) => s.id === editStation),
    stage = state.stages.find((g) => g.id === editStage);

  async function add(place: PlanPlace) {
    const last = state.stations[state.stations.length - 1],
      next = newStation(place);
    if (!(await mutate({ type: "upsert", collection: "stations", value: entryRecord(next) })))
      return;
    if (last)
      await mutate({
        type: "upsert",
        collection: "stages",
        value: entryRecord(newStage(last.id, next.id)),
      });
  }
  async function recalc(stageId: string) {
    setRouting(stageId);
    try {
      // A router that cannot answer returns the plan with its reason recorded and the stored
      // figures untouched; only a failed request lands in the catch.
      setPlan(await travplanApi.routeStage(plan, stageId));
    } catch (cause) {
      onError(cause);
    } finally {
      setRouting(null);
    }
  }
  async function placeholderFor(g: PlanStage, from: PlanStation, to: PlanStation) {
    const kind = g.mode === "ferry" || g.mode === "rail" ? g.mode : "flight";
    const day = stationDays(plan.schedule, from.id).depart;
    const booking: PlanBooking = {
      id: newPlanId(),
      kind,
      title: `${from.title} → ${to.title}`,
      reference: null,
      provider: "",
      day,
      endDay: null,
      time: g.departTime,
      timezone: from.place.zone,
      originPlace: from.title,
      amount: null,
      paid: 0,
      currency: state.currency,
      place: to.title,
      documentIds: [],
      source: "manual",
      details: {},
      placeholder: true,
      estimate: null,
      stageId: g.id,
    };
    if (await mutate({ type: "upsert", collection: "bookings", value: entryRecord(booking) }))
      await mutate({
        type: "upsert",
        collection: "stages",
        value: entryRecord({ ...g, bookingId: booking.id }),
      });
  }

  const stat = (value: string | number, label: string, suffix?: string) => (
    <StatTile value={value} label={label} suffix={suffix} />
  );
  return (
    <PlanStack>
      <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: "var(--ts-space-lg)" }}>
        {stat(totals.stations, t("route.stats.stations"))}
        {stat(totals.nights, t("route.stats.nights"))}
        {stat(
          totals.km === null ? "–" : totals.km,
          t("route.stats.km"),
          totals.km === null ? undefined : "km"
        )}
        {stat(formatMinutes(totals.minutes) ?? "–", t("route.stats.time"))}
      </div>
      {totals.unmeasured > 0 && (
        <p className="t-caption">{t("route.stats.unmeasured", { count: totals.unmeasured })}</p>
      )}
      <div
        className="flex flex-wrap items-center"
        style={{ gap: "var(--ts-space-sm)" }}
        aria-label={t("route.legend")}
      >
        {LEGEND.map((tone) => (
          <Pill key={tone} color={TONE[tone].color} dashed={TONE[tone].dashed}>
            {t("route.tone." + tone)}
          </Pill>
        ))}
      </div>
      <FindingCards ctx={ctx} all only={ROUTE_FINDINGS} />
      <div
        className="grid grid-cols-1 lg:grid-cols-[3fr_2fr]"
        style={{ gap: "var(--ts-space-xl)" }}
      >
        <PlanStack>
          {state.stations.length === 0 && (
            <EmptyState
              title={t("route.empty.title")}
              description={t("route.empty.body")}
              action={<PlacePicker label={t("route.add.start")} onPick={(p) => void add(p)} />}
            />
          )}
          {state.stations.map((s, i) => {
            const next = state.stations[i + 1],
              between = next && stageBetween(state, s, next);
            return (
              <PlanStack key={s.id}>
                <StationCard
                  state={state}
                  station={s}
                  index={i}
                  total={state.stations.length}
                  schedule={plan.schedule}
                  canHandOver={canHandOver(state, s.id, plan.schedule, today)}
                  busy={busy}
                  onEdit={() => setEditStation(s.id)}
                  onMove={(toIndex) => void mutate({ type: "move_station", id: s.id, toIndex })}
                  onRemove={() => void mutate({ type: "remove", collection: "stations", id: s.id })}
                  onHandover={() => void mutate({ type: "station_handover", stationId: s.id })}
                  onWithdraw={() => void mutate({ type: "station_withdraw", stationId: s.id })}
                />
                {next &&
                  (between ? (
                    <StageRow
                      state={state}
                      stage={between}
                      from={s}
                      to={next}
                      busy={busy}
                      routing={routing === between.id}
                      onEdit={() => setEditStage(between.id)}
                      onRoute={() => void recalc(between.id)}
                      onPlaceholder={() => void placeholderFor(between, s, next)}
                    />
                  ) : (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void mutate({
                          type: "upsert",
                          collection: "stages",
                          value: entryRecord(newStage(s.id, next.id)),
                        })
                      }
                    >
                      {t("route.stage.add", { from: s.title, to: next.title })}
                    </Button>
                  ))}
              </PlanStack>
            );
          })}
          {state.stations.length > 0 && (
            <Card>
              <PlanCardHead title={t("route.add.next")} />
              <PlacePicker label={t("route.add.search")} onPick={(p) => void add(p)} />
            </Card>
          )}
        </PlanStack>
        <div style={{ position: "sticky", top: "var(--ts-space-xl)", alignSelf: "start" }}>
          {probeWebGL2() ? (
            <Suspense fallback={<EmptyState kind="pending" title={t("loading")} />}>
              <RouteMap stations={state.stations} handedOver={handed} />
            </Suspense>
          ) : (
            <p className="t-caption">{t("route.map.unavailable")}</p>
          )}
          {state.stations.length > 0 && <p className="t-caption">{t("route.map.note")}</p>}
        </div>
      </div>
      <VariantsPanel plan={plan} busy={busy} mutate={mutate} />
      {station && (
        <StationEditor
          key={station.id}
          station={station}
          bookings={state.bookings}
          allowOnboard={state.stages.some(
            (g) => g.toStationId === station.id && g.overnight && g.mode === "ferry"
          )}
          busy={busy}
          onClose={() => setEditStation(null)}
          onSave={(value) =>
            mutate({ type: "upsert", collection: "stations", value: entryRecord(value) })
          }
        />
      )}
      {stage && (
        <StageEditor
          key={stage.id}
          stage={stage}
          title={t("route.stage.edit")}
          busy={busy}
          onClose={() => setEditStage(null)}
          onSave={(value) =>
            mutate({ type: "upsert", collection: "stages", value: entryRecord(value) })
          }
        />
      )}
    </PlanStack>
  );
}
