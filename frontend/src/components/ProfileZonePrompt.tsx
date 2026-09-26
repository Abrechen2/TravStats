import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import Modal from "./Modal";
import { useTranslation } from "../hooks/useTranslation";
import { useIsDemoAccount } from "../hooks/useIsDemoAccount";
import { settingsApi } from "../lib/api";
import { groupTimeZones } from "../lib/timezones";
import { saveErrorMessage } from "../lib/saveErrorMessage";
import { deviceZone } from "../shared/time";
import { useAuthStore } from "../store/authStore";
import { useProfileZoneStore } from "../store/profileZoneStore";
import { useSettingsStore } from "../store/settingsStore";

/**
 * Asks a user without a profile zone for one — once, at login (owner
 * decision 2026-09-26, ADR 0002 Q1).
 *
 * The profile zone answers "today", "planned or past" and countdowns, on the
 * server and in every client alike. An account that never set one gets UTC
 * for those questions; this dialog proposes the device's zone, the user
 * confirms it (or picks another), and it is written to the server. "Later"
 * puts the question off for this browser session only, and while it is open
 * a small note says that "today" is still counted in UTC.
 *
 * The shared demo account is never asked: one visitor's answer would become
 * every visitor's zone.
 */
export const PROFILE_ZONE_DEFER_KEY_PREFIX = "travstats.profileZonePrompt.deferred.";

function readDeferred(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeDeferred(key: string): void {
  try {
    window.sessionStorage.setItem(key, "1");
  } catch {
    // Storage refused (private mode, blocked site data): the dialog still
    // closes for this page's life, it only asks again after a reload.
  }
}

interface ProfileZonePromptProps {
  sessionConfirmed: boolean;
  /** Other first-login dialogs go first; this one waits until they are done. */
  otherDialogOpen: boolean;
}

export default function ProfileZonePrompt({
  sessionConfirmed,
  otherDialogOpen,
}: ProfileZonePromptProps): JSX.Element | null {
  const { t } = useTranslation(["settings", "common"]);
  const status = useProfileZoneStore((s) => s.status);
  const isSharedDemo = useIsDemoAccount();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const deferKey = `${PROFILE_ZONE_DEFER_KEY_PREFIX}${userId ?? ""}`;
  const [deferred, setDeferred] = useState(() => readDeferred(deferKey));
  const [zone, setZone] = useState<string>(() => deviceZone() ?? "UTC");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zoneGroups = useMemo(() => groupTimeZones(zone), [zone]);

  useEffect(() => setDeferred(readDeferred(deferKey)), [deferKey]);

  const asks = sessionConfirmed && status === "missing" && !isSharedDemo && userId !== null;
  if (!asks) return null;

  const later = (): void => {
    writeDeferred(deferKey);
    setDeferred(true);
  };

  const confirm = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const { display } = useSettingsStore.getState();
      // The whole display group: the server replaces a group, it does not merge it.
      await settingsApi.update({ display: { ...display, timezone: zone } });
      // Marks the zone confirmed (profileZoneStore) and closes the dialog.
      useSettingsStore.getState().setDisplay({ timezone: zone });
    } catch (err: unknown) {
      setError(saveErrorMessage(err, t, "settings:profileZone.saveError"));
    } finally {
      setSaving(false);
    }
  };

  if (deferred || otherDialogOpen) {
    return deferred ? (
      <div
        role="status"
        className="fixed bottom-4 left-4 z-40 max-w-sm rounded-lg p-3 text-sm shadow-lg"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--color-border)",
          color: "var(--text-primary)",
        }}
      >
        <p style={{ margin: 0 }}>{t("settings:profileZone.utcHint")}</p>
        <button
          type="button"
          className="mt-2 text-sm underline"
          style={{ color: "var(--accent)" }}
          onClick={() => setDeferred(false)}
        >
          {t("settings:profileZone.setNow")}
        </button>
      </div>
    ) : null;
  }

  return (
    <Modal
      open
      onClose={later}
      busy={saving}
      maxWidth={480}
      title={t("settings:profileZone.title")}
      closeLabel={t("common:buttons.close")}
      footer={
        <>
          <button type="button" className="btn-secondary px-4 py-2" onClick={later}>
            {t("settings:profileZone.later")}
          </button>
          <button
            type="button"
            className="btn-primary px-4 py-2"
            onClick={() => void confirm()}
            disabled={saving}
          >
            {t("settings:profileZone.confirm")}
          </button>
        </>
      }
    >
      <p style={{ margin: "0 0 var(--ts-space-md)" }}>{t("settings:profileZone.body")}</p>
      <label className="flex flex-col gap-1" htmlFor="profile-zone-select">
        <span className="t-caption">{t("settings:profileZone.proposal")}</span>
        <select
          id="profile-zone-select"
          className="input"
          value={zone}
          onChange={(e) => setZone(e.target.value)}
        >
          {zoneGroups.map((group) => (
            <optgroup key={group.region} label={group.region}>
              {group.zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="mt-3 text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </Modal>
  );
}
