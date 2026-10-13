import type { ParsedBooking } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";

/** Warnings belong inside the review dialog, beside the candidate they qualify. */
export default function ReviewParserNotices({ data }: { data: ParsedBooking }): JSX.Element | null {
  const { t } = useTranslation(["flights"]);
  const cancellation = data.airlineNotice === "flight_cancellation";
  const assumedTime = ["departureTime", "arrivalTime"].some((field) =>
    data.inferredFields?.includes(field)
  );
  if (!cancellation && !assumedTime) return null;
  return (
    <div role="alert" className="mb-3 rounded-md border border-(--warning) p-3 text-sm">
      {cancellation && <p>{t("flights:review.cancellationNotice")}</p>}
      {assumedTime && <p>{t("flights:review.unconfirmedTimeNotice")}</p>}
    </div>
  );
}
