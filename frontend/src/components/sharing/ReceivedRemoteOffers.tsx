import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingRemoteApi } from "../../lib/api/sharingRemote";
import { logger } from "../../lib/logger";
import type { OfferCounts, ReceivedOffer } from "../../types/sharingRemote";
import Button from "../ui/Button";
import LinkExistingPanel from "./LinkExistingPanel";
import { sharingLinkApi } from "../../lib/api/sharingLink";
import { remoteSharingError, type RemoteSharingError } from "./remoteSharingCopy";

const NS = "sharing:remote.offers";
const COUNT_ORDER: readonly (keyof OfferCounts)[] = [
  "flights",
  "lodgingStays",
  "cruises",
  "railJourneys",
  "busJourneys",
  "ferryJourneys",
  "rentals",
  "roadtrips",
  "tours",
  "stops",
];

/**
 * Trips offered from other servers (spec 2026-10-20 §4 `offer-answer`, phase F-S4c): the person
 * decides here, on their own server — accept makes the trip their own, decline copies nothing.
 * Until then nothing of the trip is in the account, and the list says what the trip holds and
 * who is on it, so the answer is an informed one.
 */
interface Props {
  /** Changed by the caller when an offer may have arrived (a redeemed trip-page code). */
  refresh?: number;
  /** The number of offers waiting, after every load (the inbox tab counts them). */
  onCount?: (count: number) => void;
}

export default function ReceivedRemoteOffers({ refresh = 0, onCount }: Props): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const [offers, setOffers] = useState<ReceivedOffer[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RemoteSharingError | null>(null);
  const [accepted, setAccepted] = useState<{
    name: string;
    tripId: string;
    linked?: boolean;
  } | null>(null);
  const [declined, setDeclined] = useState(false);
  // forgejo#440: the offer whose trip the person links with one of their own instead.
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await sharingRemoteApi.listOffers();
      setOffers(list);
      setLoadFailed(false);
      onCount?.(list.length);
    } catch (error) {
      logger.error("Failed to load trips offered from other servers:", error);
      setLoadFailed(true);
    }
  }, [onCount]);

  useEffect(() => {
    void load();
  }, [load, refresh]);

  const answer = async (offer: ReceivedOffer, accept: boolean): Promise<void> => {
    setBusy(true);
    setFailure(null);
    setAccepted(null);
    setDeclined(false);
    try {
      if (accept) {
        const { tripId } = await sharingRemoteApi.acceptOffer(offer.id);
        setAccepted({ name: offer.trip.name, tripId });
      } else {
        await sharingRemoteApi.declineOffer(offer.id);
        setDeclined(true);
      }
      await load();
    } catch (error) {
      logger.error("Answering a trip offer failed:", error);
      setFailure(
        remoteSharingError(
          error,
          accept ? `${NS}.errors.acceptFailed` : `${NS}.errors.declineFailed`
        )
      );
    } finally {
      setBusy(false);
    }
  };

  const counts = (c: OfferCounts): string =>
    COUNT_ORDER.filter((k) => (c[k] ?? 0) > 0)
      .map((k) => t(`${NS}.count.${k}`, { count: c[k] ?? 0 }))
      .join(", ");

  if (!loadFailed && (offers?.length ?? 0) === 0 && !accepted && !declined && !failure) return null;
  return (
    <div className="mb-6">
      <h3 className="t-label-mono mb-2">{t(`${NS}.title`)}</h3>
      {loadFailed && (
        <p role="alert" className="text-sm" style={{ color: "var(--ts-warn)" }}>
          {t(`${NS}.errors.loadFailed`)}
        </p>
      )}
      {offers && offers.length > 0 && (
        <ul className="flex flex-col gap-3 text-sm">
          {offers.map((offer) => (
            <li key={offer.id} className="flex flex-col gap-1">
              <span>
                {t(`${NS}.row`, {
                  trip: offer.trip.name,
                  name: offer.from.displayName,
                  origin: offer.from.origin,
                })}
              </span>
              <span className="t-caption">
                {counts(offer.counts) || t(`${NS}.empty`)}
                {offer.roster.length > 0 &&
                  ` · ${t(`${NS}.roster`, {
                    names: offer.roster.map((r) => `${r.displayName} (${r.origin})`).join(", "),
                  })}`}
              </span>
              <span className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={busy} onClick={() => void answer(offer, true)}>
                  {t(`${NS}.accept`)}
                </Button>
                <Button disabled={busy} onClick={() => void answer(offer, false)}>
                  {t(`${NS}.decline`)}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => setLinkingId(linkingId === offer.id ? null : offer.id)}
                >
                  {t(`${NS}.link`)}
                </Button>
              </span>
              {linkingId === offer.id && (
                <LinkExistingPanel
                  otherName={`${offer.from.displayName} (${offer.from.origin})`}
                  loadCandidates={() => sharingLinkApi.offerCandidates(offer.id)}
                  preview={(tripId) => sharingLinkApi.offerPreview(offer.id, tripId)}
                  link={(tripId, decision) => sharingLinkApi.offerLink(offer.id, tripId, decision)}
                  failure={(err, fallback) => remoteSharingError(err, fallback)}
                  onLinked={(_result, tripId) => {
                    setLinkingId(null);
                    setAccepted({ name: offer.trip.name, tripId, linked: true });
                    void load();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {failure && (
        <p role="alert" className="mt-2 text-sm" style={{ color: "var(--ts-warn)" }}>
          {t(failure.key, { origin: failure.origin })}
        </p>
      )}
      {accepted && (
        <p role="status" className="mt-2 text-sm">
          {t(accepted.linked ? `${NS}.linked` : `${NS}.accepted`, { trip: accepted.name })}{" "}
          <Link to={`/trips/${accepted.tripId}`}>{t(`${NS}.open`)}</Link>
        </p>
      )}
      {declined && (
        <p role="status" className="mt-2 text-sm">
          {t(`${NS}.declined`)}
        </p>
      )}
    </div>
  );
}
