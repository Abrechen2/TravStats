import { useCallback, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  CHECKIN_MAX_CHARS,
  CHECKIN_MAX_RECORDS,
  CheckinImportError,
  sendCheckinImport,
  type CheckinFailure,
  type CheckinSource,
} from "../../lib/api/checkinImport";
import type { ImportOutcome } from "../../lib/xlsx/importClient";
import { logger } from "../../lib/logger";
import { SheetRows } from "../Settings/SpreadsheetSection";
import { ImportTileShell, ImportFilePicker, ImportErrorBlock } from "./ImportTileShell";

type Phase = "idle" | "reading" | "previewed" | "applying" | "applied" | "unknown";
const BYTES_PER_MB = 1_000_000;
const SOURCES: readonly CheckinSource[] = ["travelling", "travelynx"];

/** A reason code from the server -> its sentence. `unsupported_mode:ferry` carries its mode. */
function reasonCopy(
  t: (key: string, options?: Record<string, unknown>) => string,
  message: string | undefined
): string {
  const code = message ?? "";
  if (code.startsWith("unsupported_mode:")) {
    return t("xlsx:import.errors.unsupported_mode", {
      mode: code.slice("unsupported_mode:".length),
    });
  }
  return t(`xlsx:import.errors.${code}`, { defaultValue: code });
}

/**
 * Träwelling / travelynx export -> rail and bus rides (forgejo#401).
 *
 * The file is read here as text and parsed on the server; a first request
 * (dry run) shows what would happen, and only a second one, over the SAME held
 * text, writes. Rows the server cannot read stay visible with their reason —
 * they are skipped, they never block the readable ones.
 */
export function CheckinImportTile({ onImported }: { onImported?: () => void }): JSX.Element {
  const { t } = useTranslation(["settings", "xlsx"]);
  const [source, setSource] = useState<CheckinSource>("travelling");
  const [phase, setPhase] = useState<Phase>("idle");
  const [held, setHeld] = useState<{ source: CheckinSource; text: string } | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const failureCopy = useCallback(
    (kind: CheckinFailure, applying: boolean): string => {
      switch (kind) {
        case "tooMany":
          return t("xlsx:import.importTooManyRows", { max: CHECKIN_MAX_RECORDS });
        case "network":
          return t("settings:import.tile.checkin.network");
        case "rateLimited":
          return t("settings:import.tile.checkin.rateLimited");
        case "outcomeUnknown":
          return t("xlsx:import.outcomeUnknown");
        case "invalid":
          return t("settings:import.tile.checkin.failed");
        default:
          return t(
            applying
              ? "settings:import.tile.checkin.applyFailed"
              : "settings:import.tile.checkin.failed"
          );
      }
    },
    [t]
  );

  const reset = useCallback((): void => {
    setPhase("idle");
    setHeld(null);
    setOutcome(null);
  }, []);

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      setError(null);
      setOutcome(null);
      setHeld(null);
      setPhase("reading");
      try {
        const text = await file.text();
        if (text.length > CHECKIN_MAX_CHARS) {
          setError(
            t("settings:import.parserErrors.tooLarge", {
              size: (text.length / BYTES_PER_MB).toFixed(1),
              max: CHECKIN_MAX_CHARS / BYTES_PER_MB,
            })
          );
          setPhase("idle");
          return;
        }
        const result = await sendCheckinImport(source, text, true);
        setHeld({ source, text });
        setOutcome(result);
        setPhase("previewed");
      } catch (err: unknown) {
        // The sentence is the user's; the cause belongs in the log.
        logger.error("CheckinImportTile: preview failed", err);
        setError(failureCopy(err instanceof CheckinImportError ? err.kind : "failed", false));
        setPhase("idle");
      }
    },
    [source, t, failureCopy]
  );

  const handleApply = useCallback(async (): Promise<void> => {
    if (!held) return;
    setError(null);
    setPhase("applying");
    try {
      setOutcome(await sendCheckinImport(held.source, held.text, false));
      setPhase("applied");
      onImported?.();
    } catch (err: unknown) {
      logger.error("CheckinImportTile: apply failed", err);
      setError(failureCopy(err instanceof CheckinImportError ? err.kind : "failed", true));
      // Unknown outcome: the first job may still be writing, and a second one
      // alongside it could enter the same rides twice — so no retry from here,
      // the user starts over once the import log shows the result.
      // Any other failure is final, and a retry re-sends exactly what was
      // previewed (the server recognises what a half-finished run wrote).
      const unknown = err instanceof CheckinImportError && err.kind === "outcomeUnknown";
      setPhase(unknown ? "unknown" : "previewed");
    }
  }, [held, onImported, failureCopy]);

  const sheets = outcome?.sheets ?? [];
  const errorRows = sheets.flatMap((s) =>
    s.rows.filter((r) => r.action === "error").map((r) => ({ ...r, sheet: s.key }))
  );
  const creatable = sheets.reduce((n, s) => n + s.created, 0);
  const total = sheets.reduce((n, s) => n + s.created + s.updated + s.skipped + s.errors, 0);
  const busy = phase === "reading" || phase === "applying";

  return (
    <ImportTileShell
      title={t("settings:import.tile.checkin.title")}
      description={t("settings:import.tile.checkin.description")}
      picker={
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2">
            <span className="t-caption">{t("settings:import.tile.checkin.sourceLabel")}</span>
            <select
              value={source}
              disabled={busy}
              onChange={(e) => setSource(e.target.value as CheckinSource)}
              data-testid="checkin-source"
              className="rounded-md border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
            >
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(`settings:import.tile.checkin.sources.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <ImportFilePicker
            label={t("settings:import.tile.checkin.uploadLabel")}
            accept=".csv,.json,.txt"
            disabled={busy}
            onFile={(file) => void handleFile(file)}
          />
        </div>
      }
      errorBlock={error ? <ImportErrorBlock message={error} /> : undefined}
      statusBlock={
        phase === "reading" ? (
          <p className="t-caption">{t("settings:import.tile.checkin.previewing")}</p>
        ) : undefined
      }
    >
      {outcome &&
        (phase === "previewed" ||
          phase === "applying" ||
          phase === "applied" ||
          phase === "unknown") && (
          <div className="space-y-2 text-xs" data-testid="checkin-outcome">
            {total === 0 ? (
              <p>{t("settings:import.tile.checkin.nothing")}</p>
            ) : (
              <>
                <p style={{ color: "var(--text-muted)" }}>
                  {phase === "applied" ? t("xlsx:import.applied") : t("xlsx:import.preview")}
                </p>
                {sheets.map((s) => (
                  <div key={s.key}>
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium">{t(`xlsx:sheets.${s.key}`)}</span>
                      <span style={{ color: "var(--text-muted)" }}>
                        {t("xlsx:import.counts", {
                          created: s.created,
                          updated: s.updated,
                          skipped: s.skipped,
                          errors: s.errors,
                        })}
                      </span>
                    </div>
                    <SheetRows sheet={s} t={t} />
                  </div>
                ))}
                {errorRows.length > 0 && (
                  <div className="mt-2 space-y-1" style={{ color: "var(--ts-bad)" }}>
                    <p>
                      {t("settings:import.tile.checkin.someSkipped", { count: errorRows.length })}
                    </p>
                    {errorRows.map((r) => (
                      <p key={`${r.sheet}-${r.row}`}>
                        {t("xlsx:import.rowError", {
                          row: r.row,
                          label: r.label,
                          message: reasonCopy(t, r.message),
                        })}
                      </p>
                    ))}
                  </div>
                )}
                {(phase === "previewed" || phase === "applying") && creatable === 0 && (
                  <p>{t("settings:import.tile.checkin.nothingImportable")}</p>
                )}
              </>
            )}
            {(phase === "previewed" || phase === "applying") && (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleApply()}
                  disabled={creatable === 0 || phase === "applying"}
                  className="btn-secondary"
                >
                  {phase === "applying" ? t("xlsx:import.applying") : t("xlsx:import.apply")}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  disabled={phase === "applying"}
                  className="btn-secondary"
                >
                  {t("xlsx:import.cancel")}
                </button>
              </div>
            )}
            {(phase === "applied" || phase === "unknown") && (
              <button type="button" onClick={reset} className="btn-secondary">
                {t("xlsx:import.choose")}
              </button>
            )}
          </div>
        )}
    </ImportTileShell>
  );
}
