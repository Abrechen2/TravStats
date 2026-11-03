import { useCallback, useEffect, useRef, useState } from "react";
import { travplanApi, type PlanOperation, type PlanView } from "../../lib/api/travplan";
import { useTranslation } from "../../hooks/useTranslation";
/** How often a visible plan page looks for other members' changes. */
export const POLL_MS = 30_000;
export function usePlan(tripId: string | undefined) {
  const [plan, setPlan] = useState<PlanView | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const planRef = useRef(plan);
  planRef.current = plan;
  const mounted = useRef(true),
    pending = useRef(false),
    generation = useRef(0);
  const { t } = useTranslation("travplan");
  const message = useCallback(
    (cause: unknown) => {
      const code = (cause as { response?: { data?: { error?: { code?: string }; code?: string } } })
        ?.response?.data;
      const key = typeof code?.error?.code === "string" ? code.error.code : code?.code || "unknown";
      return t("errors." + key, { defaultValue: t("errors.unknown") });
    },
    [t]
  );
  const gone = useRef(false);
  const refresh = useCallback(async () => {
    if (!tripId) {
      setLoading(false);
      return;
    }
    const request = ++generation.current;
    setLoading(true);
    try {
      const next = await travplanApi.get(tripId);
      if (mounted.current && request === generation.current) {
        planRef.current = next;
        setPlan(next);
        setError("");
      }
    } catch (cause) {
      if (mounted.current && request === generation.current) setError(message(cause));
    } finally {
      if (mounted.current && request === generation.current) setLoading(false);
    }
  }, [tripId, message]);
  useEffect(() => {
    mounted.current = true;
    setPlan(null);
    void refresh();
    return () => {
      mounted.current = false;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- generation is a counter; the cleanup must bump its current value
      generation.current++;
    };
  }, [refresh]);
  const mutate = useCallback(
    async (operation: PlanOperation) => {
      const current = planRef.current,
        request = generation.current;
      if (!current || pending.current) return false;
      pending.current = true;
      setBusy(true);
      setError("");
      try {
        const next = await travplanApi.write(current, operation);
        if (mounted.current && request === generation.current) {
          planRef.current = next;
          setPlan(next);
        }
        return mounted.current && request === generation.current;
      } catch (cause) {
        if (mounted.current && request === generation.current) {
          setError(message(cause));
          if ((cause as { response?: { status?: number } }).response?.status === 409) {
            try {
              const fresh = await travplanApi.get(current.tripId);
              if (request === generation.current) {
                planRef.current = fresh;
                setPlan(fresh);
                // Somebody else changed the plan meanwhile: say who. The form keeps the edit.
                const by = fresh.lastMutation?.actor;
                if (by && by.memberId !== current.self?.memberId)
                  setError(t("conflictBy", { name: by.displayName }));
              }
            } catch {
              /* Keep the last readable state. */
            }
          }
        }
        return false;
      } finally {
        pending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [message, t]
  );
  // Other members write to the same plan: look again on focus and every 30 s while visible
  // (ETag = revision, 304 when unchanged). Never while a write of our own is in flight.
  useEffect(() => {
    if (!tripId) return;
    gone.current = false;
    const tick = async () => {
      const held = planRef.current,
        request = generation.current;
      if (!held || gone.current || pending.current || document.visibilityState !== "visible")
        return;
      try {
        const next = await travplanApi.poll(held);
        if (
          next &&
          mounted.current &&
          request === generation.current &&
          !pending.current &&
          planRef.current === held
        ) {
          planRef.current = next;
          setPlan(next);
        }
      } catch (cause) {
        const status = (cause as { response?: { status?: number } }).response?.status;
        // Deleted, removed or consent withdrawn: say so once and stop asking. A network blip
        // keeps the last readable plan and tries again at the next tick.
        if (status === 404 || status === 403) {
          gone.current = true;
          if (mounted.current && request === generation.current) setError(message(cause));
        }
      }
    };
    const timer = window.setInterval(() => void tick(), POLL_MS);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [tripId, message]);
  return { plan, setPlan, loading, busy, error, setError, refresh, mutate, message };
}
