import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { failureKey } from "../../lib/api/immich";
import { getAutoLinkStatus, setAutoLinkEnabled, type AutoLinkStatus } from "../../lib/api/places";
import { logger } from "../../lib/logger";
import { token } from "../ui/tokens";

const SOURCES = ["immich", "photoprism"] as const;

/**
 * "Fotos automatisch mit Ortsbesuchen verknüpfen": the account switch for the
 * server's automatic photo links, and — when the last pass could not read a
 * photo source — the reason, so a failing source never reads as "no photos".
 */
export default function VisitPhotoAutoLink(): JSX.Element | null {
  const { t } = useTranslation("immich");
  const { isEnabled } = useEnabledDomains();
  const [status, setStatus] = useState<AutoLinkStatus | null>(null);
  const [failed, setFailed] = useState<"load" | "save" | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setStatus(await getAutoLinkStatus());
      setFailed(null);
    } catch (err: unknown) {
      logger.error("VisitPhotoAutoLink: load failed", err);
      setFailed("load");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!isEnabled("poi")) return null;

  const toggle = async (enabled: boolean): Promise<void> => {
    try {
      await setAutoLinkEnabled(enabled);
      await load();
    } catch (err: unknown) {
      logger.error("VisitPhotoAutoLink: save failed", err);
      setFailed("save");
    }
  };

  const problems = SOURCES.flatMap((source) => {
    const state = status?.lastRun?.sources[source];
    return state && state !== "ok" && state !== "notConfigured"
      ? [`${t(`visitPhotosAuto.source.${source}`)}: ${t(failureKey(state, source))}`]
      : [];
  });

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={status?.enabled ?? true}
          disabled={status === null}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span className="label">{t("visitPhotosAuto.title")}</span>
      </label>
      <p className="t-caption">{t("visitPhotosAuto.hint")}</p>
      {problems.map((line) => (
        <p key={line} role="alert" className="text-sm" style={{ color: token("bad") }}>
          {line}
        </p>
      ))}
      {failed && (
        <p role="alert" className="text-sm" style={{ color: token("bad") }}>
          {t(failed === "load" ? "visitPhotosAuto.loadFailed" : "visitPhotosAuto.saveFailed")}
        </p>
      )}
    </div>
  );
}
