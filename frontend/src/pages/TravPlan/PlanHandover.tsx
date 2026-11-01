import { useTranslation } from "../../hooks/useTranslation";
import { Button, Card } from "../../components/ui";
import type { PlanView, PlanOperation, PlanItem, PlanState } from "../../lib/api/travplan";
import { ActualRecordPicker } from "./ActualRecordPicker";
import { todayIn } from "../../shared/time";
import { RouteHandoverCard } from "./route/RouteHandoverCard";
import { shortDay } from "./route/RouteTimeline";
import { PlanActions, PlanCardHead, PlanGrow, PlanLink, PlanRow, PlanStack } from "./planLayout";

const CONFIRMABLE_KINDS = ["activity", "free", "transfer", "flight", "hotel"];

/** Only what the plan itself made can be confirmed here; a record taken over from the log already counts. */
function confirmable(state: PlanState, i: PlanItem, today: string): boolean {
  // The server refuses to confirm a day that has not happened; the button is not offered either.
  if (i.execution !== "confirmed" && i.day && i.day > today) return false;
  return (
    (CONFIRMABLE_KINDS.includes(i.kind) &&
      !i.source?.kind.startsWith("existing:") &&
      state.bookings.find((b) => b.id === i.bookingId)?.source !== "existing") ||
    i.execution === "confirmed"
  );
}

export function PlanHandover({
  plan,
  busy,
  mutate,
}: {
  plan: PlanView;
  busy: boolean;
  mutate: (op: PlanOperation) => Promise<boolean>;
}) {
  const { t } = useTranslation("travplan"),
    { state, tripId } = plan,
    today = todayIn(state.timezone ?? "UTC");
  return (
    <PlanStack>
      {state.shape === "route" && <RouteHandoverCard plan={plan} busy={busy} mutate={mutate} />}
      <Card>
        <PlanCardHead title={t("readyIntro")} />
        <p className="t-body">{t("noAutoCount")}</p>
        <PlanActions>
          {state.status === "planning" ? (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void mutate({ type: "handover" })}
            >
              {t("handover")}
            </Button>
          ) : (
            <p className="t-body">{t("handoverDone")}</p>
          )}
          <PlanLink to={"/trips/" + tripId}>{t("stats")}</PlanLink>
        </PlanActions>
      </Card>
      <Card>
        {state.items.map((i) => (
          <PlanRow key={i.id}>
            <PlanGrow>
              <h3 className="t-card-title">{i.title}</h3>
              <p className="t-body">
                {shortDay(i.day)} · {t("options." + i.kind)}
              </p>
            </PlanGrow>
            {confirmable(state, i, today) && (
              <Button
                disabled={busy}
                onClick={() =>
                  void mutate({
                    type: "execution",
                    id: i.id,
                    execution: i.execution === "confirmed" ? "unconfirmed" : "confirmed",
                  })
                }
              >
                {t(i.execution === "confirmed" ? "unconfirmVisit" : "confirmVisit")}
              </Button>
            )}
            <ActualRecordPicker
              tripId={tripId}
              item={i}
              busy={busy}
              onLink={(sourceId) => void mutate({ type: "link_actual", id: i.id, sourceId })}
            />
          </PlanRow>
        ))}
      </Card>
    </PlanStack>
  );
}
