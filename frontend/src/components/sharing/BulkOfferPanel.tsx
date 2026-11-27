import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingLinkApi } from "../../lib/api/sharingLink";
import { logger } from "../../lib/logger";
import type { BulkOfferCandidate } from "../../types/sharingLink";
import { Button } from "../ui";
import InlineError from "../ui/InlineError";
import { BULK_PACE_MS, wait, withRateLimitPause } from "./bulkRun";
import { remoteSharingError } from "./remoteSharingCopy";

const NS = "sharing:bulk.offer";

type RowState = { kind: "done" } | { kind: "failed"; reason: string };

interface Props {
  remoteId: string;
  name: string;
}

const dayOf = (iso: string | null): string => (iso ? iso.slice(0, 10) : "—");

/**
 * The sending side across servers (UAT 2026-11-27): the trips the person travelled on (a companion
 * on the trip is linked to them) and that are not shared with them yet. Offered in one run, they
 * arrive in the person's inbox, where "Alle passenden Reisen verknüpfen" pairs them with their own
 * trips. The other server's trips are never read from here. Paced; a rate limit pauses the run.
 */
export default function BulkOfferPanel({ remoteId, name }: Props): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  const [trips, setTrips] = useState<BulkOfferCandidate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [pause, setPause] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  useEffect(() => {
    let live = true;
    sharingLinkApi
      .bulkOfferCandidates(remoteId)
      .then((list) => {
        if (!live) return;
        setTrips(list);
        setPicked(new Set(list.filter((c) => !c.offered).map((c) => c.id)));
      })
      .catch((err: unknown) => {
        logger.error("Bulk offer: loading the trips failed:", err);
        if (live) {
          setTrips([]);
          setError(t(remoteSharingError(err, `${NS}.errors.loadFailed`).key));
        }
      });
    return () => {
      live = false;
      stop.current = true;
    };
  }, [remoteId, t]);

  const run = async (): Promise<void> => {
    const list = (trips ?? []).filter((c) => picked.has(c.id) && states[c.id]?.kind !== "done");
    stop.current = false;
    setRunning(true);
    setProgress({ done: 0, total: list.length });
    let n = 0;
    for (const trip of list) {
      if (stop.current) break;
      try {
        const out = await withRateLimitPause(
          () => sharingLinkApi.bulkOffer(trip.id, remoteId),
          setPause,
          () => stop.current
        );
        if (out === "stopped") break;
        setStates((prev) => ({ ...prev, [trip.id]: { kind: "done" } }));
      } catch (err) {
        logger.error("Bulk offer: offering a trip failed:", err);
        const failure = remoteSharingError(err, `${NS}.errors.offerFailed`);
        setStates((prev) => ({
          ...prev,
          [trip.id]: { kind: "failed", reason: t(failure.key, { origin: failure.origin }) },
        }));
      }
      n += 1;
      setProgress({ done: n, total: list.length });
      await wait(BULK_PACE_MS);
    }
    setRunning(false);
  };

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col text-sm" style={{ gap: "var(--ts-space-sm)" }}>
      <p>{t(`${NS}.intro`, { name })}</p>
      {trips === null && <p>{t("sharing:bulk.loading")}</p>}
      {trips?.length === 0 && !error && <p>{t(`${NS}.none`, { name })}</p>}
      {trips && trips.length > 0 && (
        <ul>
          {trips.map((c) => {
            const s = states[c.id];
            return (
              <li key={c.id}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={picked.has(c.id)}
                    disabled={running || s?.kind === "done"}
                    onChange={() => toggle(c.id)}
                  />
                  {c.name} ({dayOf(c.startDay)} – {dayOf(c.endDay)})
                  {c.offered && !s && ` · ${t(`${NS}.waiting`)}`}
                  {s?.kind === "done" && ` · ${t(`${NS}.done`)}`}
                  {s?.kind === "failed" && ` · ${t(`${NS}.failed`, { why: s.reason })}`}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {running && (
        <p role="status" data-testid="bulk-offer-progress">
          {t(`${NS}.progress`, progress)}
          {pause !== null && ` · ${t("sharing:bulk.paused", { minutes: pause })}`}
        </p>
      )}
      {trips && trips.length > 0 && (
        <span className="flex gap-2">
          {!running && (
            <Button variant="primary" disabled={picked.size === 0} onClick={() => void run()}>
              {t(`${NS}.run`, { count: picked.size })}
            </Button>
          )}
          {running && (
            <Button onClick={() => (stop.current = true)}>{t("sharing:bulk.stop")}</Button>
          )}
        </span>
      )}
      {error && <InlineError>{error}</InlineError>}
    </div>
  );
}
