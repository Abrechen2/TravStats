import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import {
  companionsApi,
  type CompanionMergePreview,
  type CompanionUseKind,
  type ManagedCompanion,
} from "../../../lib/api/companions";
import { logger } from "../../../lib/logger";
import { useToastStore } from "../../../store/toastStore";
import Button from "../../ui/Button";
import Dialog from "../../ui/Dialog";
import { Field, Select } from "../../ui/Field";
import { companionErrorKey } from "./companionErrorCopy";

const NS = "companions:manage.merge";

/**
 * Merges one companion into another. Nothing moves before the reader has seen
 * what will: the server's preview names the entries per kind (and how many
 * the target is on already), the expenses, the lists whose name changes and
 * what happens to an account link. A merge the server would refuse — both
 * linked to different accounts — is explained, and its button stays off.
 */
export default function CompanionMergeDialog({
  companion,
  others,
  initialTarget,
  onClose,
  onDone,
}: {
  companion: ManagedCompanion;
  others: ManagedCompanion[];
  initialTarget?: string;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { t } = useTranslation(["companions", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [target, setTarget] = useState(initialTarget ?? "");
  const [preview, setPreview] = useState<CompanionMergePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return undefined;
    let cancelled = false;
    setPreview(null);
    setPreviewError(null);
    companionsApi
      .mergePreview(companion.id, target)
      .then((next) => {
        if (!cancelled) setPreview(next);
      })
      .catch((err: unknown) => {
        logger.error("Companion merge preview failed:", err);
        if (!cancelled) {
          setPreviewError(t(companionErrorKey(err, "companions:manage.errors.previewFailed")));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [companion.id, target, t]);

  const apply = async (): Promise<void> => {
    if (!preview?.allowed || busy) return;
    setBusy(true);
    try {
      await companionsApi.merge(companion.id, target);
      addToast(
        "success",
        t(`${NS}.done`, { source: preview.source.name, target: preview.target.name })
      );
      onDone();
    } catch (err) {
      logger.error("Companion merge failed:", err);
      addToast("error", t(companionErrorKey(err, "companions:manage.errors.mergeFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={t(`${NS}.title`, { name: companion.name })}
      dismissLabel={t("common:buttons.cancel")}
      action={
        <Button variant="primary" disabled={busy || !preview?.allowed} onClick={() => void apply()}>
          {t(`${NS}.submit`)}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t(`${NS}.targetLabel`)} htmlFor="companion-merge-target">
          <Select
            id="companion-merge-target"
            value={target}
            disabled={busy}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">{t(`${NS}.targetPlaceholder`)}</option>
            {others.map((other) => (
              <option key={other.id} value={other.id}>
                {other.name}
              </option>
            ))}
          </Select>
        </Field>
        {target && !preview && !previewError && <p className="t-caption">{t(`${NS}.loading`)}</p>}
        {previewError && (
          <p role="alert" className="text-sm" style={{ color: "var(--ts-warn)" }}>
            {previewError}
          </p>
        )}
        {preview && <PreviewText preview={preview} />}
      </div>
    </Dialog>
  );
}

function PreviewText({ preview }: { preview: CompanionMergePreview }): JSX.Element {
  const { t } = useTranslation(["companions"]);
  const names = { source: preview.source.name, target: preview.target.name };
  const kinds = (Object.keys(preview.entries) as CompanionUseKind[]).filter(
    (kind) => (preview.entries[kind]?.entries ?? 0) > 0
  );
  const lines = [
    ...kinds.map((kind) => {
      const { entries, shared } = preview.entries[kind]!;
      const label = t(`companions:manage.kinds.${kind}`, { count: entries });
      return shared > 0 ? `${label} ${t(`${NS}.shared`, { count: shared, ...names })}` : label;
    }),
    ...(preview.hiddenEntries > 0
      ? [t(`${NS}.hiddenEntries`, { count: preview.hiddenEntries })]
      : []),
    ...(preview.expensesPaid > 0 ? [t(`${NS}.expenses`, { count: preview.expensesPaid })] : []),
  ];
  const link =
    preview.link === "moveToTarget"
      ? t(`${NS}.link.moveToTarget`, { ...names, username: preview.source.linkedUser?.username })
      : preview.link === "keepTarget"
        ? t(`${NS}.link.keepTarget`, { ...names, username: preview.target.linkedUser?.username })
        : null;

  if (preview.link === "conflict") {
    return (
      <p role="alert" className="text-sm" style={{ color: "var(--ts-warn)" }}>
        {t(`${NS}.link.conflict`, names)}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="companion-merge-preview">
      {lines.length === 0 ? (
        <p>{t(`${NS}.nothing`, names)}</p>
      ) : (
        <>
          <p>{t(`${NS}.intro`, names)}</p>
          <ul className="list-disc pl-5">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      {preview.renamedLists > 0 && (
        <p className="t-caption">{t(`${NS}.lists`, { count: preview.renamedLists, ...names })}</p>
      )}
      {link && <p className="t-caption">{link}</p>}
    </div>
  );
}
