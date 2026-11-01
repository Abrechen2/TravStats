import { settingsApi } from "../../lib/api";
import type { UserSettings } from "../../lib/api/types";
import { SettingWriteError, useSettingWrite, type SettingWrite } from "../ui/settings";
import { useRemoteSettingsStatus } from "../../store/remoteSettingsStatus";

/**
 * One immediate row of the settings document (`PUT /settings`) on the save
 * queue: the row shows the user's CHOICE while a write is open, the store
 * (`apply`) takes the value only once the server confirmed it, and a failed
 * write leaves both the store and every later save of the document on what the
 * server holds. Settings that never loaded are never written over (the
 * guard the document autosave holds, forgejo#372).
 */
export function useDocWrite<T>(
  key: string,
  saved: T,
  payload: (value: T) => Partial<UserSettings>,
  apply: (value: T) => void
): SettingWrite<T> {
  return useSettingWrite<T>(key, saved, async (value, { keepalive }) => {
    if (useRemoteSettingsStatus.getState().failed) throw new SettingWriteError("notLoaded");
    await (keepalive ? settingsApi.updateKeepalive : settingsApi.update)(payload(value));
    apply(value);
  });
}
