import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import DetailSection from "../ui/DetailSection";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { useDisplayFormat } from "../../lib/displayFormat";
import { apiErrorMachineCode } from "../../lib/apiError";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import {
  changeHistoryApi,
  type ChangeEntityType,
  type ChangeHistoryEntry,
} from "../../lib/api/changeHistory";
import { formatChangeValue } from "./formatChangeValue";

interface ChangeHistorySectionProps {
  entityType: ChangeEntityType;
  entityId: string;
  /** Called after a restore wrote a value, so the page can show the entry as it now is. */
  onRestored?: () => Promise<void> | void;
  /**
   * Inside a card or a dialog (a stay, a visit, a cruise stop, an expense):
   * no section frame of its own, only the "Verlauf" button and, once opened, the list.
   */
  compact?: boolean;
}

type Load = { state: "closed" } | { state: "loading" } | { state: "failed" } | { state: "ready" };

/**
 * "Verlauf" on an entry's detail page (spec 2026-11-22-change-history): every
 * recorded change — when, by whom or what, which field, from → to — and a
 * restore on the values that can be written back. Spans the page's full width:
 * the from → to column needs it. Loaded when opened, so a detail page costs no
 * extra request until someone asks for its history.
 */
export default function ChangeHistorySection({
  entityType,
  entityId,
  onRestored,
  compact = false,
}: ChangeHistorySectionProps): JSX.Element {
  const { t } = useTranslation(["changeHistory"]);
  const format = useDisplayFormat();
  const coarse = useCoarsePointer();
  const addToast = useToastStore((s) => s.addToast);
  const [entries, setEntries] = useState<ChangeHistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>({ state: "closed" });
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const fetchFirst = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const page = await changeHistoryApi.forEntry(entityType, entityId);
      setEntries(page.entries);
      setCursor(page.nextCursor);
      setLoad({ state: "ready" });
    } catch (err) {
      logger.warn("change history load failed", { entityType, entityId, err });
      setLoad({ state: "failed" });
    }
  }, [entityType, entityId]);

  // A different entry on the same page instance starts closed again.
  useEffect(() => {
    setLoad({ state: "closed" });
    setEntries([]);
    setCursor(null);
  }, [entityType, entityId]);

  const fetchMore = async () => {
    if (!cursor) return;
    try {
      const page = await changeHistoryApi.forEntry(entityType, entityId, cursor);
      setEntries((prev) => [...prev, ...page.entries]);
      setCursor(page.nextCursor);
    } catch (err) {
      logger.warn("change history page failed", { entityType, entityId, err });
      setLoad({ state: "failed" });
    }
  };

  const fieldLabel = (field: string | null): string =>
    field ? t(`changeHistory:field.${field}`, { defaultValue: field }) : "";

  const valueText = (entry: ChangeHistoryEntry, value: unknown): string =>
    entry.omitted
      ? t("changeHistory:omitted")
      : formatChangeValue(value, entry.valueType, entry.field, {
          dateTime: (iso) => format.dateTime(iso, { timeZone: "UTC" }),
          empty: t("changeHistory:emptyValue"),
          yes: t("changeHistory:yes"),
          no: t("changeHistory:no"),
        });

  const restore = async (entry: ChangeHistoryEntry) => {
    setRestoring(entry.id);
    setRestoreError(null);
    const field = fieldLabel(entry.field);
    try {
      const written = await changeHistoryApi.restore(entry.id);
      addToast(
        "success",
        t(written.length > 0 ? "changeHistory:restored" : "changeHistory:restoreNoop", { field })
      );
    } catch (err) {
      const code = apiErrorMachineCode(err);
      logger.warn("change history restore failed", { id: entry.id, code, err });
      setRestoreError(
        code === "CHANGE_NOT_RESTORABLE"
          ? t("changeHistory:restoreRefused")
          : code === "CHANGE_NOT_FOUND"
            ? t("changeHistory:restoreNotFound")
            : t("changeHistory:restoreFailed")
      );
      setRestoring(null);
      return;
    }
    try {
      await onRestored?.();
      await fetchFirst();
    } catch (err) {
      logger.warn("change history reload after restore failed", { err });
      setRestoreError(t("changeHistory:reloadFailed"));
    } finally {
      setRestoring(null);
    }
  };

  const who = (entry: ChangeHistoryEntry): string => {
    const source = t(`changeHistory:source.${entry.source}`);
    return entry.actor && entry.source !== "system"
      ? `${source} · ${t(`changeHistory:actor.${entry.actor}`)}`
      : source;
  };

  const cell = { padding: "var(--ts-space-sm) var(--ts-space-md)", verticalAlign: "top" as const };

  const body = (
    <div
      data-testid="change-history"
      className="flex flex-col"
      style={{ gap: "var(--ts-space-md)" }}
    >
      {load.state === "closed" && (
        <div>
          <button
            type="button"
            className="ts-chip"
            data-testid="change-history-open"
            onClick={() => void fetchFirst()}
            style={chipStyle(coarse)}
          >
            {compact ? t("changeHistory:title") : t("changeHistory:show")}
          </button>
        </div>
      )}
      {load.state === "loading" && <p className="t-caption">{t("changeHistory:loading")}</p>}
      {load.state === "failed" && (
        <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
          <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
            {t("changeHistory:loadFailed")}
          </p>
          <button
            type="button"
            className="ts-chip"
            onClick={() => void fetchFirst()}
            style={chipStyle(coarse)}
          >
            {t("changeHistory:retry")}
          </button>
        </div>
      )}
      {restoreError && (
        <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
          {restoreError}
        </p>
      )}
      {load.state === "ready" && entries.length === 0 && (
        <p className="t-caption">{t("changeHistory:empty")}</p>
      )}
      {load.state === "ready" && entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr className="t-caption" style={{ textAlign: "left" }}>
                <th style={cell}>{t("changeHistory:columns.when")}</th>
                <th style={cell}>{t("changeHistory:columns.who")}</th>
                <th style={cell}>{t("changeHistory:columns.what")}</th>
                <th style={cell}>{t("changeHistory:columns.change")}</th>
                <th style={cell} aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  data-testid="change-history-row"
                  style={{ borderTop: "1px solid var(--ts-border)", color: "var(--ts-text)" }}
                >
                  <td style={{ ...cell, whiteSpace: "nowrap" }}>
                    {format.dateTime(entry.createdAt)}
                  </td>
                  <td style={cell}>
                    {who(entry)}
                    {entry.restoredFromId && (
                      <span className="t-caption"> · {t("changeHistory:restoreOf")}</span>
                    )}
                  </td>
                  <td style={cell}>
                    {entry.operation === "delete"
                      ? t("changeHistory:deleted")
                      : fieldLabel(entry.field)}
                  </td>
                  <td style={{ ...cell, wordBreak: "break-word" }}>
                    {entry.operation === "update" && (
                      <>
                        <span style={{ color: "var(--ts-muted)" }}>
                          {valueText(entry, entry.oldValue)}
                        </span>
                        {" → "}
                        <span style={{ color: "var(--ts-text-bright)", fontWeight: 600 }}>
                          {valueText(entry, entry.newValue)}
                        </span>
                      </>
                    )}
                  </td>
                  <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>
                    {entry.restorable ? (
                      <button
                        type="button"
                        className="ts-chip"
                        data-testid="change-history-restore"
                        disabled={restoring !== null}
                        aria-busy={restoring === entry.id}
                        title={t("changeHistory:restoreTitle", {
                          value: valueText(entry, entry.oldValue),
                          field: fieldLabel(entry.field),
                        })}
                        onClick={() => void restore(entry)}
                        style={chipStyle(coarse)}
                      >
                        {t("changeHistory:restore")}
                      </button>
                    ) : entry.operation === "update" && !entry.omitted ? (
                      <span className="t-caption">{t("changeHistory:notRestorable")}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {load.state === "ready" && cursor && (
        <div>
          <button
            type="button"
            className="ts-chip"
            onClick={() => void fetchMore()}
            style={chipStyle(coarse)}
          >
            {t("changeHistory:more")}
          </button>
        </div>
      )}
    </div>
  );
  return compact ? body : <DetailSection title={t("changeHistory:title")}>{body}</DetailSection>;
}

function chipStyle(coarse: boolean) {
  return {
    display: "inline-flex",
    alignItems: "center",
    minHeight: coarse ? "var(--ts-size-touch-min)" : 34,
    padding: "0 var(--ts-space-lg)",
    borderRadius: "var(--ts-radius-chip)",
    border: "1px solid var(--ts-border-button)",
    background: "transparent",
    color: "var(--ts-text)",
    fontSize: 13,
    fontWeight: 600,
  } as const;
}
