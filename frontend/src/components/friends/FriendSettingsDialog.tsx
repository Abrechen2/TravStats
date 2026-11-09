import { useState } from "react";
import type { JSX } from "react";
import { Button, Dialog } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { friendsApi, friendsErrorKey } from "../../lib/api/friends";
import { logger } from "../../lib/logger";
import type { Friend } from "../../lib/friends/types";
import ConsentDialog from "../comparison/ConsentDialog";
import ConnectionSwitchesForm, { theirsSummary } from "../Settings/ConnectionSwitchesForm";

interface Props {
  friend: Friend;
  onClose: () => void;
  onChanged: () => void;
}

/**
 * The gear: what the reader gives this friend (the connection's switches, each of them
 * directional), the comparison scope behind the leaderboard switch, and removing the friend.
 * Saving the switches never touches the stored scope — that is the server's rule, and this
 * dialog has no scope field in that call to begin with.
 */
export default function FriendSettingsDialog({ friend, onClose, onChanged }: Props): JSX.Element {
  const { t } = useTranslation(["comparison", "common", "sharing"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const [draft, setDraft] = useState(friend.mine);
  const [scoping, setScoping] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, done: () => void): Promise<void> => {
    setBusy(true);
    setFailed(null);
    try {
      await action();
      onChanged();
      done();
    } catch (failure) {
      logger.error("friends: settings call failed", failure);
      setFailed(tr(friendsErrorKey(failure)));
    } finally {
      setBusy(false);
    }
  };
  const theirs = theirsSummary(friend.theirs, (key) => String(t(key)));
  const name = friend.displayName;

  return (
    <>
      <Dialog
        open={!scoping && !confirming}
        onClose={onClose}
        busy={busy}
        title={tr("friend.settings.title", { name })}
        dismissLabel={tr("common:buttons.cancel")}
        action={
          <Button
            disabled={busy}
            onClick={() => void run(() => friendsApi.setSwitches(friend.key, draft), onClose)}
          >
            {tr("friend.settings.save")}
          </Button>
        }
      >
        <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
          {friend.origin && <p className="t-caption">{friend.origin}</p>}
          <p data-testid="settings-theirs" className="t-caption">
            {theirs
              ? tr("friend.settings.theyShare", { name, what: theirs })
              : tr("friend.settings.theyShareNothing", { name })}
          </p>
          <strong>{tr("friend.settings.iShare", { name })}</strong>
          <ConnectionSwitchesForm
            idPrefix={`friend-${friend.key}`}
            value={draft}
            onChange={setDraft}
            disabled={busy}
          />
          {friend.mine.leaderboard && (
            <div>
              <Button variant="secondary" onClick={() => setScoping(true)}>
                {tr("friend.settings.scope")}
              </Button>
            </div>
          )}
          <div>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              {tr("detail.remove")}
            </Button>
          </div>
          {failed && <p role="alert">{failed}</p>}
        </div>
      </Dialog>
      {scoping && (
        <ConsentDialog
          open
          mode="change"
          person={{ displayName: name, origin: friend.origin }}
          initialScope={friend.scope ?? null}
          onClose={() => setScoping(false)}
          onConfirm={async (scope) => {
            await friendsApi.setScope(friend.key, scope);
            setScoping(false);
            onChanged();
          }}
        />
      )}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={tr("friend.settings.removeTitle", { name })}
        dismissLabel={tr("common:buttons.cancel")}
        action={
          <Button
            variant="danger"
            onClick={() =>
              void run(
                () => friendsApi.remove(friend.key),
                () => {
                  setConfirming(false);
                  onClose();
                }
              )
            }
          >
            {tr("friend.settings.removeConfirm")}
          </Button>
        }
      >
        <p>{tr("friend.settings.removeBody", { name })}</p>
        {failed && <p role="alert">{failed}</p>}
      </Dialog>
    </>
  );
}
