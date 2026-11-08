import type { JSX } from "react";
import { Link } from "react-router-dom";
import { Button, ListRow, SectionLabel } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import type { Friend, FriendTrips, SharedTrip } from "../../lib/friends/types";
import type { Loaded } from "./loadState";

interface Props {
  friend: Friend;
  trips: Loaded<FriendTrips>;
  onShare: () => void;
  onRetry: () => void;
}

/**
 * Geteilte Reisen, both directions. A trip is shared whole, as a linked copy in the other
 * account. "Reise teilen" follows the friend's switch: they decide whether they take offers.
 */
export default function SharedTrips({ friend, trips, onShare, onRetry }: Props): JSX.Element {
  const { t } = useTranslation(["comparison"]);
  const coarse = useCoarsePointer();
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const name = friend.displayName;

  const rows = (list: readonly SharedTrip[], direction: "toThem" | "fromThem"): JSX.Element => (
    <div data-testid={`trips-${direction}`}>
      <SectionLabel>
        {direction === "toThem"
          ? tr("friend.trips.toThem", { name })
          : tr("friend.trips.fromThem", { name })}
      </SectionLabel>
      {list.length === 0 ? (
        <p className="t-caption">{tr("friend.trips.none")}</p>
      ) : (
        list.map((trip) => (
          <ListRow
            key={trip.id}
            title={
              trip.localTripId ? (
                <Link to={`/trips/${trip.localTripId}`}>{trip.title}</Link>
              ) : (
                trip.title
              )
            }
            subtitle={tr(`friend.trips.state.${trip.copyState}`)}
          />
        ))
      )}
    </div>
  );

  return (
    <section
      className="flex flex-col"
      aria-label={tr("friend.trips.title")}
      style={{ gap: "var(--ts-space-md)" }}
    >
      <h3 className="t-screen-title">{tr("friend.trips.title")}</h3>
      {trips.status === "loading" && <p className="t-caption">{tr("friend.loading")}</p>}
      {trips.status === "error" && (
        <p role="alert">
          {tr("friend.trips.loadFailed")}{" "}
          <Button variant="secondary" onClick={onRetry}>
            {tr("friend.retry")}
          </Button>
        </p>
      )}
      {trips.status === "ok" && (
        <div
          className={coarse ? "flex flex-col" : "grid"}
          style={{ gap: "var(--ts-space-lg)", gridTemplateColumns: coarse ? undefined : "1fr 1fr" }}
        >
          {rows(trips.value.toThem, "toThem")}
          {rows(trips.value.fromThem, "fromThem")}
        </div>
      )}
      <div>
        {friend.theirs.tripOffers ? (
          <Button variant="secondary" onClick={onShare}>
            {tr("friend.trips.share")}
          </Button>
        ) : (
          <p className="t-caption" data-testid="trips-off">
            {tr("friend.trips.offersOff", { name })}
          </p>
        )}
      </div>
    </section>
  );
}
