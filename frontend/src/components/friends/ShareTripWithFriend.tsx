import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Button, Dialog, Field, Select } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { friendsErrorKey } from "../../lib/api/friends";
import { sharingApi } from "../../lib/api/sharing";
import { sharingRemoteApi } from "../../lib/api/sharingRemote";
import { tripsApi } from "../../lib/api/trips";
import { logger } from "../../lib/logger";
import type { Trip } from "../../types";
import type { TripSharing } from "../../types/sharing";
import type { Friend } from "../../lib/friends/types";
import ShareTripDialog from "../sharing/ShareTripDialog";

interface Props {
  friend: Friend;
  onClose: () => void;
  onShared: () => void;
}

/**
 * "Reise teilen" for one friend: choose the trip, then the existing share flow takes over with
 * this friend preselected. A friend on this server goes through `ShareTripDialog` (the copy is
 * confirmed there); a friend on another server gets an offer by connection id.
 */
export default function ShareTripWithFriend({ friend, onClose, onShared }: Props): JSX.Element {
  const { t } = useTranslation(["comparison", "common"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [tripId, setTripId] = useState("");
  const [sharing, setSharing] = useState<{ tripId: string; view: TripSharing } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    tripsApi.getAll().then(
      (all) => alive && setTrips(all),
      (failure: unknown) => {
        logger.error("friends: trips load failed", failure);
        if (alive) setFailed(tr("friend.trips.pickFailed"));
      }
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tr is stable per render, load once
  }, []);

  const proceed = async (): Promise<void> => {
    if (!tripId) return;
    setBusy(true);
    setFailed(null);
    try {
      if (friend.kind === "remote") {
        // The key can be the leaderboard pairing's id; offers take the connection's.
        if (!friend.connectionId) {
          setFailed(tr("friend.olderServer", { name: friend.displayName }));
          return;
        }
        await sharingRemoteApi.offerTrip(tripId, { remoteId: friend.connectionId });
        onShared();
        onClose();
      } else {
        const view = await sharingApi.tripSharing(tripId);
        // Never fall back to someone else: without this friend among the travellers the
        // share dialog would offer whoever is first eligible.
        if (!view.people.some((p) => p.account?.username === friend.username))
          setFailed(tr("friend.trips.notTraveller", { name: friend.displayName }));
        else setSharing({ tripId, view });
      }
    } catch (failure) {
      logger.error("friends: share trip failed", failure);
      setFailed(tr(friendsErrorKey(failure)));
    } finally {
      setBusy(false);
    }
  };

  if (sharing) {
    const person = sharing.view.people.find((p) => p.account?.username === friend.username);
    return (
      <ShareTripDialog
        open
        onClose={onClose}
        tripId={sharing.tripId}
        people={sharing.view.people}
        linkableUsers={sharing.view.linkableUsers}
        preselectedKey={person?.key}
        onShared={() => {
          onShared();
          onClose();
        }}
      />
    );
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={tr("friend.trips.shareTitle", { name: friend.displayName })}
      dismissLabel={tr("common:buttons.cancel")}
      busy={busy}
      action={
        <Button disabled={!tripId || busy} onClick={() => void proceed()}>
          {tr("friend.trips.next")}
        </Button>
      }
    >
      <Field label={tr("friend.trips.pick")} htmlFor="friend-share-trip">
        <Select id="friend-share-trip" value={tripId} onChange={(e) => setTripId(e.target.value)}>
          <option value="">{tr("friend.trips.pickPlaceholder")}</option>
          {(trips ?? []).map((trip) => (
            <option key={trip.id} value={trip.id}>
              {trip.name}
            </option>
          ))}
        </Select>
      </Field>
      {failed && <p role="alert">{failed}</p>}
    </Dialog>
  );
}
