/**
 * The Excel export, reachable.
 *
 * There has been a working flight exporter in `lib/xlsxRoundTrip.ts` since
 * long before this — tested, and with no caller anywhere in the app, so from
 * the outside TravStats simply had no Excel export. This section is what makes
 * the capability exist for a user.
 *
 * The data is fetched here, on the click, rather than held in a store: an
 * export is rare, and pre-loading every cruise, property and place on the
 * chance someone might want a spreadsheet would cost every page load.
 */

import { useCallback, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { cruiseApi } from "../../lib/api/cruise";
import { listLodgings } from "../../lib/api/lodging";
import { placesApi } from "../../lib/api/places";
import { exportFilename, exportWorkbook } from "../../lib/xlsx/exportAll";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";

type Status = "idle" | "running" | "empty" | "failed";

export default function SpreadsheetSection(): JSX.Element {
  const { t } = useTranslation(["xlsx", "common"]);
  const { isEnabled } = useEnabledDomains();
  const [status, setStatus] = useState<Status>("idle");

  const handleExport = useCallback(async () => {
    setStatus("running");
    try {
      // Only domains this instance actually runs. Asking the cruise endpoint
      // on an instance with cruises switched off would 404 and fail the whole
      // export over data the user does not have.
      const [cruises, lodging, places] = await Promise.all([
        isEnabled("cruise") ? cruiseApi.list() : Promise.resolve([]),
        isEnabled("lodging") ? listLodgings() : Promise.resolve([]),
        isEnabled("poi") ? placesApi.list() : Promise.resolve([]),
      ]);

      const blob = await exportWorkbook(t, { cruises, lodging, places });
      if (!blob) {
        setStatus("empty");
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFilename(t, new Date());
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking immediately can cancel the download in some browsers; one
      // tick is enough for the click to have been taken.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus("idle");
    } catch {
      setStatus("failed");
    }
  }, [isEnabled, t]);

  return (
    <section className="rounded-lg border border-[var(--border)] p-4">
      <h3 className="mb-1 text-sm font-semibold">{t("xlsx:export.button")}</h3>
      <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
        {t("xlsx:export.description")}
      </p>

      <button
        type="button"
        onClick={handleExport}
        disabled={status === "running"}
        className="rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60"
        style={{ background: "var(--accent)", color: "#0b0f14" }}
      >
        {status === "running" ? t("xlsx:export.running") : t("xlsx:export.button")}
      </button>

      {status === "empty" && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("xlsx:export.empty")}
        </p>
      )}
      {status === "failed" && (
        <p className="mt-2 text-xs" style={{ color: "var(--danger, #f87171)" }}>
          {t("xlsx:export.failed")}
        </p>
      )}
    </section>
  );
}
