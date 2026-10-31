import { externalServicesApi } from "../../lib/api/externalServices";
import type { AdminService } from "../../lib/api/externalServices";

/**
 * The services the first-run "turn on free services" button switches on: free to
 * use, working without any key or account, and not yet on. Cloud AI, anything
 * that needs a key and the account connections (Immich, Dawarich, Strava,
 * WebDAV) are never in it. Decided from the catalogue's own flags, so a service
 * added later is judged by the same rule instead of a second list here.
 */
export function freeKeylessServices(services: readonly AdminService[]): AdminService[] {
  return services.filter((s) => s.keyless && s.recommended === "free" && !s.alwaysOn && !s.enabled);
}

export interface FreeServicesResult {
  enabled: string[];
  failed: { id: string; error: unknown }[];
}

/**
 * Switch the free services on through the admin façade. Needs an admin session
 * (the setup page calls it right after the account exists). One failure does not
 * stop the others; each is reported with its error so the page can say why.
 */
export async function enableFreeServices(): Promise<FreeServicesResult> {
  const overview = await externalServicesApi.adminOverview();
  const targets = freeKeylessServices(overview.categories.flatMap((c) => c.services));
  const result: FreeServicesResult = { enabled: [], failed: [] };
  for (const service of targets) {
    try {
      await externalServicesApi.adminUpdate(service.id, { enabled: true });
      result.enabled.push(service.id);
    } catch (error) {
      result.failed.push({ id: service.id, error });
    }
  }
  return result;
}
