const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * A byte count as a person reads it.
 *
 * It lived inside `components/Trips/ImmichAlbumPicker.tsx` and was exported
 * from there, which made every other screen that needs it either import a
 * modal component or write the formula again. The documents section needs the
 * same sentence for a file size and for an upload limit, so the function moved
 * here rather than becoming a second copy that can drift.
 */
export function formatBytes(bytes: number, locale?: string): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  if (exponent === 0) return `${value} B`;
  // With a locale the number follows it — "3,4 MB" on a German page, where
  // the admin log card printed "3.39 MB" (browser acceptance 2026-09-26).
  const number = locale
    ? value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : value.toFixed(1);
  return `${number} ${UNITS[exponent]}`;
}
