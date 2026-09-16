import { useEffect, useState } from "react";
import { adminApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";

interface State {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
  backupPath: string;
  passwordAlreadySet: boolean;
}

/**
 * The values as the server last reported them — no password, because the form
 * never holds the stored one.
 */
type Saved = Pick<State, "enabled" | "url" | "username" | "backupPath">;

export default function WebDAVSettings(): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const addToast = useToastStore((s) => s.addToast);

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [form, setForm] = useState<State>({
    enabled: false,
    url: "",
    username: "",
    password: "",
    backupPath: "/TravStats/backups/",
    passwordAlreadySet: false,
  });
  // The connection test asks the BACKEND to dial the STORED configuration:
  // `POST /admin/webdav-settings/test` reads `enabled` out of admin_settings and
  // answers 400 "WebDAV sync is disabled" when it is off. So an edited-but-unsaved
  // form says nothing about what that test will do — ticking the box and pressing
  // "test connection" produced a plain failure toast, and the only way to find out
  // why was to save first (beta report, 2026-09-12). Keep what the server last
  // said, so the button can refuse instead of misleading.
  const [saved, setSaved] = useState<Saved | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getWebDAVSettings()
      .then(({ settings }) => {
        if (cancelled) return;
        const persisted: Saved = {
          enabled: settings.enabled,
          url: settings.url ?? "",
          username: settings.username ?? "",
          backupPath: settings.backupPath,
        };
        setForm({
          ...persisted,
          password: "",
          passwordAlreadySet: settings.passwordSet,
        });
        setSaved(persisted);
        setLoaded(true);
      })
      .catch((err) => {
        logger.error("Failed to load WebDAV settings", err);
        addToast("error", t("admin:webdav.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [addToast, t]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { settings } = await adminApi.updateWebDAVSettings({
        enabled: form.enabled,
        url: form.url.trim(),
        username: form.username.trim(),
        // Only send the password when the user actually typed something.
        // An empty string would wipe the stored password by design —
        // send undefined instead to keep the existing value.
        ...(form.password.length > 0 && { password: form.password }),
        backupPath: form.backupPath.trim() || "/TravStats/backups/",
      });
      const persisted: Saved = {
        enabled: settings.enabled,
        url: settings.url ?? "",
        username: settings.username ?? "",
        backupPath: settings.backupPath,
      };
      setForm((prev) => ({
        ...prev,
        ...persisted,
        password: "",
        passwordAlreadySet: settings.passwordSet,
      }));
      setSaved(persisted);
      addToast("success", t("admin:webdav.saved"));
    } catch (err) {
      logger.error("Failed to save WebDAV settings", err);
      addToast("error", t("admin:webdav.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await adminApi.testWebDAVConnection();
      addToast(
        result.success ? "success" : "error",
        result.success
          ? t("admin:webdav.testOk")
          : `${t("admin:webdav.testFailed")}: ${result.message}`
      );
    } catch (err) {
      logger.error("WebDAV connection test failed", err);
      addToast("error", t("admin:webdav.testFailed"));
    } finally {
      setTesting(false);
    }
  };

  // `backupPath` is normalised on save, so compare the value that would be sent.
  const unsavedChanges =
    saved === null ||
    form.enabled !== saved.enabled ||
    form.url.trim() !== saved.url ||
    form.username.trim() !== saved.username ||
    (form.backupPath.trim() || "/TravStats/backups/") !== saved.backupPath ||
    form.password.length > 0;
  const canTest = saved !== null && saved.enabled && !unsavedChanges;
  const testBlockedReason = unsavedChanges
    ? t("admin:webdav.testNeedsSave")
    : saved !== null && !saved.enabled
      ? t("admin:webdav.testNeedsEnabled")
      : null;

  if (!loaded) {
    return <div className="p-6 text-sm text-muted">{t("common:loading.default")}</div>;
  }

  return (
    <form onSubmit={handleSave} className="max-w-2xl space-y-6 p-6">
      <div>
        <h3 className="text-lg font-semibold text-(--text-primary)">{t("admin:webdav.title")}</h3>
        <p className="mt-1 text-sm text-(--text-muted)">{t("admin:webdav.subtitle")}</p>
      </div>

      <label className="flex items-start gap-3 text-sm text-(--text-primary)">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          className="mt-1 h-4 w-4 rounded-sm border-(--border)"
        />
        <span>
          <span className="font-medium">{t("admin:webdav.fields.enabled.label")}</span>
          <span className="block text-xs text-(--text-muted)">
            {t("admin:webdav.fields.enabled.help")}
          </span>
        </span>
      </label>

      <fieldset disabled={!form.enabled} className="space-y-6 disabled:opacity-50">
        <div>
          <label
            htmlFor="webdav-url"
            className="mb-1 block text-sm font-medium text-(--text-primary)"
          >
            {t("admin:webdav.fields.url.label")}
          </label>
          <input
            id="webdav-url"
            type="url"
            maxLength={500}
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="https://cloud.example.com/remote.php/dav/files/username/"
            className="w-full rounded-lg border border-(--border) bg-(--bg-elevated) px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-(--text-muted)">{t("admin:webdav.fields.url.help")}</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="webdav-username"
              className="mb-1 block text-sm font-medium text-(--text-primary)"
            >
              {t("admin:webdav.fields.username.label")}
            </label>
            <input
              id="webdav-username"
              type="text"
              maxLength={200}
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="w-full rounded-lg border border-(--border) bg-(--bg-elevated) px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="webdav-password"
              className="mb-1 block text-sm font-medium text-(--text-primary)"
            >
              {t("admin:webdav.fields.password.label")}
            </label>
            <input
              id="webdav-password"
              type="password"
              maxLength={500}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={
                form.passwordAlreadySet
                  ? t("admin:webdav.fields.password.placeholderKeep")
                  : t("admin:webdav.fields.password.placeholderSet")
              }
              className="w-full rounded-lg border border-(--border) bg-(--bg-elevated) px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-(--text-muted)">
              {t("admin:webdav.fields.password.help")}
            </p>
          </div>
        </div>

        <div>
          <label
            htmlFor="webdav-backupPath"
            className="mb-1 block text-sm font-medium text-(--text-primary)"
          >
            {t("admin:webdav.fields.backupPath.label")}
          </label>
          <input
            id="webdav-backupPath"
            type="text"
            maxLength={200}
            value={form.backupPath}
            onChange={(e) => setForm({ ...form, backupPath: e.target.value })}
            className="w-full rounded-lg border border-(--border) bg-(--bg-elevated) px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-(--text-muted)">
            {t("admin:webdav.fields.backupPath.help")}
          </p>
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base) hover:opacity-90 disabled:opacity-50"
        >
          {saving ? t("common:buttons.saving") : t("common:buttons.save")}
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || !canTest}
          className="rounded-lg border border-(--border) px-4 py-2 text-sm text-(--text-primary) disabled:opacity-50"
        >
          {testing ? t("admin:webdav.testing") : t("admin:webdav.test")}
        </button>
      </div>

      {testBlockedReason !== null && (
        <p className="text-xs text-(--text-muted)">{testBlockedReason}</p>
      )}
    </form>
  );
}
