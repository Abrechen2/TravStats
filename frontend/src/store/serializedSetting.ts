import { settingsApi } from "../lib/api";
import { logger } from "../lib/logger";
import i18n from "../i18n/config";
import { useToastStore } from "./toastStore";

/**
 * A switch the user may flip several times before the server answers once
 * (forgejo#316: trip recording on, off, on again). `persistSetting` (./persistSetting.ts) sends
 * every flip at once and rolls each failure back to the value before IT, so
 * two writes could reach the server in the wrong order, and a superseded
 * write failing late put back a value the server no longer held — the switch
 * showed off while the server stored on.
 *
 * Here one switch has at most one write in flight. Flips made meanwhile
 * collapse into the latest, sent when the one in flight settles, so the
 * server hears them in the order they were made. A failure rolls back only
 * when nothing newer is waiting, and then to the value the server last
 * CONFIRMED, not to whatever the control showed before the failed flip.
 */
export function serializedSetting<T>(options: {
  payload: (value: T) => Parameters<typeof settingsApi.update>[0];
  current: () => T;
  apply: (value: T) => void;
  what: string;
  /** After the server confirmed the latest flip, e.g. to have dependent reads ask again. */
  saved?: () => void;
}): (value: T) => void {
  const { payload, current, apply, what, saved } = options;
  let confirmed: T;
  let inFlight = false;
  let queued: { value: T } | null = null;

  const send = (value: T): void => {
    inFlight = true;
    settingsApi
      .update(payload(value))
      .then(
        () => {
          confirmed = value;
          if (!queued) saved?.();
        },
        (error: unknown) => {
          logger.warn(`Failed to save ${what}`, error);
          if (queued) return; // a newer flip is on its way; it decides
          apply(confirmed);
          useToastStore.getState().addToast("error", i18n.t("settings:errors.saveFailed"));
        }
      )
      .finally(() => {
        inFlight = false;
        const next = queued;
        queued = null;
        if (next) send(next.value);
      });
  };

  return (value: T) => {
    if (!inFlight) confirmed = current();
    apply(value);
    if (inFlight) {
      queued = { value };
      return;
    }
    send(value);
  };
}
