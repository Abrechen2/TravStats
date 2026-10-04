/**
 * The `apiSource` a pending flight update carries when the phone observed the
 * value itself (forgejo#194) — the evidence kind `device_gps`. Its own home so
 * the pending-update queue, the apply step and the observation route agree on
 * one spelling.
 */
export const DEVICE_GPS_SOURCE = "device_gps";

/** Every source that is a device's own observation rather than a provider's report. */
export const DEVICE_SOURCES: readonly string[] = [DEVICE_GPS_SOURCE];

export function isDeviceSource(source: string | null | undefined): boolean {
  return source !== null && source !== undefined && DEVICE_SOURCES.includes(source);
}
