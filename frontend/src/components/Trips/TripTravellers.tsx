import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import { sharingRemoteApi } from "../../lib/api/sharingRemote";
import { logger } from "../../lib/logger";
import { useTripSharingStore } from "../../store/tripSharingStore";
import { initials } from "../ui/PeopleList";

/** Visible before the rest folds into "+N". */
const VISIBLE = 6;
/** A person on another server who is, or is about to be, on the trip. */
const SHOWN_STATES = new Set(["active", "unreachable", "invited"]);

interface Traveller {
  key: string;
  name: string;
  /** Where somebody on another server lives; absent for companions. */
  origin?: string;
}

/**
 * The people on the trip on other servers, for the head. Loaded only behind
 * the federation beta key and never for the shared demo account — the same
 * conditions as the sharing dialog. A failed load leaves the list to the
 * companions (it is logged; the dialog says it out loud).
 */
function useRemoteTravellers(tripId: string): Traveller[] {
  const { isFeatureVisible } = useBetaFeatures();
  const visible = isFeatureVisible("federatedTripSharing");
  const isSharedDemo = useIsDemoAccount();
  const revision = useTripSharingStore((s) => s.revision[tripId] ?? 0);
  const [loaded, setLoaded] = useState<{ tripId: string; people: Traveller[] } | null>(null);

  useEffect(() => {
    if (!visible || isSharedDemo) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await sharingRemoteApi.status();
        const view = status.available ? await sharingRemoteApi.tripSharing(tripId) : null;
        if (cancelled) return;
        setLoaded({
          tripId,
          people: (view?.members ?? [])
            .filter((m) => SHOWN_STATES.has(m.state))
            .map((m) => ({ key: `r:${m.id}`, name: m.displayName, origin: m.origin })),
        });
      } catch (error) {
        logger.error("Failed to load the trip's people on other servers:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, visible, isSharedDemo, revision]);

  return visible && !isSharedDemo && loaded?.tripId === tripId ? loaded.people : [];
}

/**
 * The trip's travellers as a compact row under the country flags: an initials
 * mark and the name, companions first, then people on other servers, with
 * "+N" for the rest (a click unfolds them). Sharing and linking an account
 * live in the "Teilen" dialog, not here.
 */
export default function TripTravellers({
  tripId,
  companions,
}: {
  tripId: string;
  /** A trip loaded from an older payload may lack the list. */
  companions?: readonly string[];
}): JSX.Element | null {
  const { t } = useTranslation(["trips"]);
  const remote = useRemoteTravellers(tripId);
  const [expanded, setExpanded] = useState(false);
  const all: Traveller[] = [
    ...(companions ?? []).map((name, index) => ({ key: `c:${index}:${name}`, name })),
    ...remote,
  ];
  if (all.length === 0) return null;
  const shown = expanded ? all : all.slice(0, VISIBLE);
  const rest = all.length - shown.length;

  return (
    <ul
      aria-label={t("trips:head.travellers")}
      data-testid="trip-head-travellers"
      className="flex flex-wrap items-center"
      style={{ gap: 6 }}
    >
      {shown.map((p) => (
        <li
          key={p.key}
          className="inline-flex items-center rounded-full"
          style={{
            gap: 8,
            padding: "3px 12px 3px 4px",
            border: "1px solid var(--ts-border)",
            fontSize: 13,
            color: "var(--ts-text-bright)",
          }}
        >
          <span
            aria-hidden="true"
            className="flex shrink-0 items-center justify-center"
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              background: "var(--ts-surface2)",
              fontFamily: "var(--ts-font-mono)",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            {initials(p.name)}
          </span>
          {p.name}
          {p.origin && (
            <span className="t-caption" style={{ marginLeft: -2 }}>
              @{p.origin.replace(/^https?:\/\//, "")}
            </span>
          )}
        </li>
      ))}
      {rest > 0 && (
        <li>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label={t("trips:head.travellersMore", { count: rest })}
            className="rounded-full"
            style={{
              padding: "4px 10px",
              fontSize: 13,
              color: "var(--ts-muted)",
              border: "1px solid var(--ts-border)",
            }}
          >
            +{rest}
          </button>
        </li>
      )}
    </ul>
  );
}
