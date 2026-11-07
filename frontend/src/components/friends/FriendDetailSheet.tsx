import { useState } from "react";
import type { JSX } from "react";
import { Button, Dialog } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { comparisonApi, comparisonFailureCode } from "../../lib/api/comparison";
import type { PersonView } from "../../lib/comparison/types";
import ConsentDialog from "../comparison/ConsentDialog";

interface Props {
  friend: PersonView;
  onClose: () => void;
  onChanged: () => void;
}

/**
 * One friend, spelled out (spec 2026-11-07 §6.5.5): what they see of you with a way to change it,
 * what they share with you — as their server last said it — and removing the friend. Removing is
 * local bookkeeping and works while the other server is down.
 */
export default function FriendDetailSheet({ friend, onClose, onChanged }: Props): JSX.Element {
  const { t } = useTranslation(["comparison", "common"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const { person, mine, theirs } = friend;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const iShare =
    mine?.status === "accepted" && mine.scope
      ? mine.scope.groups.map((g) => tr(`group.${g}`)).join(", ")
      : mine?.status === "pending"
        ? tr("people.waiting")
        : tr("people.notSharing");
  const theyShare = !theirs
    ? tr("people.notSharing")
    : theirs.status === "accepted"
      ? tr("people.sharing")
      : theirs.status === "pending"
        ? tr("people.waiting")
        : theirs.status === "withdrawn"
          ? tr("status.withdrawn")
          : theirs.status === "unknown"
            ? tr("people.theirs.unknown")
            : tr("people.notSharing");

  const remove = async (): Promise<void> => {
    setFailed(null);
    setConfirming(false);
    try {
      await comparisonApi.end(person.key);
      onChanged();
      onClose();
    } catch (failure) {
      setFailed(tr(`error.${comparisonFailureCode(failure)}`));
    }
  };

  return (
    <>
      <Dialog
        open={!editing && !confirming}
        onClose={onClose}
        title={tr("detail.title", { name: person.displayName })}
        dismissLabel={tr("detail.close")}
        action={
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {tr("detail.remove")}
          </Button>
        }
      >
        <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
          {person.origin && <p className="t-caption">{person.origin}</p>}
          <div>
            <strong>{tr("detail.iShare", { name: person.displayName })}</strong>
            <p data-testid="detail-i-share">{iShare}</p>
            {mine?.status === "accepted" && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {tr("detail.edit")}
              </Button>
            )}
          </div>
          <div>
            <strong>{tr("detail.theyShare", { name: person.displayName })}</strong>
            <p data-testid="detail-they-share">{theyShare}</p>
          </div>
          {failed && <p role="alert">{failed}</p>}
        </div>
      </Dialog>
      {editing && mine && (
        <ConsentDialog
          open
          mode="change"
          person={person}
          initialScope={mine.scope}
          onClose={() => setEditing(false)}
          onConfirm={async (scope) => {
            await comparisonApi.updateScope(mine.consentId, scope);
            setEditing(false);
            onChanged();
          }}
        />
      )}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={tr("people.endTitle", { name: person.displayName })}
        dismissLabel={tr("common:buttons.cancel")}
        action={
          <Button variant="danger" onClick={() => void remove()}>
            {tr("people.endConfirm")}
          </Button>
        }
      >
        <p>{tr("people.endBody")}</p>
      </Dialog>
    </>
  );
}
