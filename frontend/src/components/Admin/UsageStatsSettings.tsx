import { useEffect, useState } from "react";
import { usageStatsApi, type UsageStatsStatus } from "../../lib/api";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";

export default function UsageStatsSettings(): JSX.Element {
  const { t } = useTranslation(["usageStats", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [status, setStatus] = useState<UsageStatsStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void usageStatsApi
      .get()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((error: unknown) => logger.debug("failed to load usage-stats status", error));
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (checked: boolean): Promise<void> => {
    setBusy(true);
    try {
      setStatus(await usageStatsApi.setConsent(checked ? "granted" : "denied"));
    } catch (error) {
      // Do NOT optimistically flip the checkbox on failure — leave `status`
      // untouched so the displayed state stays truthful, and tell the admin.
      logger.debug("failed to change usage-stats consent", error);
      addToast("error", t("usageStats:consent.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return <p style={{ color: "var(--text-muted)" }}>{t("common:loading.title")}</p>;
  }

  return (
    <section className="flex flex-col gap-4 p-6">
      <div>
        <h3 className="font-medium" style={{ color: "var(--text-primary)" }}>
          {t("usageStats:admin.title")}
        </h3>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("usageStats:admin.description")}
        </p>
      </div>

      {!status.endpointConfigured && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("usageStats:admin.endpointDisabled")}
        </p>
      )}

      <label className="flex items-start gap-3 text-sm" style={{ color: "var(--text-primary)" }}>
        <input
          type="checkbox"
          checked={status.consent === "granted"}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
          className="mt-1 h-4 w-4 rounded-sm border-(--border)"
        />
        <span className="font-medium">
          {status.consent === "granted"
            ? t("usageStats:admin.enabled")
            : t("usageStats:admin.disabled")}
        </span>
      </label>

      {status.installId && (
        <div>
          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            {t("usageStats:admin.installId")}
          </span>
          <code className="block text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {status.installId}
          </code>
          <span className="block text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {t("usageStats:admin.installIdHint")}
          </span>
        </div>
      )}
    </section>
  );
}
