import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Button, Dialog, Field, Select } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { friendsErrorKey } from "../../lib/api/friends";
import { travplanApi } from "../../lib/api/travplan";
import type { PlanSummary } from "../../types/travplan";
import { logger } from "../../lib/logger";
import type { Friend } from "../../lib/friends/types";

interface Props {
  friend: Friend;
  onClose: () => void;
  onInvited: () => void;
}

/** "Zu Plan einladen": pick one of the reader's plans; the invitation goes to this friend only. */
export default function InviteToPlan({ friend, onClose, onInvited }: Props): JSX.Element {
  const { t } = useTranslation(["comparison", "common"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [tripId, setTripId] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    travplanApi.list().then(
      (all) => alive && setPlans(all),
      (failure: unknown) => {
        logger.error("friends: plans load failed", failure);
        if (alive) setFailed(tr("friend.plans.pickFailed"));
      }
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  }, []);

  const invite = async (): Promise<void> => {
    setBusy(true);
    setFailed(null);
    try {
      if (friend.kind === "remote") {
        // The key can be the leaderboard pairing's id; the invitation takes the connection's.
        if (!friend.connectionId) {
          setFailed(tr("friend.olderServer", { name: friend.displayName }));
          return;
        }
        await travplanApi.inviteConnection(tripId, friend.connectionId);
      } else await travplanApi.invite(tripId, friend.username);
      onInvited();
      onClose();
    } catch (failure) {
      logger.error("friends: plan invitation failed", failure);
      setFailed(tr(friendsErrorKey(failure)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={tr("friend.plans.inviteTitle", { name: friend.displayName })}
      dismissLabel={tr("common:buttons.cancel")}
      action={
        <Button disabled={!tripId || busy} onClick={() => void invite()}>
          {tr("friend.plans.inviteConfirm")}
        </Button>
      }
    >
      <Field label={tr("friend.plans.pick")} htmlFor="friend-invite-plan">
        <Select id="friend-invite-plan" value={tripId} onChange={(e) => setTripId(e.target.value)}>
          <option value="">{tr("friend.plans.pickPlaceholder")}</option>
          {(plans ?? []).map((p) => (
            <option key={p.id} value={p.tripId}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      {failed && <p role="alert">{failed}</p>}
    </Dialog>
  );
}
