import { useTranslation } from "../../../hooks/useTranslation";
import { Button, Card } from "../../../components/ui";
import type { PlanBooking } from "../../../lib/api/travplan";
import { PlanActions, PlanCardHead, PlanGrid, PlanGrow, PlanRow, PlanStack } from "../planLayout";
import ImportPanel from "../ImportPanel";
import { BookingPlanToggle } from "../BookingPlanToggle";
import type { PlanCtx } from "../planContext";

export function ImportSection({ ctx }: { ctx: PlanCtx }) {
  const { t } = useTranslation("travplan"),
    { plan, state, busy, mutate, edit, onError, tripId, documents } = ctx;
  return (
    <>
      <p className="t-body">{t("bookingsIntro")}</p>
      <PlanActions>
        <Button disabled={busy} onClick={() => void mutate({ type: "refresh_existing" })}>
          {t("refreshExisting")}
        </Button>
        <Button
          variant="primary"
          onClick={() => edit("bookings", undefined, { review: true, title: t("manualBooking") })}
        >
          {t("manualBooking")}
        </Button>
      </PlanActions>
      <PlanGrid>
        <ImportPanel
          key={tripId}
          plan={plan}
          onError={onError}
          onDraft={(b: PlanBooking) => edit("bookings", b, { review: true })}
        />
        <PlanStack>
          <Card>
            {state.bookings.map((b) => (
              <PlanRow key={b.id}>
                <PlanGrow>
                  <h3 className="t-card-title">{b.title}</h3>
                  <p className="t-body">
                    {b.day} – {b.endDay} · {b.time}
                  </p>
                  <p className="t-caption">
                    {b.amount === null ? t("review.unknown") : b.amount + " " + b.currency} ·{" "}
                    {t("review.source")}: {b.source}
                  </p>
                  <PlanActions>
                    <Button
                      disabled={state.items.some((i) => i.bookingId === b.id && i.source !== null)}
                      onClick={() => edit("bookings", b, { review: true })}
                    >
                      {t("edit")}
                    </Button>
                    <BookingPlanToggle state={state} bookingId={b.id} busy={busy} mutate={mutate} />
                  </PlanActions>
                </PlanGrow>
              </PlanRow>
            ))}
          </Card>
          <Card>
            <PlanCardHead title={t("documents")} />
            {documents.map((d) => (
              <PlanRow key={d.id}>
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--ts-info)" }}
                >
                  {d.displayName}
                </a>
              </PlanRow>
            ))}
          </Card>
        </PlanStack>
      </PlanGrid>
    </>
  );
}
