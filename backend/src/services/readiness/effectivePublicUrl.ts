import { getInstanceSettings } from "../instanceSettingsService";

/**
 * The address the admin sees in Server → Allgemein ("Öffentliche Adresse",
 * which edits `frontendUrl` and says every other address derives from it).
 * The readiness probe, its scheduler and the evaluator must all use this one
 * value; reading the raw `public_url` column instead probed a different
 * address than the one on screen (and answered "no address saved" for an
 * instance whose row was filled). `publicUrl` is only the fallback for
 * instances that never set the row.
 */
export async function getEffectivePublicUrl(): Promise<string | null> {
  const { frontendUrl, publicUrl } = await getInstanceSettings();
  return frontendUrl?.trim() || publicUrl?.trim() || null;
}
