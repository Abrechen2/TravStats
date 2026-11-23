import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { changeHistoryApi } from "../../lib/api/changeHistory";
import { logger } from "../../lib/logger";
import { ChoiceControl, SettingItem, StatusValue, useSettingWrite } from "../ui/settings";

/** Shown until the server has answered, and when it cannot: the server's own default. */
const FALLBACK_OPTIONS = [3, 6, 12, 24];

/**
 * "Änderungsverlauf behalten": how many months of every entry's change history the
 * account keeps (owner, 2026-11-23). A nightly job deletes older rows, so a longer
 * choice only ever keeps more; a shorter one drops the rest at the next run.
 */
export default function ChangeHistoryRetentionRow(): JSX.Element {
  const { t } = useTranslation(["changeHistory", "settings"]);
  const [saved, setSaved] = useState<string | null>(null);
  const [options, setOptions] = useState<number[]>(FALLBACK_OPTIONS);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    changeHistoryApi
      .retention()
      .then((r) => {
        if (!live) return;
        setSaved(String(r.months));
        setOptions(r.options);
      })
      .catch((err: unknown) => {
        logger.error("ChangeHistoryRetentionRow: load failed", err);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const write = useSettingWrite<string>(
    "changeHistory.retentionMonths",
    saved ?? "12",
    async (v) => {
      const r = await changeHistoryApi.setRetention(Number(v));
      setSaved(String(r.months));
    }
  );

  return (
    <SettingItem
      title={t("changeHistory:retention.title")}
      sub={t("changeHistory:retention.sub")}
      save={write}
      error={failed ? t("changeHistory:retention.loadFailed") : undefined}
      control={
        saved === null ? (
          <StatusValue>{failed ? "–" : t("changeHistory:loading")}</StatusValue>
        ) : (
          <ChoiceControl
            label={t("changeHistory:retention.title")}
            value={write.value}
            options={options.map((m) => ({
              value: String(m),
              label: t("changeHistory:retention.option", { count: m }),
            }))}
            onChange={write.choose}
          />
        )
      }
    />
  );
}
