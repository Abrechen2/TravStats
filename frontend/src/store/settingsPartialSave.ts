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

const birthdateSavedErrors = new WeakSet<object>();
export function markBirthdateSaved(error: unknown): void {
  if (typeof error === "object" && error !== null) birthdateSavedErrors.add(error);
}
/** True when the general settings PUT was refused but the separate birthdate PUT went through. */
export function birthdateWasSaved(error: unknown): boolean {
  return typeof error === "object" && error !== null && birthdateSavedErrors.has(error);
}
