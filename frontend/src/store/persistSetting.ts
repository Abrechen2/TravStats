import { settingsApi } from "../lib/api";
import { logger } from "../lib/logger";
import i18n from "../i18n/config";
import { useToastStore } from "./toastStore";

/**
 * Writes a setting the user just flipped, and PUTS THE SWITCH BACK if the
 * write fails.
 *
 * The four settings that persist immediately (domains, base currency, trip
 * auto-creation, country threshold) used to fire and forget —
 * `setEnabledDomains` did not even carry a `.catch`, so its failure was an
 * unhandled rejection. On a weak connection that produced a control that
 * lies: the switch stayed visibly on, the server never heard, and the next
 * page load put it back with no explanation. Reported from the field on
 * 2026-09-28 ("kann sie nicht aktivieren"), where the connection was the
 * suspect and the silence was the defect.
 *
 * Rolling back is the honest half: the control then shows what the server
 * actually holds. The toast is the other half — a switch that springs back on
 * its own is a bug report waiting to happen unless it says why.
 *
 * `i18n.t` outside a component follows `ErrorBoundary.tsx`, which does the
 * same for the same reason: there is no hook to call here.
 */
export function persistSetting(
  payload: Parameters<typeof settingsApi.update>[0],
  rollback: () => void,
  what: string
): void {
  settingsApi.update(payload).catch((error: unknown) => {
    rollback();
    logger.warn(`Failed to save ${what}`, error);
    useToastStore.getState().addToast("error", i18n.t("settings:errors.saveFailed"));
  });
}
