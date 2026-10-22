import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { companionsApi, type ManagedCompanion } from "../../../lib/api/companions";
import { logger } from "../../../lib/logger";
import { useToastStore } from "../../../store/toastStore";
import Button from "../../ui/Button";
import Dialog from "../../ui/Dialog";
import { Field, Input } from "../../ui/Field";
import { companionErrorKey, takenBy } from "./companionErrorCopy";

const NS = "companions:manage.rename";

/**
 * Renames one companion — and with it every entry that names them. A name
 * another companion already has is not an error to dismiss: it is the same
 * person twice, so the refusal offers the merge in place.
 */
export default function CompanionRenameDialog({
  companion,
  onClose,
  onDone,
  onMergeInstead,
}: {
  companion: ManagedCompanion;
  onClose: () => void;
  onDone: () => void;
  onMergeInstead: (targetId: string) => void;
}): JSX.Element {
  const { t } = useTranslation(["companions", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [name, setName] = useState(companion.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState<{ id: string; name: string } | null>(null);
  const clean = name.trim();

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    setTaken(null);
    try {
      const renamed = await companionsApi.rename(companion.id, clean);
      addToast("success", t(`${NS}.done`, { name: renamed.name }));
      onDone();
    } catch (err) {
      logger.error("Companion rename failed:", err);
      const other = takenBy(err);
      if (other) setTaken(other);
      else setError(t(companionErrorKey(err, "companions:manage.errors.renameFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      dirty={clean !== companion.name}
      title={t(`${NS}.title`, { name: companion.name })}
      dismissLabel={t("common:buttons.cancel")}
      action={
        <Button variant="primary" disabled={busy || !clean} onClick={() => void submit()}>
          {t(`${NS}.submit`)}
        </Button>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <Field
          label={t(`${NS}.label`)}
          htmlFor="companion-rename"
          error={error ?? undefined}
          hint={t(`${NS}.hint`, { name: companion.name })}
        >
          <Input
            id="companion-rename"
            value={name}
            maxLength={100}
            autoComplete="off"
            invalid={taken !== null || error !== null}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {taken && (
          <div role="alert" className="flex flex-col gap-2">
            <p className="text-sm">{t(`${NS}.taken`, { name: taken.name })}</p>
            <div>
              <Button onClick={() => onMergeInstead(taken.id)}>
                {t(`${NS}.mergeInstead`, { name: taken.name })}
              </Button>
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}
