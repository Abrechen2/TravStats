import { useEffect, useRef } from "react";
import { useAuthStore } from "../../store/authStore";
import { useRemoteSettingsStatus } from "../../store/remoteSettingsStatus";
import { generalSettingsWereSaved, useSettingsStore } from "../../store/settingsStore";
import { SettingWriteError, useSettingWrite, type SettingWrite } from "../ui/settings";

/** One counter per setting, so a late failure cannot undo a newer choice. */
const versions = new Map<string, number>();

/**
 * An immediate row whose value lives in the settings DOCUMENT (units, display,
 * defaults …): the row's write queue in front, the store behind it.
 *
 * - Settings that never loaded are not written over the server's (forgejo#372).
 * - A refusal puts back ONLY this setting, and only when it is still the same
 *   account and no newer choice for it was started since — the row itself keeps
 *   the CHOICE, "Verwerfen" brings the last saved value back.
 * - A save that failed only on the separate birthdate write did save this
 *   setting; it is not reported (and not undone) here.
 *
 * `apply` writes one value into the store; it must touch that setting alone.
 */
export function useDocumentSetting<T>(
  key: string,
  saved: T,
  apply: (value: T) => void
): SettingWrite<T> {
  const savedRef = useRef(saved);
  const applyRef = useRef(apply);
  useEffect(() => {
    savedRef.current = saved;
    applyRef.current = apply;
  });
  return useSettingWrite<T>(key, saved, async (value, { keepalive }) => {
    if (useRemoteSettingsStatus.getState().failed) throw new SettingWriteError("notLoaded");
    const previous = savedRef.current;
    const account = useAuthStore.getState().user?.id ?? null;
    const version = (versions.get(key) ?? 0) + 1;
    versions.set(key, version);
    applyRef.current(value);
    try {
      await useSettingsStore.getState().saveRemoteSettings({ keepalive });
    } catch (error) {
      if (generalSettingsWereSaved(error)) return;
      const sameAccount = (useAuthStore.getState().user?.id ?? null) === account;
      if (sameAccount && versions.get(key) === version) applyRef.current(previous);
      throw error;
    }
  });
}
