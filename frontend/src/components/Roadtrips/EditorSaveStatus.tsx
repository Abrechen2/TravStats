import type { JSX } from "react";

import { Icon } from "../ui/Icon";
import { useTranslation } from "../../hooks/useTranslation";
import type { LocalDraftState, SaveStatus } from "./useStationAutosave";

const STATUS_COLOR: Record<SaveStatus, string> = {
  saved: "var(--ts-good)",
  pending: "var(--ts-muted)",
  saving: "var(--ts-muted)",
  error: "var(--ts-bad)",
  waiting: "var(--ts-warn)",
  conflict: "var(--ts-bad)",
};

/**
 * Where the station edits are (forgejo#244): on the server, or only on this
 * device, or nowhere but this page. "Alles gespeichert" used to cover the
 * first and say nothing about the other two, so a reader whose save failed
 * had no way to know whether closing the tab would cost them their changes.
 *
 * The first half says what the SERVER holds; the second, only while the server
 * does not hold everything, whether this browser kept a copy. The actions are
 * the ones that can end the state: retry, merge after a conflict, discard.
 */
export default function EditorSaveStatus({
  status,
  local,
  onRetry,
  onMerge,
  onDiscard,
}: {
  status: SaveStatus;
  local: LocalDraftState;
  onRetry: () => void;
  onMerge: () => void;
  onDiscard: () => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  const link =
    "underline pointer-coarse:inline-flex pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:items-center";
  return (
    <span
      role="status"
      className="flex flex-wrap items-center"
      style={{ gap: 6, fontSize: 13, color: STATUS_COLOR[status] }}
    >
      {status === "saved" && <Icon name="check" size={14} />}
      <span>{t(`roadtrips:editor.status.${status}`)}</span>
      {status !== "saved" && local !== "none" && (
        <span style={{ color: local === "failed" ? "var(--ts-bad)" : "var(--ts-muted)" }}>
          · {t(`roadtrips:editor.local.${local}`)}
        </span>
      )}
      {status === "error" && (
        <button type="button" className={link} onClick={onRetry}>
          {t("roadtrips:editor.status.retry")}
        </button>
      )}
      {status === "conflict" && (
        <button type="button" className={link} onClick={onMerge}>
          {t("roadtrips:editor.status.merge")}
        </button>
      )}
      {(status === "error" || status === "conflict") && (
        <button type="button" className={link} onClick={onDiscard}>
          {t("roadtrips:editor.status.discard")}
        </button>
      )}
    </span>
  );
}
