import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { useDisplayFormat } from "../../lib/format";
import { apiErrorMachineCode } from "../../lib/apiError";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import {
  changeHistoryApi,
  type ChangeEntityType,
  type ChangeHistoryEntry,
} from "../../lib/api/changeHistory";
import { formatChangeValue } from "./formatChangeValue";

interface ChangeHistoryListProps {
  entityType: ChangeEntityType;
  entityId: string;
  /** Called after a restore wrote a value, so the page can show the entry as it now is. */
  onRestored?: () => Promise<void> | void;
}

type Load = { state: "loading" } | { state: "failed" } | { state: "ready" };

/**
 * An entry's change history (spec 2026-11-22-change-history): every recorded
 * change — when, by whom or what, which field, from → to — and a restore on the
 * values that can be written back. It lives in `ChangeHistoryDialog`, opened
 * from the entry's ⋯ menu (owner, 2026-11-23), and loads when it mounts, so an
 * entry costs no request until someone asks for its history.
 */
/** Flight fields whose stored value is a code with its own word in `flights`. */
const FLIGHT_CODED_FIELDS: ReadonlySet<string> = new Set(["status", "seatClass", "category"]);

export default function ChangeHistoryList({
  entityType,
  entityId,
  onRestored,
}: ChangeHistoryListProps): JSX.Element {
  const { t } = useTranslation(["changeHistory", "purpose", "flights"]);
  const format = useDisplayFormat();
  const coarse = useCoarsePointer();
  const addToast = useToastStore((s) => s.addToast);
  const [entries, setEntries] = useState<ChangeHistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>({ state: "loading" });
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

  useEffect(() => {
    setEntries([]);
    setCursor(null);
    void fetchFirst();
  }, [fetchFirst]);

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
          label: (stored) => codedValueLabel(entry.entityType, entry.field, stored),
        });

  // A coded value in words, as the entry's own page writes it: "business" read
  // as an English word in the German history (UAT rc.45).
  const codedValueLabel = (entity: string, field: string | null, stored: string): string | null => {
    const prefix =
      field === "purpose"
        ? "purpose:field"
        : entity === "flight" && field && FLIGHT_CODED_FIELDS.has(field)
          ? `flights:${field}`
          : null;
    return prefix ? t(`${prefix}.${stored}`, { defaultValue: stored }) : null;
  };

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
    const base =
      entry.actor && entry.source !== "system"
        ? `${source} · ${t(`changeHistory:actor.${entry.actor}`)}`
        : source;
    // A write by the MCP package names the key that made it ("via MCP / <label>").
    return entry.reason?.startsWith("via MCP") ? `${base} · ${entry.reason}` : base;
  };

  const cell = { padding: "var(--ts-space-sm) var(--ts-space-md)", verticalAlign: "top" as const };

  const body = (
    <div
      data-testid="change-history"
      className="flex flex-col"
      style={{ gap: "var(--ts-space-md)" }}
    >
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
                      : entry.operation === "create"
                        ? t("changeHistory:created")
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
                      <span className="t-caption">
                        {t(
                          // The purpose is not in any edit dialog: say where it is (retest).
                          entry.field === "purpose"
                            ? "changeHistory:notRestorablePurpose"
                            : "changeHistory:notRestorable"
                        )}
                      </span>
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
  return body;
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
