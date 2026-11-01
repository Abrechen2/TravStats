import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { usageStatsApi, type UsageStatsStatus } from "../../lib/api";
import {
  ChoiceControl,
  ErrorLine,
  SettingItem,
  SettingWriteError,
  StatusValue,
  useSettingWrite,
} from "../ui/settings";
import { useLoaded } from "./useLoaded";
import { useDemoLock } from "./useLockFor";

type Answer = "yes" | "no";

/** Nutzungsstatistik: the question is asked of the admin, "not asked" is its own state. */
export default function UsageStatsRows(): JSX.Element | null {
  const { t } = useTranslation(["settingsRows", "usageStats"]);
  const demo = useDemoLock();
  const { data, setData, failed } = useLoaded<UsageStatsStatus>(() => usageStatsApi.get());
  const saved: Answer | null =
    data?.consent === "granted" ? "yes" : data?.consent === "denied" ? "no" : null;
  const write = useSettingWrite<Answer | null>("services.usageStats.consent", saved, async (v) => {
    if (v === null) return;
    try {
      setData(await usageStatsApi.setConsent(v === "yes" ? "granted" : "denied"));
    } catch {
      throw new SettingWriteError("rejected");
    }
  });
  if (failed) return <ErrorLine>{t("settingsRows:services.ui.loadFailed")}</ErrorLine>;
  if (!data) return null;
  return (
    <>
      <SettingItem
        title={t("settingsRows:services.rows.nutzstat.t")}
        sub={t("settingsRows:services.rows.nutzstat.s")}
        help={t("settingsRows:services.rows.nutzstat.h")}
        scope="allAccounts"
        locked={demo}
        save={write}
        dependency={
          data.endpointConfigured ? undefined : { reason: t("usageStats:admin.endpointDisabled") }
        }
        control={
          <ChoiceControl<Answer>
            label={t("settingsRows:services.rows.nutzstat.t")}
            value={write.value ?? "no"}
            options={[
              { value: "no", label: t("settingsRows:services.rows.nutzstat.o.0") },
              { value: "yes", label: t("settingsRows:services.rows.nutzstat.o.1") },
            ]}
            onChange={write.choose}
          />
        }
      >
        {write.value === null ? (
          <p className="t-caption" style={{ margin: 0 }}>
            {t("settingsRows:services.status.notAsked")}
          </p>
        ) : null}
      </SettingItem>
      {data.installId ? (
        <SettingItem
          title={t("usageStats:admin.installId")}
          sub={t("usageStats:admin.installIdHint")}
          scope="allAccounts"
          control={<StatusValue>{data.installId}</StatusValue>}
        />
      ) : null}
    </>
  );
}
