import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { companionsApi, type ManagedCompanion } from "../../../lib/api/companions";
import { logger } from "../../../lib/logger";
import { useToastStore } from "../../../store/toastStore";
import Button from "../../ui/Button";
import Dialog from "../../ui/Dialog";
import { companionErrorKey } from "./companionErrorCopy";

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
      addToast("error", t(companionErrorKey(err, fallbackKey)));
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
  const name = companion.name;
  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={t(`${NS}.delete.title`, { name })}
      dismissLabel={t("common:buttons.cancel")}
      action={
        <Button
          variant="danger"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await companionsApi.remove(companion.id);
              return t(`${NS}.delete.done`, { name });
            }, `${NS}.errors.deleteFailed`)
          }
        >
          {t(`${NS}.delete.submit`)}
        </Button>
      }
    >
      <p className="text-sm">{t(`${NS}.delete.body`, { name })}</p>
    </Dialog>
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
  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={t(`${NS}.deleteUnused.title`)}
      dismissLabel={t("common:buttons.cancel")}
      action={
        <Button
          variant="danger"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const deleted = await companionsApi.deleteUnused();
              return t(`${NS}.deleteUnused.done`, { count: deleted });
            }, `${NS}.errors.deleteFailed`)
          }
        >
          {t(`${NS}.deleteUnused.submit`)}
        </Button>
      }
    >
      <p className="text-sm">{t(`${NS}.deleteUnused.body`, { count })}</p>
    </Dialog>
  );
}
