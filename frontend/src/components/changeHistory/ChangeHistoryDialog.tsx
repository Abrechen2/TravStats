import { useEffect, useState } from "react";
import type { JSX } from "react";

import Dialog from "../ui/Dialog";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { changeHistoryApi, type ChangeEntityType } from "../../lib/api/changeHistory";
import ChangeHistoryList from "./ChangeHistoryList";

interface ChangeHistoryDialogProps {
  entityType: ChangeEntityType;
  entityId: string;
  /** Called after a restore wrote a value, so the page can show the entry as it now is. */
  onRestored?: () => Promise<void> | void;
  onClose: () => void;
}

/**
 * "Änderungsverlauf" of one entry, opened from its ⋯ menu (owner, 2026-11-23: the
 * old "Verlauf" button took too much room). It names the rolling window the
 * history is kept for — "Verlauf der letzten 12 Monate" — because older rows are
 * gone and the list would otherwise read as if the entry had no past.
 */
export default function ChangeHistoryDialog({
  entityType,
  entityId,
  onRestored,
  onClose,
}: ChangeHistoryDialogProps): JSX.Element {
  const { t } = useTranslation(["changeHistory", "common"]);
  const [months, setMonths] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    changeHistoryApi
      .retention()
      .then((r) => live && setMonths(r.months))
      .catch((err: unknown) => {
        // The list still works; only the sentence naming the window is missing.
        logger.warn("change history retention load failed", { err });
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("changeHistory:menu")}
      dismissLabel={t("common:buttons.close")}
      maxWidth={880}
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        {months !== null && (
          <p className="t-caption" data-testid="change-history-window">
            {t("changeHistory:window", { count: months })}
          </p>
        )}
        <ChangeHistoryList entityType={entityType} entityId={entityId} onRestored={onRestored} />
      </div>
    </Dialog>
  );
}
