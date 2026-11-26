import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { purposeApi } from "../../lib/api/purpose";
import { logger } from "../../lib/logger";
import { describePurpose } from "../../lib/purposeDisplay";
import { usePurposeCatalogue } from "../../store/purposeCatalogueStore";
import PurposeSelect, { PURPOSE_UNSET, type PurposeChoice } from "./PurposeSelect";
import ConfirmModal from "../ui/ConfirmModal";
import { useToastStore } from "../../store/toastStore";

type State =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "asking"; purpose: string; count: number }
  | { kind: "applying"; purpose: string; count: number }
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
  category,
  onApplied,
}: {
  tripId: string;
  /** The trip's category, named beside the action so the two do not read as one control. */
  category?: string | null;
  onApplied?: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["purpose", "trips"]);
  const addToast = useToastStore((s) => s.addToast);
  const catalogue = usePurposeCatalogue();
  const [state, setState] = useState<State>({ kind: "idle" });
  // Unset: the trip's category decides, as before; any purpose of the catalogue can be chosen.
  const [choice, setChoice] = useState<PurposeChoice>(PURPOSE_UNSET);

  const purposeLabel = (value: string): string =>
    describePurpose(t, catalogue, value, i18n.language ?? "de")?.label ??
    t(`purpose:field.${value}`, { defaultValue: value });

  const ask = async (): Promise<void> => {
    setState({ kind: "checking" });
    try {
      const preview = await purposeApi.previewTrip(tripId, choice || undefined);
      if (preview.purpose === null) return setState({ kind: "none" });
      if (preview.wouldChange === 0) return setState({ kind: "nothing" });
      setState({
        kind: "asking",
        purpose: preview.purposeKey ?? preview.purpose,
        count: preview.wouldChange,
      });
    } catch (error) {
      logger.warn("previewing the trip purpose failed", error);
      setState({ kind: "error" });
    }
  };

  const apply = async (purpose: string, count: number): Promise<void> => {
    setState({ kind: "applying", purpose, count });
    try {
      // The purpose the user confirmed, not whatever the category says by now.
      const result = await purposeApi.applyToTrip(tripId, purpose);
      setState({ kind: "done", changed: result.changed });
      // Also as a toast: the page reloads the trip after this, and the line below may be
      // re-mounted before anyone reads it (UAT rc.45 retest, D6).
      addToast("success", t("purpose:trip.done", { count: result.changed }));
      onApplied?.();
    } catch (error) {
      logger.warn("applying the trip purpose failed", error);
      setState({ kind: "error" });
    }
  };

  const dialog = state.kind === "asking" || state.kind === "applying" ? state : null;
  return (
    // A row of its own, with what it means: it sat under "Herkunft der Angaben" and beside the
    // category, and read as part of either (UAT rc.45 retest, D8).
    <div
      className="t-caption"
      data-testid="trip-purpose-row"
      style={{
        marginTop: "var(--ts-space-sm)",
        paddingTop: "var(--ts-space-sm)",
        borderTop: "1px solid var(--ts-border)",
      }}
    >
      <p className="font-semibold">{t("purpose:trip.rowTitle")}</p>
      <p>
        {category
          ? t("purpose:trip.rowCategory", {
              category: t(`trips:category.${category}`, { defaultValue: category }),
            })
          : t("purpose:trip.rowNoCategory")}
      </p>
      <div style={{ maxWidth: 320 }}>
        <PurposeSelect
          id={`trip-purpose-${tripId}`}
          value={choice}
          onChange={setChoice}
          unsetLabel={t("purpose:trip.fromCategory")}
        />
      </div>
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
                purpose: purposeLabel(dialog.purpose),
              })
            : ""
        }
        confirmText={t("purpose:trip.confirmAction")}
      />
    </div>
  );
}
