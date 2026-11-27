import { useCallback, useEffect, useState, type JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { tripPhotoSourcesApi } from "../../lib/api/tripPhotoSources";
import { logger } from "../../lib/logger";
import InlineError from "../ui/InlineError";

/**
 * "Zeitraum automatisch verknüpfen für Reisen ohne Album" (spec 2026-11-26-trip-photo-links.md,
 * decision 4): the account switch, default off. Only references are linked.
 */
export default function PhotoPeriodAutoSetting(): JSX.Element {
  const { t } = useTranslation("immich");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [failed, setFailed] = useState<"load" | "save" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setEnabled(await tripPhotoSourcesApi.getAutoPeriod());
      setFailed(null);
    } catch (err: unknown) {
      logger.error("PhotoPeriodAutoSetting: load failed", err);
      setFailed("load");
    }
  }, []);
  useEffect(() => void load(), [load]);

  const toggle = async (next: boolean): Promise<void> => {
    setBusy(true);
    setFailed(null);
    try {
      await tripPhotoSourcesApi.setAutoPeriod(next);
      setEnabled(next);
    } catch (err: unknown) {
      logger.error("PhotoPeriodAutoSetting: save failed", err);
      setFailed("save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1" data-testid="photo-period-auto-setting">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled ?? false}
          disabled={enabled === null || busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span className="label">{t("periodAuto.title")}</span>
      </label>
      <p className="t-caption">{t("periodAuto.hint")}</p>
      {failed && (
        <InlineError>
          {t(failed === "load" ? "periodAuto.loadFailed" : "periodAuto.saveFailed")}
        </InlineError>
      )}
    </div>
  );
}
