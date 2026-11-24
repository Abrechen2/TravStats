import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { purposeApi } from "../../lib/api/purpose";
import type { Purpose } from "../../shared/purpose";
import { logger } from "../../lib/logger";
import ConfirmModal from "../ui/ConfirmModal";

type State =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "asking"; purpose: Purpose; count: number }
  | { kind: "applying"; purpose: Purpose; count: number }
  | { kind: "done"; changed: number }
  | { kind: "nothing" }
  | { kind: "none" }
  | { kind: "error" };

/**
 * "Zweck auf alle Einträge übertragen": an explicit action on the trip page. Changing a trip's
 * category never flips its entries on its own; this does, when asked. It asks FIRST, naming how
 * many entries it would change, and says afterwards how many it did (UAT rc.45) — a one-click
 * overwrite of every entry's purpose was too quiet for what it does.
 */
export default function TripPurposeAction({
  tripId,
  onApplied,
}: {
  tripId: string;
  onApplied?: () => void;
}): JSX.Element {
  const { t } = useTranslation(["purpose"]);
  const [state, setState] = useState<State>({ kind: "idle" });

  const ask = async (): Promise<void> => {
    setState({ kind: "checking" });
    try {
      const preview = await purposeApi.previewTrip(tripId);
      if (preview.purpose === null) return setState({ kind: "none" });
      if (preview.wouldChange === 0) return setState({ kind: "nothing" });
      setState({ kind: "asking", purpose: preview.purpose, count: preview.wouldChange });
    } catch (error) {
      logger.warn("previewing the trip purpose failed", error);
      setState({ kind: "error" });
    }
  };

  const apply = async (purpose: Purpose, count: number): Promise<void> => {
    setState({ kind: "applying", purpose, count });
    try {
      // The purpose the user confirmed, not whatever the category says by now.
      const result = await purposeApi.applyToTrip(tripId, purpose);
      setState({ kind: "done", changed: result.changed });
      onApplied?.();
    } catch (error) {
      logger.warn("applying the trip purpose failed", error);
      setState({ kind: "error" });
    }
  };

  const dialog = state.kind === "asking" || state.kind === "applying" ? state : null;
  return (
    <div className="t-caption">
      <button
        type="button"
        onClick={() => void ask()}
        disabled={state.kind === "checking"}
        title={t("purpose:trip.applyHelp")}
        className="underline pointer-coarse:min-h-(--ts-size-touch-min)"
      >
        {t("purpose:trip.apply")}
      </button>
      <p role={state.kind === "error" ? "alert" : "status"}>
        {state.kind === "done" && t("purpose:trip.done", { count: state.changed })}
        {state.kind === "nothing" && t("purpose:trip.nothing")}
        {state.kind === "none" && t("purpose:trip.none")}
        {state.kind === "error" && t("purpose:trip.error")}
      </p>
      <ConfirmModal
        isOpen={dialog !== null}
        isLoading={state.kind === "applying"}
        onClose={() => setState({ kind: "idle" })}
        onConfirm={() => dialog && void apply(dialog.purpose, dialog.count)}
        title={t("purpose:trip.apply")}
        message={
          dialog
            ? t("purpose:trip.confirm", {
                count: dialog.count,
                purpose: t(`purpose:field.${dialog.purpose}`),
              })
            : ""
        }
        confirmText={t("purpose:trip.confirmAction")}
      />
    </div>
  );
}
