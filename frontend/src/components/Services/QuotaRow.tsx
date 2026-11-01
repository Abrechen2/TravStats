import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { SettingItem, StatusValue } from "../ui/settings";
import type { ServiceQuota } from "../../lib/api/externalServices";
import { budgetPercent } from "../ExternalServices/serviceStatus";

/**
 * The provider's quota or the budget, as measured. A quota the provider has not
 * reported yet is "noch keine Angabe" — never a zero, which would read as
 * "nothing left" or "nothing used".
 */
export default function QuotaRow({ quota }: { quota: ServiceQuota | null }): JSX.Element {
  const { t } = useTranslation(["settingsRows", "externalServices"]);
  const known =
    quota !== null &&
    quota.kind !== "none" &&
    typeof quota.used === "number" &&
    typeof quota.limit === "number";
  const percent = budgetPercent(quota);
  return (
    <SettingItem
      title={t("settingsRows:services.tpl.quota.t")}
      help={t("settingsRows:services.tpl.quota.h")}
      control={
        <StatusValue>
          {known
            ? t("externalServices:budget", {
                used: quota.used,
                limit: quota.limit,
                unit: quota.unit ?? "",
              })
            : t("settingsRows:services.ui.quotaUnknown")}
        </StatusValue>
      }
    >
      {percent !== null ? (
        <div
          role="progressbar"
          aria-label={t("settingsRows:services.tpl.quota.t")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          style={{ maxWidth: 360, height: 6, borderRadius: 999, background: "var(--ts-surface2)" }}
        >
          <div
            style={{
              width: `${Math.max(percent, 1)}%`,
              height: "100%",
              borderRadius: 999,
              background: "var(--ts-accent)",
            }}
          />
        </div>
      ) : null}
    </SettingItem>
  );
}
