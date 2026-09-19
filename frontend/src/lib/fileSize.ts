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
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  return exponent === 0 ? `${value} B` : `${value.toFixed(1)} ${UNITS[exponent]}`;
}
