import { useCallback, useEffect, useRef, useState } from "react";
import { travplanApi, type PlanOperation, type PlanView } from "../../lib/api/travplan";
import { useTranslation } from "../../hooks/useTranslation";
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
        return true;
      } catch (cause) {
        if (mounted.current && request === generation.current) {
          setError(message(cause));
          if ((cause as { response?: { status?: number } }).response?.status === 409) {
            try {
              const fresh = await travplanApi.get(current.tripId);
              if (request === generation.current) {
                planRef.current = fresh;
                setPlan(fresh);
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
    [plan, message]
  );
  return { plan, setPlan, loading, busy, error, setError, refresh, mutate, message };
}
