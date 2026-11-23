import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { coverSuggestionsApi } from "../../lib/api/coverSuggestions";
import { logger } from "../../lib/logger";
import { token } from "../ui/tokens";

type Failure = "load" | "save" | "remove";

/**
 * "Titelbilder automatisch wählen": the account switch (default on) for covers the
 * server picks from the account's own photos, and the undo that removes ONLY those.
 */
export default function AutoCoverSetting(): JSX.Element {
  const { t } = useTranslation("immich");
  const [state, setState] = useState<{ enabled: boolean; autoCovers: number } | null>(null);
  const [failed, setFailed] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<number | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setState(await coverSuggestionsApi.getAuto());
      setFailed(null);
    } catch (err: unknown) {
      logger.error("AutoCoverSetting: load failed", err);
      setFailed("load");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (enabled: boolean): Promise<void> => {
    setBusy(true);
    setFailed(null);
    try {
      await coverSuggestionsApi.setAuto(enabled);
      setState((s) => (s ? { ...s, enabled } : s));
    } catch (err: unknown) {
      logger.error("AutoCoverSetting: save failed", err);
      setFailed("save");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    setFailed(null);
    setRemoved(null);
    try {
      setRemoved(await coverSuggestionsApi.removeAutoCovers());
      await load();
    } catch (err: unknown) {
      logger.error("AutoCoverSetting: remove failed", err);
      setFailed("remove");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1" data-testid="auto-cover-setting">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={state?.enabled ?? true}
          disabled={state === null || busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span className="label">{t("autoCover.title")}</span>
      </label>
      <p className="t-caption">{t("autoCover.hint")}</p>
      {state && state.autoCovers > 0 && (
        <p className="t-caption">{t("autoCover.count", { count: state.autoCovers })}</p>
      )}
      <button
        type="button"
        onClick={() => void remove()}
        disabled={state === null || busy}
        className="self-start text-xs underline-offset-2 hover:underline disabled:opacity-50"
        style={{ minHeight: 44, background: "none", border: "none", padding: 0 }}
      >
        {t("autoCover.remove")}
      </button>
      {removed !== null && (
        <p role="status" className="text-sm">
          {t("autoCover.removed", { count: removed })}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm" style={{ color: token("bad") }}>
          {t(`autoCover.${failed}Failed`)}
        </p>
      )}
    </div>
  );
}
