import { useEffect, useState } from "react";
import { settingsApi, type InstanceServices } from "../lib/api";
import { logger } from "../lib/logger";

export interface InstanceServicesState {
  /** The switches, or null until they arrive (or when they could not). */
  services: InstanceServices | null;
  /** True when the request failed — the page says so instead of drawing no status. */
  failed: boolean;
}

/**
 * Which keyless services the instance runs for every account (forgejo#321):
 * Transitous, db-rest, OpenRailRouting. Read once per mount; an admin flips
 * them rarely, and the page that shows them is opened, not watched.
 */
export function useInstanceServices(enabled = true): InstanceServicesState {
  const [state, setState] = useState<InstanceServicesState>({ services: null, failed: false });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // Through a resolved promise, so even a synchronous throw lands in the
    // failure branch instead of breaking the page.
    Promise.resolve()
      .then(() => settingsApi.getInstanceServices())
      .then(
        (services) => {
          if (!cancelled) setState({ services, failed: false });
        },
        (error: unknown) => {
          logger.warn("Failed to load the instance services", error);
          if (!cancelled) setState({ services: null, failed: true });
        }
      );
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return state;
}
