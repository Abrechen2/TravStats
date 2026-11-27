import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingLinkApi } from "../../lib/api/sharingLink";
import { logger } from "../../lib/logger";
import type { ReceivedLinkProposal } from "../../types/sharingLink";
import Button from "../ui/Button";
import InlineError from "../ui/InlineError";
import BulkLinkPanel from "./BulkLinkPanel";
import LinkExistingPanel from "./LinkExistingPanel";
import { sharingErrorKey } from "./sharingCopy";

const NS = "sharing:proposals";

/**
 * Trips another account on this server proposed as "you have this one too" (Codex P1,
 * 2026-11-27) — answered here, by the reader, as an offer from another server is: pick the own
 * trip, look at the dry run, decide per field, or decline. The proposer learns only the answer.
 */
export default function ReceivedLinkProposals({
  onCount,
}: {
  onCount?: (count: number) => void;
}): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const [items, setItems] = useState<ReceivedLinkProposal[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await sharingLinkApi.receivedProposals();
      setItems(list);
      setLoadFailed(false);
      onCount?.(list.length);
    } catch (err) {
      logger.error("Failed to load link proposals:", err);
      setLoadFailed(true);
    }
  }, [onCount]);

  useEffect(() => {
    void load();
  }, [load]);

  const decline = async (p: ReceivedLinkProposal): Promise<void> => {
    setError(null);
    try {
      await sharingLinkApi.declineProposal(p.id);
      await load();
    } catch (err) {
      logger.error("Declining a link proposal failed:", err);
      setError(t(sharingErrorKey(err, `${NS}.errors.declineFailed`)));
    }
  };

  if (!loadFailed && (items?.length ?? 0) === 0 && !done) return null;
  return (
    <div className="mb-6" data-testid="link-proposals">
      <h3 className="t-label-mono mb-2">{t(`${NS}.title`)}</h3>
      {loadFailed && <InlineError tone="warning">{t(`${NS}.errors.loadFailed`)}</InlineError>}
      {items && items.length > 1 && (
        <span className="flex mb-2">
          <Button onClick={() => setBulk(!bulk)}>{t("sharing:bulk.open")}</Button>
        </span>
      )}
      {bulk && (
        <BulkLinkPanel
          otherName={t("sharing:bulk.senders")}
          loadPairs={() => sharingLinkApi.proposalBulkPairs()}
          preview={(pair) => sharingLinkApi.proposalPreview(pair.id, pair.trip!.id)}
          link={(pair, decision, choices) =>
            sharingLinkApi.proposalLink(pair.id, pair.trip!.id, decision, choices)
          }
          undo={(pair) => sharingLinkApi.leave(pair.trip!.id)}
          failure={(err, fallback) => ({ key: sharingErrorKey(err, fallback) })}
        />
      )}
      {items && items.length > 0 && (
        <ul className="flex flex-col gap-3 text-sm">
          {items.map((p) => (
            <li key={p.id} className="flex flex-col gap-1">
              <span>{t(`${NS}.row`, { name: p.from.displayName, trip: p.trip.name })}</span>
              <span className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => setOpen(open === p.id ? null : p.id)}>
                  {t(`${NS}.link`)}
                </Button>
                <Button onClick={() => void decline(p)}>{t(`${NS}.decline`)}</Button>
              </span>
              {open === p.id && (
                <LinkExistingPanel
                  otherName={p.from.displayName}
                  loadCandidates={() => sharingLinkApi.proposalCandidates(p.id)}
                  preview={(tripId) => sharingLinkApi.proposalPreview(p.id, tripId)}
                  link={(tripId, decision, choices) =>
                    sharingLinkApi.proposalLink(p.id, tripId, decision, choices)
                  }
                  failure={(err, fallback) => ({ key: sharingErrorKey(err, fallback) })}
                  onLinked={() => {
                    setOpen(null);
                    setDone(p.trip.name);
                    void load();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {done && (
        <p role="status" className="mt-2 text-sm">
          {t(`${NS}.linked`, { trip: done })}
        </p>
      )}
      {error && <InlineError tone="warning">{error}</InlineError>}
    </div>
  );
}
