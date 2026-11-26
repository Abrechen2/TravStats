import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { companionsApi, type ManagedCompanion } from "../../../lib/api/companions";
import { logger } from "../../../lib/logger";
import { useToastStore } from "../../../store/toastStore";
import { ConfirmDialog } from "../../ui/settings";
import { useDialogCopy } from "../rowCopy";
import { companionErrorKey } from "./companionErrorCopy";
import { reportPageError } from "../../../store/pageErrorStore";

const NS = "companions:manage";

/**
 * The two deletes, each confirmed. Only an unused companion is ever offered
 * (the server refuses the rest with COMPANION_IN_USE, which then reads as its
 * own sentence, pointing at the merge).
 */
function useConfirm(onDone: () => void) {
  const addToast = useToastStore((s) => s.addToast);
  const { t } = useTranslation(["companions"]);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<string>, fallbackKey: string): Promise<void> => {
    setBusy(true);
    try {
      addToast("success", await action());
      onDone();
    } catch (err) {
      logger.error("Companion delete failed:", err);
      reportPageError(t(companionErrorKey(err, fallbackKey)));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run, t };
}

export function CompanionDeleteDialog({
  companion,
  onClose,
  onDone,
}: {
  companion: ManagedCompanion;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { busy, run, t } = useConfirm(onDone);
  const dialog = useDialogCopy();
  const name = companion.name;
  const documents = companion.documents ?? 0;
  const copy = dialog("companiondel", { name });
  return (
    <ConfirmDialog
      open
      {...copy}
      // Their documents stay; they become the owner's (plan D7), and the dialog says so first.
      after={
        documents > 0
          ? `${t(`${NS}.delete.documentsAfter`, { count: documents })} ${copy.after}`
          : copy.after
      }
      busy={busy}
      onCancel={onClose}
      onConfirm={() =>
        void run(async () => {
          await companionsApi.remove(companion.id);
          return t(`${NS}.delete.done`, { name });
        }, `${NS}.errors.deleteFailed`)
      }
    />
  );
}

export function DeleteUnusedDialog({
  count,
  onClose,
  onDone,
}: {
  count: number;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { busy, run, t } = useConfirm(onDone);
  const dialog = useDialogCopy();
  return (
    <ConfirmDialog
      open
      {...dialog("unused", { count })}
      busy={busy}
      onCancel={onClose}
      onConfirm={() =>
        void run(async () => {
          const deleted = await companionsApi.deleteUnused();
          return t(`${NS}.deleteUnused.done`, { count: deleted });
        }, `${NS}.errors.deleteFailed`)
      }
    />
  );
}
