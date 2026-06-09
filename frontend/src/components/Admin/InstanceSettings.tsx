import { useEffect, useState } from "react";
import { adminApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";

interface Settings {
  instanceName: string;
  maxUsers: number;
  allowRegistration: boolean;
  frontendUrl: string | null;
}

export default function InstanceSettings(): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const addToast = useToastStore((s) => s.addToast);

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Settings>({
    instanceName: "TravStats",
    maxUsers: 10,
    allowRegistration: false,
    frontendUrl: "",
  });

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getInstanceSettings()
      .then(({ settings }) => {
        if (cancelled) return;
        setForm({
          instanceName: settings.instanceName,
          maxUsers: settings.maxUsers,
          allowRegistration: settings.allowRegistration,
          frontendUrl: settings.frontendUrl ?? "",
        });
        setLoaded(true);
      })
      .catch((err) => {
        logger.error("Failed to load instance settings", err);
        addToast("error", t("admin:instance.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [addToast, t]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { settings } = await adminApi.updateInstanceSettings({
        instanceName: form.instanceName.trim(),
        maxUsers: form.maxUsers,
        allowRegistration: form.allowRegistration,
        frontendUrl: (form.frontendUrl ?? "").trim(),
      });
      setForm({
        instanceName: settings.instanceName,
        maxUsers: settings.maxUsers,
        allowRegistration: settings.allowRegistration,
        frontendUrl: settings.frontendUrl ?? "",
      });
      addToast("success", t("admin:instance.saved"));
    } catch (err) {
      logger.error("Failed to save instance settings", err);
      addToast("error", t("admin:instance.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return <div className="p-6 text-sm text-muted">{t("common:loading")}</div>;
  }

  return (
    <form onSubmit={handleSave} className="max-w-2xl space-y-6 p-6">
      <div>
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">
          {t("admin:instance.title")}
        </h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{t("admin:instance.subtitle")}</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-[var(--text-primary)]">
          {t("admin:instance.fields.name.label")}
        </label>
        <input
          type="text"
          maxLength={100}
          value={form.instanceName}
          onChange={(e) => setForm({ ...form, instanceName: e.target.value })}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t("admin:instance.fields.name.help")}
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-[var(--text-primary)]">
          {t("admin:instance.fields.frontendUrl.label")}
        </label>
        <input
          type="url"
          maxLength={500}
          value={form.frontendUrl ?? ""}
          onChange={(e) => setForm({ ...form, frontendUrl: e.target.value })}
          placeholder="https://travstats.example.com"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t("admin:instance.fields.frontendUrl.help")}
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-[var(--text-primary)]">
          {t("admin:instance.fields.maxUsers.label")}
        </label>
        <input
          type="number"
          min={1}
          max={1000}
          value={form.maxUsers}
          onChange={(e) =>
            setForm({
              ...form,
              maxUsers: Math.max(1, Math.min(1000, Number(e.target.value) || 10)),
            })
          }
          className="w-40 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t("admin:instance.fields.maxUsers.help")}
        </p>
      </div>

      <label className="flex items-start gap-3 text-sm text-[var(--text-primary)]">
        <input
          type="checkbox"
          checked={form.allowRegistration}
          onChange={(e) => setForm({ ...form, allowRegistration: e.target.checked })}
          className="mt-1 h-4 w-4 rounded border-[var(--border)]"
        />
        <span>
          <span className="font-medium">{t("admin:instance.fields.allowRegistration.label")}</span>
          <span className="block text-xs text-[var(--text-muted)]">
            {t("admin:instance.fields.allowRegistration.help")}
          </span>
        </span>
      </label>

      <div className="pt-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? t("common:buttons.saving") : t("common:buttons.save")}
        </button>
      </div>
    </form>
  );
}
