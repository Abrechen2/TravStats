import type { DomainKey } from "../shared/domains";
import type { UserSettings } from "../lib/api/types";

/**
 * The groups `saveRemoteSettings` may write, as the store holds them. Typed
 * loosely on purpose: the patch only compares values, it never reads a field.
 */
export interface SettingsGroups {
  profile: object;
  display: object;
  units: object;
  defaults: object;
  notifications: object;
  features: object;
  cruise: object;
  enabledDomains: DomainKey[];
}

/** A `PUT /settings` body: only what changed, plus the domains it switches off. */
export type SettingsPatch = Partial<UserSettings> & { removedDomains?: DomainKey[] };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The fields whose value differs between `current` and `confirmed` — a key gone from `current`
 * counts too (as `undefined`), so removing a profile field alone still sends the profile.
 */
function changedFields(current: object, confirmed: object): Record<string, unknown> {
  const now = current as Record<string, unknown>;
  const before = confirmed as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(now), ...Object.keys(before)])) {
    if (!same(now[key], before[key])) out[key] = now[key];
  }
  return out;
}

/** Profile fields that live on the user row; the server leaves an omitted one alone. */
const NAME_FIELDS = ["firstName", "lastName"] as const;

/**
 * What a save sends: the CHANGED groups against what the server is known to
 * hold, never the whole store (UAT rc.45, B1).
 *
 * A full snapshot meant that a save fired before the first load — or from a
 * store that had not been hydrated for any other reason — wrote every default
 * over the account: language, theme, date format, names, and the domain list
 * cut down to flights. A patch can only carry what the user actually changed.
 *
 * - `display` and `units` go field by field: the server merges those two blocks
 *   per field (`mergeFixedBlock`).
 * - `profile` goes whole when a blob field changed, because the server replaces
 *   that block; the names ride along only when they changed themselves, since
 *   the server leaves an omitted name alone.
 * - every other group goes whole when anything in it changed: the server
 *   replaces those blocks, and an omitted key is how an entry is removed.
 * - a shrinking domain list names each domain it switches off, which the server
 *   requires before it removes one (defence in depth for the same bug).
 */
export function buildSettingsPatch(
  current: SettingsGroups,
  confirmed: SettingsGroups
): SettingsPatch {
  const patch: Record<string, unknown> = {};
  for (const key of ["display", "units"] as const) {
    const fields = changedFields(current[key], confirmed[key]);
    if (Object.keys(fields).length > 0) patch[key] = fields;
  }
  const profileChanges = changedFields(current.profile, confirmed.profile);
  const nameChanges = NAME_FIELDS.filter((field) => field in profileChanges);
  const blobChanged = Object.keys(profileChanges).some(
    (key) => !(NAME_FIELDS as readonly string[]).includes(key)
  );
  if (blobChanged || nameChanges.length > 0) {
    const profile: Record<string, unknown> = blobChanged ? { ...current.profile } : {};
    for (const field of NAME_FIELDS) {
      if (nameChanges.includes(field)) profile[field] = profileChanges[field];
      else delete profile[field];
    }
    patch.profile = profile;
  }
  for (const key of ["defaults", "notifications", "features", "cruise"] as const) {
    if (!same(current[key], confirmed[key])) patch[key] = current[key];
  }
  if (!same(current.enabledDomains, confirmed.enabledDomains)) {
    patch.enabledDomains = current.enabledDomains;
    const removed = confirmed.enabledDomains.filter((d) => !current.enabledDomains.includes(d));
    if (removed.length > 0) patch.removedDomains = removed;
  }
  return patch as SettingsPatch;
}

/** A save attempted before the settings were ever loaded; nothing was sent. */
export class SettingsNotLoadedError extends Error {
  constructor() {
    super("Settings have not been loaded yet; nothing was saved.");
    this.name = "SettingsNotLoadedError";
  }
}
