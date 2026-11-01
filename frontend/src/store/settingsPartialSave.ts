const generalSavedErrors = new WeakSet<object>();
export function markGeneralSaved(error: unknown): void {
  if (typeof error === "object" && error !== null) generalSavedErrors.add(error);
}
/**
 * True when `saveRemoteSettings` threw although the general settings PUT went
 * through (only the birthdate write was refused). The values it sent ARE saved.
 */
export function generalSettingsWereSaved(error: unknown): boolean {
  return typeof error === "object" && error !== null && generalSavedErrors.has(error);
}
