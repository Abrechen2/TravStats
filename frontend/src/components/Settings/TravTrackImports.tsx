import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, JSX } from "react";
import Button from "../ui/Button";
import { token } from "../ui/tokens";
import { useTranslation } from "../../hooks/useTranslation";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { formatDateTime } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import {
  importErrorKey,
  RESUMABLE_IMPORT_STATUSES,
  storedImportErrorKey,
  travTrackImportsApi,
  type TravTrackImport,
  type TravTrackImportOutcome,
  type TravTrackImportReport,
} from "../../lib/api/travtrackImports";

const NS = "track:imports";

type Status = { tone: "ok" | "bad"; text: string } | null;

/** While an import runs, the list (with the row's growing report) is read again this often. */
const LIST_REFRESH_MS = 5_000;

/**
 * GPX files into TravTrack (TravTrack plan E8), inside the TravTrack settings
 * card: choose a file, read what was stored and what was dropped and why, and
 * delete an import with the positions it brought — after its count was named.
 *
 * `canImport` is false while TravTrack is off (or for the demo account);
 * `canDelete` follows the card: the list and delete stay while data is held.
 */
export default function TravTrackImports({
  canImport,
  canDelete,
  version = 0,
  onChanged,
}: {
  canImport: boolean;
  canDelete: boolean;
  /** Raised when the list changed elsewhere (a Dawarich copy): the list loads again. */
  version?: number;
  /** The stored positions changed: the card reloads its summary. */
  onChanged: () => void;
}): JSX.Element {
  const { t } = useTranslation(["track"]);
  const { confirmDelete, confirmDialog } = useConfirmDialog();
  const input = useRef<HTMLInputElement>(null);
  const resumeInput = useRef<HTMLInputElement>(null);
  /** The stopped import the next picked file resumes. */
  const resumeOf = useRef<TravTrackImport | null>(null);
  const lastRefresh = useRef(0);
  const [imports, setImports] = useState<TravTrackImport[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setImports(await travTrackImportsApi.list());
      setLoadError(null);
    } catch (err) {
      logger.warn("TravTrack imports: could not load", err);
      setLoadError(importErrorKey(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  const describe = (r: TravTrackImportReport) =>
    [
      t(`${NS}.report.stored`, { count: r.stored }),
      r.duplicate > 0 && t(`${NS}.report.duplicate`, { count: r.duplicate }),
      r.dropped.privacy_zone > 0 && t(`${NS}.report.zone`, { count: r.dropped.privacy_zone }),
      r.dropped.deleted_range > 0 && t(`${NS}.report.deleted`, { count: r.dropped.deleted_range }),
      r.dropped.invalid + r.dropped.null_island > 0 &&
        t(`${NS}.report.invalid`, { count: r.dropped.invalid + r.dropped.null_island }),
      r.withoutTime > 0 && t(`${NS}.report.withoutTime`, { count: r.withoutTime }),
    ]
      .filter(Boolean)
      .join(" · ");

  const outcomeText = (outcome: TravTrackImportOutcome) => {
    if (outcome.status === "cancelled") return t(`${NS}.cancelled`);
    if (outcome.status === "partial") {
      return t(`${NS}.partial`, { summary: describe(outcome.report) });
    }
    return describe(outcome.report);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>, resuming: TravTrackImport | null) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setStatus({ tone: "ok", text: t(`${NS}.running`, { name: file.name }) });
    const onProgress = (percent: number) => {
      setStatus({ tone: "ok", text: t(`${NS}.runningPercent`, { name: file.name, percent }) });
      // The row's report grows with every stored batch: read, stored, duplicates.
      const now = performance.now();
      if (now - lastRefresh.current >= LIST_REFRESH_MS) {
        lastRefresh.current = now;
        void load();
      }
    };
    try {
      const outcome = resuming
        ? await travTrackImportsApi.resume(resuming.id, file, onProgress)
        : await travTrackImportsApi.importGpx(file, onProgress);
      setStatus({ tone: outcome.status === "partial" ? "bad" : "ok", text: outcomeText(outcome) });
    } catch (err) {
      logger.warn("TravTrack imports: import failed", err);
      setStatus({ tone: "bad", text: t(importErrorKey(err)) });
    } finally {
      setBusy(false);
      await load();
      onChanged();
    }
  };

  const remove = async (row: TravTrackImport) => {
    const agreed = await confirmDelete(
      t(`${NS}.deleteConfirm`, { count: row.pointCount, name: row.fileName })
    );
    if (!agreed) return;
    setBusy(true);
    setStatus(null);
    try {
      const deleted = await travTrackImportsApi.remove(row.id);
      setStatus({ tone: "ok", text: t(`${NS}.deleted`, { count: deleted }) });
      await load();
      onChanged();
    } catch (err) {
      logger.warn("TravTrack imports: delete failed", err);
      setStatus({ tone: "bad", text: t(importErrorKey(err)) });
    } finally {
      setBusy(false);
    }
  };

  const canResume = (row: TravTrackImport) =>
    canImport && row.kind === "gpx" && RESUMABLE_IMPORT_STATUSES.includes(row.status);

  const startResume = (row: TravTrackImport) => {
    resumeOf.current = row;
    resumeInput.current?.click();
  };

  const rowText = (row: TravTrackImport) => {
    // What was stored so far stays readable on a stopped or running import.
    const sofar = row.report && row.report.read > 0 ? describe(row.report) : null;
    if (row.status === "failed") {
      return [t(storedImportErrorKey(row.report?.error)), sofar && row.report!.stored > 0 && sofar]
        .filter(Boolean)
        .join(" · ");
    }
    if (row.status === "running") {
      return [t(`${NS}.status.running`), sofar].filter(Boolean).join(" · ");
    }
    if (row.status === "partial") {
      return [t(`${NS}.status.partial`), sofar].filter(Boolean).join(" · ");
    }
    if (row.status === "interrupted") {
      return t(row.kind === "dawarich" ? `${NS}.status.paused` : `${NS}.status.interrupted`);
    }
    if (row.status === "cancelled") return t(`${NS}.status.cancelled`);
    const points = t(`${NS}.points`, { count: row.pointCount });
    const format = row.report?.format;
    // The stored report, so what the import did is still readable after a reload.
    const kind = format
      ? `${t(`${NS}.formats.${format.split("+")[0]}`, { defaultValue: "" })}`
      : "";
    if (!row.report) return points;
    // What the FILE held, then what became of it — the Dawarich card's order. The row used to
    // lead with the stored count as "N Positionen", so "268534 Positionen · 268534 gespeichert ·
    // 7805 schon vorhanden" did not add up (UAT rc.45).
    const read = row.report.read > 0 ? t(`${NS}.report.read`, { count: row.report.read }) : points;
    // Removed since (a deleted span, a privacy zone drawn later): say how many are left.
    const left =
      row.pointCount !== row.report.stored
        ? t(`${NS}.report.left`, { count: row.pointCount })
        : null;
    return [kind, read, describe(row.report), left].filter(Boolean).join(" · ");
  };

  return (
    <>
      <h3 className="t-card-title" style={{ marginTop: "var(--ts-space-lg)" }}>
        {t(`${NS}.title`)}
      </h3>
      <p className="t-caption">{t(`${NS}.intro`)}</p>
      <p className="t-caption">{t(`${NS}.googleHint`)}</p>
      {canImport && (
        <div>
          {/* The button is the control; the hidden input only opens the picker. A second,
              screen-reader label repeated "Track-Datei importieren" (UAT rc.45 retest, D19). */}
          <input
            ref={input}
            id="travtrack-gpx-file"
            type="file"
            aria-hidden="true"
            tabIndex={-1}
            accept=".gpx,.json,.geojson,.kml,.tcx,application/gpx+xml,application/json,application/geo+json,application/vnd.google-earth.kml+xml"
            className="sr-only"
            disabled={busy}
            onChange={(e) => void onFile(e, null)}
          />
          <input
            ref={resumeInput}
            id="travtrack-gpx-resume-file"
            type="file"
            aria-hidden="true"
            tabIndex={-1}
            accept=".gpx,.json,.geojson,.kml,.tcx,application/gpx+xml,application/json,application/geo+json,application/vnd.google-earth.kml+xml"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const row = resumeOf.current;
              resumeOf.current = null;
              void onFile(e, row);
            }}
          />
          <Button disabled={busy} onClick={() => input.current?.click()}>
            {t(`${NS}.choose`)}
          </Button>
        </div>
      )}
      {imports.length > 0 && (
        <ul className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          {imports.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between"
              style={{ gap: "var(--ts-space-md)" }}
            >
              <span className="t-body">
                <span>{row.fileName}</span>
                {" · "}
                <span>{rowText(row)}</span>
                {row.fromAt && row.toAt && (
                  <span className="t-caption">
                    {" · "}
                    {t(`${NS}.span`, {
                      from: formatDateTime(row.fromAt),
                      to: formatDateTime(row.toAt),
                    })}
                  </span>
                )}
              </span>
              <span className="flex" style={{ gap: "var(--ts-space-sm)" }}>
                {canResume(row) && (
                  <Button disabled={busy} onClick={() => startResume(row)}>
                    {t(`${NS}.resume`)}
                  </Button>
                )}
                {canDelete && row.status !== "cancelled" && (
                  <Button disabled={busy} onClick={() => void remove(row)}>
                    {t(`${NS}.delete`)}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {loadError && (
        <p className="t-body" role="alert" style={{ color: token("bad") }}>
          {t(loadError)}
        </p>
      )}
      {status && (
        <p
          className="t-body"
          role={status.tone === "bad" ? "alert" : "status"}
          style={{ color: token(status.tone === "bad" ? "bad" : "good") }}
        >
          {status.text}
        </p>
      )}
      {confirmDialog}
    </>
  );
}
