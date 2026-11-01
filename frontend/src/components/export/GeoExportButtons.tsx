import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { downloadBlob } from "../../lib/export";
import { downloadGeoFile, GeoExportEmptyError, type GeoFormat } from "../../lib/api/geoExport";

interface Props {
  /** Route below `/api/v1`, from `geoExportPaths`. */
  path: string;
  params?: Record<string, string>;
  /** Names the thing for the screen reader: "GPX: track". */
  testId?: string;
  className?: string;
}

const FORMATS: GeoFormat[] = ["gpx", "kml"];

/**
 * Two buttons, GPX and KML, for one export route (forgejo#402). A refusal is
 * said in words: "nothing to export" is not "the download failed".
 */
export default function GeoExportButtons({
  path,
  params,
  testId = "geo-export",
  className = "flex flex-wrap items-center gap-2",
}: Props): JSX.Element {
  const { t } = useTranslation("common");
  const [busy, setBusy] = useState<GeoFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (format: GeoFormat): Promise<void> => {
    setBusy(format);
    setError(null);
    try {
      const file = await downloadGeoFile(path, format, params);
      downloadBlob(file.blob, file.filename);
    } catch (err) {
      setError(
        err instanceof GeoExportEmptyError
          ? t("common:geoExport.empty")
          : t("common:geoExport.error")
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={className} data-testid={testId}>
      <span className="t-caption">{t("common:geoExport.label")}</span>
      {FORMATS.map((format) => (
        <button
          key={format}
          type="button"
          disabled={busy !== null}
          onClick={() => void run(format)}
          className="rounded-lg px-3 py-1 text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
          style={{ border: "1px solid var(--color-border)", color: "var(--text-secondary)" }}
          data-testid={`${testId}-${format}`}
        >
          {format.toUpperCase()}
        </button>
      ))}
      {error && (
        <span className="t-caption" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
