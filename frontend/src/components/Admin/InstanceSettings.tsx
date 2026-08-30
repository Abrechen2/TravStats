import { useEffect, useState } from "react";
import { adminApi } from "../../lib/api";
import { useSettingsStore } from "../../store/settingsStore";
import { useToastStore } from "../../store/toastStore";
import BetaFeatureList from "./BetaFeatureList";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import type { PasskeyStatus } from "../../lib/api/admin";

interface Settings {
  instanceName: string;
  maxUsers: number;
  allowRegistration: boolean;
  /**
   * Instance-wide gate for unfinished features (see config/betaFeatures.ts).
   * Instance state, never persisted client-side — the settings store
   * deliberately leaves it out of its `partialize`.
   */
  betaFeaturesEnabled: boolean;
  frontendUrl: string | null;
  publicUrl: string | null;
  lanUrl: string | null;
  webauthnRpId: string | null;
  /** Edited as one origin per line — the API takes an array. */
  webauthnOrigins: string;
}

/**
 * The first field-level validation message the server sent, as
 * "field: reason", or null when this was not a validation failure. The shape
 * comes from `errorHandler`'s ZodError branch.
 */
function validationDetail(err: unknown): string | null {
  const body = (err as { response?: { data?: unknown } } | undefined)?.response?.data;
  if (typeof body !== "object" || body === null) return null;
  const details = (body as { details?: unknown }).details;
  if (!Array.isArray(details) || details.length === 0) return null;
  const first = details[0] as { field?: unknown; message?: unknown };
  if (typeof first.message !== "string") return null;
  return typeof first.field === "string" && first.field.length > 0
    ? `${first.field}: ${first.message}`
    : first.message;
}

/** "a\nb\n\nc" -> ["a", "b", "c"]. Blank lines are how people separate things
 *  while typing, not entries they meant to save. */
function parseOrigins(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export default function InstanceSettings(): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const syncBetaFeaturesEnabled = useSettingsStore((s) => s.syncBetaFeaturesEnabled);

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Settings>({
    instanceName: "TravStats",
    maxUsers: 10,
    allowRegistration: false,
    betaFeaturesEnabled: false,
    frontendUrl: "",
    publicUrl: "",
    lanUrl: "",
    webauthnRpId: "",
    webauthnOrigins: "",
  });
  const [passkeyStatus, setPasskeyStatus] = useState<PasskeyStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getInstanceSettings()
      .then(({ settings, passkeyStatus: status }) => {
        if (cancelled) return;
        setForm({
          instanceName: settings.instanceName,
          maxUsers: settings.maxUsers,
          allowRegistration: settings.allowRegistration,
          betaFeaturesEnabled: settings.betaFeaturesEnabled,
          frontendUrl: settings.frontendUrl ?? "",
          publicUrl: settings.publicUrl ?? "",
          lanUrl: settings.lanUrl ?? "",
          webauthnRpId: settings.webauthnRpId ?? "",
          webauthnOrigins: (settings.webauthnOrigins ?? []).join("\n"),
        });
        setPasskeyStatus(status);
        setLoaded(true);
      })
      .catch((err) => {
        logger.error("Failed to load instance settings", err);
        addToast("error", t("admin:instance.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
    // Mount-only on purpose (#190): this fetch seeds the form once. Listing
    // `t`/`addToast` here re-ran it on re-renders (their identity is not
    // guaranteed stable), and every re-run overwrote whatever the admin was
    // typing with the server's values — the form was uneditable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { settings, passkeyStatus: status } = await adminApi.updateInstanceSettings({
        instanceName: form.instanceName.trim(),
        maxUsers: form.maxUsers,
        allowRegistration: form.allowRegistration,
        betaFeaturesEnabled: form.betaFeaturesEnabled,
        frontendUrl: (form.frontendUrl ?? "").trim(),
        publicUrl: (form.publicUrl ?? "").trim(),
        lanUrl: (form.lanUrl ?? "").trim(),
        webauthnRpId: (form.webauthnRpId ?? "").trim(),
        webauthnOrigins: parseOrigins(form.webauthnOrigins),
      });
      setForm({
        instanceName: settings.instanceName,
        maxUsers: settings.maxUsers,
        allowRegistration: settings.allowRegistration,
        betaFeaturesEnabled: settings.betaFeaturesEnabled,
        frontendUrl: settings.frontendUrl ?? "",
        publicUrl: settings.publicUrl ?? "",
        lanUrl: settings.lanUrl ?? "",
        webauthnRpId: settings.webauthnRpId ?? "",
        webauthnOrigins: (settings.webauthnOrigins ?? []).join("\n"),
      });
      setPasskeyStatus(status);
      // Mirror the server-confirmed flag into the settings store, so gated UI
      // (Devices entry, POI tab, trip AI card) reacts immediately — before
      // this, the gates only saw the new value after a full page reload.
      syncBetaFeaturesEnabled(settings.betaFeaturesEnabled);
      addToast("success", t("admin:instance.saved"));
    } catch (err) {
      logger.error("Failed to save instance settings", err);
      // This form has eight fields; "Failed to save" leaves the admin guessing
      // which one the server rejected. Zod already names the field and the
      // reason, so say that instead of throwing the detail away.
      const detail = validationDetail(err);
      addToast("error", detail ?? t("admin:instance.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return <div className="p-6 text-sm text-muted">{t("common:loading.default")}</div>;
  }

  return (
    <form onSubmit={handleSave} className="max-w-2xl space-y-6 p-6">
      <div>
        <h2 className="text-xl font-semibold text-(--text-primary)">{t("admin:instance.title")}</h2>
        <p className="mt-1 text-sm text-(--text-muted)">{t("admin:instance.subtitle")}</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-(--text-primary)">
          {t("admin:instance.fields.name.label")}
        </label>
        <input
          type="text"
          maxLength={100}
          value={form.instanceName}
          onChange={(e) => setForm({ ...form, instanceName: e.target.value })}
          className="w-full rounded-lg border border-(--border) bg-(--bg-elevated) px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-(--text-muted)">{t("admin:instance.fields.name.help")}</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-(--text-primary)">
          {t("admin:instance.fields.frontendUrl.label")}
        </label>
        <input
          type="url"
          maxLength={500}
          value={form.frontendUrl ?? ""}
          onChange={(e) => setForm({ ...form, frontendUrl: e.target.value })}
          placeholder="https://travstats.example.com"
          className="w-full rounded-lg border border-(--border) bg-(--bg-elevated) px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-(--text-muted)">
          {t("admin:instance.fields.frontendUrl.help")}
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-(--text-primary)">
          {t("admin:instance.fields.publicUrl.label")}
        </label>
        <input
          type="url"
          maxLength={500}
          value={form.publicUrl ?? ""}
          onChange={(e) => setForm({ ...form, publicUrl: e.target.value })}
          placeholder="https://trav.example.de"
          className="w-full rounded-lg border border-(--border) bg-(--bg-elevated) px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-(--text-muted)">
          {t("admin:instance.fields.publicUrl.help")}
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-(--text-primary)">
          {t("admin:instance.fields.lanUrl.label")}
        </label>
        <input
          type="url"
          maxLength={500}
          value={form.lanUrl ?? ""}
          onChange={(e) => setForm({ ...form, lanUrl: e.target.value })}
          placeholder="http://192.168.1.10:3010"
          className="w-full rounded-lg border border-(--border) bg-(--bg-elevated) px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-(--text-muted)">{t("admin:instance.fields.lanUrl.help")}</p>
      </div>

      {/* Passkeys. Separated by a rule because these two fields are not "more
          URLs" — a credential is bound to the rpId forever, so changing it
          later invalidates every passkey already registered. */}
      <div className="border-t border-(--border) pt-6">
        <h3 className="text-base font-semibold text-(--text-primary)">
          {t("admin:instance.passkeys.title")}
        </h3>
        <p className="mt-1 text-sm text-(--text-muted)">{t("admin:instance.passkeys.subtitle")}</p>

        {passkeyStatus && (
          <p
            className="mt-3 text-sm"
            role="status"
            style={{ color: passkeyStatus.usable ? "var(--success)" : "var(--text-muted)" }}
          >
            {passkeyStatus.usable
              ? t("admin:instance.passkeys.statusUsable")
              : t(`admin:instance.passkeys.status.${passkeyStatus.reason ?? "notConfigured"}`)}
          </p>
        )}

        <div className="mt-4">
          <label
            htmlFor="webauthn-rp-id"
            className="mb-1 block text-sm font-medium text-(--text-primary)"
          >
            {t("admin:instance.passkeys.rpId.label")}
          </label>
          <input
            id="webauthn-rp-id"
            type="text"
            maxLength={253}
            value={form.webauthnRpId ?? ""}
            onChange={(e) => setForm({ ...form, webauthnRpId: e.target.value })}
            placeholder="travstats.example.com"
            className="w-full rounded-lg border border-(--border) bg-(--bg-elevated) px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-(--text-muted)">
            {t("admin:instance.passkeys.rpId.help")}
          </p>
        </div>

        <div className="mt-4">
          <label
            htmlFor="webauthn-origins"
            className="mb-1 block text-sm font-medium text-(--text-primary)"
          >
            {t("admin:instance.passkeys.origins.label")}
          </label>
          <textarea
            id="webauthn-origins"
            rows={3}
            value={form.webauthnOrigins}
            onChange={(e) => setForm({ ...form, webauthnOrigins: e.target.value })}
            placeholder={"https://travstats.example.com\nhttps://www.travstats.example.com"}
            className="w-full rounded-lg border border-(--border) bg-(--bg-elevated) px-3 py-2 text-sm font-mono"
          />
          <p className="mt-1 text-xs text-(--text-muted)">
            {t("admin:instance.passkeys.origins.help")}
          </p>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-(--text-primary)">
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
          className="w-40 rounded-lg border border-(--border) bg-(--bg-elevated) px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-(--text-muted)">
          {t("admin:instance.fields.maxUsers.help")}
        </p>
      </div>

      <label className="flex items-start gap-3 text-sm text-(--text-primary)">
        <input
          type="checkbox"
          checked={form.allowRegistration}
          onChange={(e) => setForm({ ...form, allowRegistration: e.target.checked })}
          className="mt-1 h-4 w-4 rounded-sm border-(--border)"
        />
        <span>
          <span className="font-medium">{t("admin:instance.fields.allowRegistration.label")}</span>
          <span className="block text-xs text-(--text-muted)">
            {t("admin:instance.fields.allowRegistration.help")}
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 text-sm text-(--text-primary)">
        <input
          type="checkbox"
          checked={form.betaFeaturesEnabled}
          onChange={(e) => setForm({ ...form, betaFeaturesEnabled: e.target.checked })}
          className="mt-1 h-4 w-4 rounded-sm border-(--border)"
        />
        <span>
          <span className="font-medium">{t("admin:instance.fields.betaFeatures.label")}</span>
          <span className="block text-xs text-(--text-muted)">
            {t("admin:instance.fields.betaFeatures.help")}
          </span>
          {/* Derived from the registry, so it cannot drift from what the
              switch actually gates — see BetaFeatureList.tsx. */}
          <BetaFeatureList />
        </span>
      </label>

      <div className="pt-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base) hover:opacity-90 disabled:opacity-50"
        >
          {saving ? t("common:buttons.saving") : t("common:buttons.save")}
        </button>
      </div>
    </form>
  );
}
