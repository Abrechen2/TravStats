import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import type { PlanView, PlanOperation } from "../../lib/api/travplan";
import { ActualRecordPicker } from "./ActualRecordPicker";
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
    { state, tripId } = plan;
  return (
    <>
      <div className="tp-card">
        <h2>{t("readyIntro")}</h2>
        <p>{t("noAutoCount")}</p>
        <div className="tp-actions">
          {state.status === "planning" ? (
            <button
              className="tp-primary"
              disabled={busy}
              onClick={() => void mutate({ type: "handover" })}
            >
              {t("handover")}
            </button>
          ) : (
            <p>{t("handoverDone")}</p>
          )}
          <Link className="tp-button" to={"/trips/" + tripId}>
            {t("stats")}
          </Link>
        </div>
      </div>
      <div className="tp-card">
        {state.items.map((i) => (
          <div key={i.id} className="tp-row">
            <div className="tp-grow">
              <h3>{i.title}</h3>
              <p>
                {i.day} · {t("options." + i.kind)}
              </p>
            </div>
            {((["activity", "free", "transfer", "flight", "hotel"].includes(i.kind) &&
              !i.source?.kind.startsWith("existing:") &&
              state.bookings.find((b) => b.id === i.bookingId)?.source !== "existing") ||
              i.execution === "confirmed") && (
              <button
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
              </button>
            )}
            <ActualRecordPicker
              tripId={tripId}
              item={i}
              busy={busy}
              onLink={(sourceId) => void mutate({ type: "link_actual", id: i.id, sourceId })}
            />
          </div>
        ))}
      </div>
    </>
  );
}
