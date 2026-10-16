import { useTranslation } from "../../hooks/useTranslation";
import { Button } from "../../components/ui";
import type { PlanState, PlanOperation } from "../../lib/api/travplan";
/** Excluding a booking changes the itinerary, not its source or committed price. */
export function BookingPlanToggle({
  state,
  bookingId,
  busy,
  mutate,
}: {
  state: PlanState;
  bookingId: string;
  busy: boolean;
  mutate: (op: PlanOperation) => Promise<boolean>;
}) {
  const { t } = useTranslation("travplan"),
    item = state.items.find((i) => i.bookingId === bookingId);
  if (!item || item.execution === "confirmed") return null;
  const excluded = item.execution === "cancelled" || item.execution === "skipped";
  return (
    <Button
      disabled={busy}
      onClick={() =>
        void mutate({
          type: "execution",
          id: item.id,
          execution: excluded ? "unconfirmed" : "cancelled",
        })
      }
    >
      {t(excluded ? "restoreBooking" : "excludeBooking")}
    </Button>
  );
}
