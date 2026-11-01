import { Button, Card, Pill } from "../../../components/ui";
import { useTranslation } from "../../../hooks/useTranslation";
import { todayIn } from "../../../shared/time";
import type { PlanOperation, PlanView } from "../../../lib/api/travplan";
import { PlanCardHead, PlanGrow, PlanNotice, PlanRow } from "../planLayout";
import { shortDay } from "./RouteTimeline";
import { canHandOver, linkOf, stationDays, wroteRecords } from "./routeModel";

/**
 * Handover of a route plan to the logbook (spec §5.9), station by station: once a station is
 * reached the plan can write it - the roadtrip stop, the booked night as a stay, the ferry that
 * brought you. Open placeholders never become records. Withdrawing removes only what the plan
 * wrote and nobody has touched since.
 */
export function RouteHandoverCard({
  plan,
  busy,
  mutate,
}: {
  plan: PlanView;
  busy: boolean;
  mutate: (op: PlanOperation) => Promise<boolean>;
}) {
  const { t } = useTranslation("travplan"),
    { state, schedule } = plan,
    today = todayIn(state.timezone ?? "UTC"),
    placeholders = state.bookings.filter((b) => b.placeholder);
  return (
    <Card>
      <PlanCardHead title={t("route.handover.title")} />
      <p className="t-body">{t("route.handover.intro")}</p>
      {state.stations.length === 0 && <p className="t-caption">{t("route.handover.noStations")}</p>}
      {state.stations.map((s) => {
        const link = linkOf(state, s.id),
          ready = canHandOver(state, s.id, schedule, today),
          wrote = wroteRecords(state, s.id),
          arrive = stationDays(schedule, s.id).arrive;
        return (
          <PlanRow key={s.id}>
            <PlanGrow>
              <h3 className="t-card-title">{s.title}</h3>
              <p className="t-caption">{shortDay(arrive) ?? t("route.station.dayUnknown")}</p>
              {link && link.created.length > 0 && (
                <p className="t-caption">
                  {t("route.handover.records", { count: link.created.length })}
                </p>
              )}
            </PlanGrow>
            {link ? (
              <Pill color="var(--ts-good)">{t("route.handover.inLogbook")}</Pill>
            ) : (
              <Pill color={ready ? "var(--ts-info)" : "var(--ts-muted)"} dashed={!ready}>
                {t(ready ? "route.handover.ready" : "route.handover.notReached")}
              </Pill>
            )}
            {wrote ? (
              <Button
                disabled={busy}
                onClick={() => void mutate({ type: "station_withdraw", stationId: s.id })}
              >
                {t("route.handover.withdraw")}
              </Button>
            ) : (
              <Button
                disabled={busy || !ready}
                onClick={() => void mutate({ type: "station_handover", stationId: s.id })}
              >
                {t("route.handover.confirm")}
              </Button>
            )}
          </PlanRow>
        );
      })}
      {placeholders.length > 0 && (
        <PlanNotice>{t("route.handover.placeholders", { count: placeholders.length })}</PlanNotice>
      )}
    </Card>
  );
}
