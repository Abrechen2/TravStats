import { useCallback, useEffect, useState } from "react";
import { usageStatsApi } from "../lib/api";

/**
 * Decides whether the telemetry consent step should appear, and when.
 *
 * Owner decision, 2026-09-20: the instance-wide anonymous-usage consent is a
 * step of its own instead of a card at the bottom of the what's-new dialog.
 * The beta audit of 2026-09-19 found that people dismiss release notes
 * reflexively, which meant the consent question was regularly closed by a
 * click aimed at something else.
 *
 * Three conditions, and each one is load-bearing:
 *
 * 1. **Admin only.** The consent is instance-wide — one answer for the whole
 *    installation — so only an admin may give it. This is the same rule the
 *    card has always had; it did not change, it only moved.
 * 2. **Still unanswered.** `granted` and `denied` are both answers. The admin
 *    area is where either one is changed afterwards.
 * 3. **The what's-new check has SETTLED and is not showing.** Waiting on
 *    `whatsNewChecked` rather than on `!whatsNewOpen` alone is the difference
 *    between "after the what's-new" and "before it has loaded": both flags are
 *    false while that request is in flight, so without the first condition an
 *    instance with release highlights would show this dialog for a moment and
 *    then bury it under them.
 *
 * Every failure path hides the step. A consent question raised by a broken
 * request is worse than one asked next time.
 */
interface UseTelemetryConsentStepParams {
  /** An admin whose session the server has confirmed. */
  isAdminSession: boolean;
  /** `checked` from `useWhatsNew` — its check has settled, either way. */
  whatsNewChecked: boolean;
  /** `shouldShow` from `useWhatsNew` — its dialog is on screen right now. */
  whatsNewOpen: boolean;
}

interface UseTelemetryConsentStepResult {
  shouldShow: boolean;
  /** Closes the step for this session. Persisting the answer is the card's job. */
  close: () => void;
}

export function useTelemetryConsentStep({
  isAdminSession,
  whatsNewChecked,
  whatsNewOpen,
}: UseTelemetryConsentStepParams): UseTelemetryConsentStepResult {
  const [unanswered, setUnanswered] = useState(false);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!isAdminSession) {
      setUnanswered(false);
      return;
    }
    let cancelled = false;
    void usageStatsApi
      .get()
      .then((status) => {
        if (!cancelled) setUnanswered(status.consent === "unset");
      })
      .catch(() => {
        if (!cancelled) setUnanswered(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdminSession]);

  const close = useCallback(() => setClosed(true), []);

  return {
    shouldShow: unanswered && !closed && whatsNewChecked && !whatsNewOpen,
    close,
  };
}
