import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { purposeApi } from "../../lib/api/purpose";
import { logger } from "../../lib/logger";

/**
 * "Zweck auf alle Einträge übertragen": an explicit action on the trip page. Changing a trip's
 * category never flips its entries on its own; this does, when asked, and says how many.
 */
export default function TripPurposeAction({
  tripId,
  onApplied,
}: {
  tripId: string;
  onApplied?: () => void;
}): JSX.Element {
  const { t } = useTranslation(["purpose"]);
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "done"; changed: number } | { kind: "none" } | { kind: "error" }
  >({ kind: "idle" });

  const apply = async (): Promise<void> => {
    try {
      const result = await purposeApi.applyToTrip(tripId);
      setState(
        result.purpose === null ? { kind: "none" } : { kind: "done", changed: result.changed }
      );
      if (result.purpose !== null) onApplied?.();
    } catch (error) {
      logger.warn("applying the trip purpose failed", error);
      setState({ kind: "error" });
    }
  };

  return (
    <div className="t-caption">
      <button
        type="button"
        onClick={() => void apply()}
        title={t("purpose:trip.applyHelp")}
        className="underline pointer-coarse:min-h-(--ts-size-touch-min)"
      >
        {t("purpose:trip.apply")}
      </button>
      <p role={state.kind === "error" ? "alert" : "status"}>
        {state.kind === "done" && t("purpose:trip.done", { count: state.changed })}
        {state.kind === "none" && t("purpose:trip.none")}
        {state.kind === "error" && t("purpose:trip.error")}
      </p>
    </div>
  );
}
