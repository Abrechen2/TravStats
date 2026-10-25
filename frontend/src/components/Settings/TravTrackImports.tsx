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
  storedImportErrorKey,
  travTrackImportsApi,
  type TravTrackImport,
  type TravTrackImportReport,
} from "../../lib/api/travtrackImports";

const NS = "track:imports";

type Status = { tone: "ok" | "bad"; text: string } | null;

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
  onChanged,
}: {
  canImport: boolean;
  canDelete: boolean;
  /** The stored positions changed: the card reloads its summary. */
  onChanged: () => void;
}): JSX.Element {
  const { t } = useTranslation(["track"]);
  const { confirmDelete, confirmDialog } = useConfirmDialog();
  const input = useRef<HTMLInputElement>(null);
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
  }, [load]);

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

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setStatus({ tone: "ok", text: t(`${NS}.running`, { name: file.name }) });
    try {
      const outcome = await travTrackImportsApi.importGpx(file);
      setStatus({
        tone: "ok",
        text: outcome.status === "cancelled" ? t(`${NS}.cancelled`) : describe(outcome.report),
      });
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

  const rowText = (row: TravTrackImport) => {
    if (row.status === "failed") return t(storedImportErrorKey(row.report?.error));
    if (row.status === "running") return t(`${NS}.status.running`);
    if (row.status === "interrupted") return t(`${NS}.status.interrupted`);
    if (row.status === "cancelled") return t(`${NS}.status.cancelled`);
    return t(`${NS}.points`, { count: row.pointCount });
  };

  return (
    <>
      <h3 className="t-card-title" style={{ marginTop: "var(--ts-space-lg)" }}>
        {t(`${NS}.title`)}
      </h3>
      <p className="t-caption">{t(`${NS}.intro`)}</p>
      {canImport && (
        <div>
          <label htmlFor="travtrack-gpx-file" className="sr-only">
            {t(`${NS}.choose`)}
          </label>
          <input
            ref={input}
            id="travtrack-gpx-file"
            type="file"
            accept=".gpx,application/gpx+xml"
            className="sr-only"
            disabled={busy}
            onChange={(e) => void onFile(e)}
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
              {canDelete && row.status !== "cancelled" && (
                <Button disabled={busy} onClick={() => void remove(row)}>
                  {t(`${NS}.delete`)}
                </Button>
              )}
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
