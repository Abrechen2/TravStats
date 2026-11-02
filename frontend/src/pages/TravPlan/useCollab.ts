import { useCallback, useEffect, useRef, useState } from "react";
import { travplanApi, type PlanCollab } from "../../lib/api/travplan";

/**
 * Who is on the plan and what the others changed since the caller last looked. Read again
 * whenever the plan's revision moves (the plan poll already notices other members' writes), so
 * it adds no timer of its own. A failure keeps the last roster and is reported once through
 * `onError`: a roster that silently stops updating would show a removed member as present.
 */
export function useCollab(tripId: string, revision: number, onError: (e: unknown) => void) {
  const [collab, setCollab] = useState<PlanCollab | null>(null);
  const live = useRef(true);
  const failed = useRef(false);
  const reload = useCallback(async () => {
    try {
      const next = await travplanApi.collab(tripId);
      if (live.current) {
        failed.current = false;
        setCollab(next);
      }
    } catch (cause) {
      if (live.current && !failed.current) {
        failed.current = true;
        onError(cause);
      }
    }
  }, [tripId, onError]);
  useEffect(() => {
    live.current = true;
    void reload();
    return () => {
      live.current = false;
    };
  }, [reload, revision]);
  const markRead = useCallback(async () => {
    try {
      await travplanApi.readNotices(tripId);
      if (live.current) setCollab((c) => (c ? { ...c, notices: [] } : c));
    } catch (cause) {
      onError(cause);
    }
  }, [tripId, onError]);
  return { collab, reload, markRead };
}
