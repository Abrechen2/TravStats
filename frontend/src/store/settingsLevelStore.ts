import { create } from "zustand";
import { serializedSetting } from "./serializedSetting";

export const SETTINGS_LEVELS = ["standard", "expert"] as const;
export type SettingsLevel = (typeof SETTINGS_LEVELS)[number];

/** A value off the wire read back as a level, or null when it is not one. */
export function asSettingsLevel(value: unknown): SettingsLevel | null {
  return typeof value === "string" && (SETTINGS_LEVELS as readonly string[]).includes(value)
    ? (value as SettingsLevel)
    : null;
}

/**
 * The account's settings level (forgejo#321): "standard" shows what a person
 * needs to set TravStats up and use it, "expert" adds tuning, plumbing and
 * operations.
 *
 * Its own store, like `suggestionSwitchesStore`, because `settingsStore` sits
 * at the 800-line limit; `loadRemoteSettings` hands it the same response.
 *
 * `null` until the server has answered. While it is unknown readers use the
 * neutral standard view and the switch is disabled: an unknown level is not an
 * Expert account (new accounts are standard on the server, existing ones were
 * migrated to expert), so the server's answer is the only one that counts and
 * nothing is saved, switched or searched against a guess (settings redesign,
 * package 3). A named expert section or row still opens by link.
 */
interface SettingsLevelState {
  level: SettingsLevel | null;
  noteRemote: (remote: unknown) => void;
  setLevel: (level: SettingsLevel) => void;
}

export const useSettingsLevelStore = create<SettingsLevelState>((set, get) => ({
  level: null,
  noteRemote: (remote) => {
    const level = asSettingsLevel((remote as { settingsLevel?: unknown } | null)?.settingsLevel);
    if (level) set({ level });
  },
  // Serialized like the other immediate switches: a superseded write failing
  // late must not put back a level the server no longer holds.
  setLevel: serializedSetting<SettingsLevel>({
    payload: (level) => ({ settingsLevel: level }),
    current: () => get().level ?? "expert",
    apply: (level) => set({ level }),
    what: "settings level",
  }),
}));

/** The level in force: an unknown level reads as the neutral standard view (see the store). */
export function useEffectiveSettingsLevel(): SettingsLevel {
  return useSettingsLevelStore((s) => s.level) ?? "standard";
}

/** Whether the server has told us the account's level yet. */
export function useSettingsLevelKnown(): boolean {
  return useSettingsLevelStore((s) => s.level) !== null;
}
