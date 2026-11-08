import { useState } from "react";
import type { JSX } from "react";
import { Button, Dialog, ListRow, SectionLabel } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { friendsApi, friendsErrorKey } from "../../lib/api/friends";
import type { OwnAdmission } from "../../lib/comparison/types";
import type { FriendRequest } from "../../lib/friends/types";
import { logger } from "../../lib/logger";
import ConnectionSwitchesForm, { theirsSummary } from "../Settings/ConnectionSwitchesForm";
import { DEFAULT_SWITCHES } from "./defaultSwitches";

/** Outgoing requests that are finished well need no line here. */
const SHOWN = new Set<OwnAdmission["status"]>(["pending", "sent", "declined", "failed", "expired"]);
const GAP = { gap: "var(--ts-space-xs)" };

interface Props {
  requests: readonly FriendRequest[];
  admissions: readonly OwnAdmission[];
  onChanged: () => void;
}

/**
 * "Anfragen": people asking to be connected — including those who redeemed the reader's
 * invitation link, who show with their server and fingerprint and are confirmed with one tap
 * (spec 2026-11-08 §11.8; a redeem never activates anything by itself) — and the reader's own
 * invitations waiting on an admin. The reader answers with their own switches, on by default.
 */
export default function RequestsSection({
  requests,
  admissions,
  onChanged,
}: Props): JSX.Element | null {
  const { t, i18n } = useTranslation(["comparison", "common", "sharing"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const [accepting, setAccepting] = useState<FriendRequest | null>(null);
  const [draft, setDraft] = useState(DEFAULT_SWITCHES);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const shown = admissions.filter((a) => SHOWN.has(a.status));
  if (requests.length === 0 && shown.length === 0) return null;

  const run = async (action: () => Promise<unknown>, done?: () => void): Promise<void> => {
    setFailed(null);
    setBusy(true);
    try {
      await action();
      done?.();
      onChanged();
    } catch (failure) {
      logger.error("friends: request answer failed", failure);
      setFailed(tr(friendsErrorKey(failure)));
    } finally {
      setBusy(false);
    }
  };
  /** A reason is shown only when it is a code this build has copy for — never raw server prose. */
  const reasonOf = (a: OwnAdmission): string | null =>
    a.failureReason && i18n.exists(`comparison:error.${a.failureReason}`)
      ? tr(`error.${a.failureReason}`)
      : null;

  return (
    <section
      className="flex flex-col"
      aria-label={tr("requests.title")}
      style={{ gap: "var(--ts-space-md)", marginBottom: "var(--ts-space-xl)" }}
    >
      <SectionLabel>{tr("requests.title")}</SectionLabel>
      {requests.map((r) => (
        <div key={r.key}>
          <ListRow
            title={tr(r.viaLink ? "friend.requests.viaLink" : "friend.requests.asks", {
              name: r.displayName,
            })}
            subtitle={[
              r.origin,
              r.fingerprint
                ? tr("friend.requests.fingerprint", { fingerprint: r.fingerprint })
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            trailing={
              <span className="flex" style={GAP}>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setDraft(DEFAULT_SWITCHES);
                    setAccepting(r);
                  }}
                >
                  {tr("requests.accept")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void run(() => friendsApi.decline(r.key))}
                >
                  {tr("requests.decline")}
                </Button>
              </span>
            }
          />
          <p className="t-caption">
            {theirsSummary(r.switches, (key) => String(t(key)))
              ? tr("friend.requests.offers", {
                  name: r.displayName,
                  what: theirsSummary(r.switches, (key) => String(t(key))),
                })
              : tr("friend.requests.offersNothing", { name: r.displayName })}
          </p>
          {r.viaLink && <p className="t-caption">{tr("friend.requests.declineBurns")}</p>}
        </div>
      ))}
      {shown.map((a) => (
        <ListRow
          key={a.id}
          title={a.origin}
          subtitle={[tr(`friends.admission.${a.status}`, { origin: a.origin }), reasonOf(a)]
            .filter(Boolean)
            .join(" – ")}
        />
      ))}
      {failed && !accepting && <p role="alert">{failed}</p>}
      {accepting && (
        <Dialog
          open
          busy={busy}
          onClose={() => setAccepting(null)}
          title={tr("friend.requests.acceptTitle", { name: accepting.displayName })}
          dismissLabel={tr("common:buttons.cancel")}
          action={
            <Button
              disabled={busy}
              onClick={() =>
                void run(
                  () => friendsApi.accept(accepting.key, draft),
                  () => setAccepting(null)
                )
              }
            >
              {tr("requests.accept")}
            </Button>
          }
        >
          <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
            <p className="t-caption">
              {tr("friend.requests.acceptHint", { name: accepting.displayName })}
            </p>
            <ConnectionSwitchesForm
              idPrefix="friend-accept"
              value={draft}
              onChange={setDraft}
              disabled={busy}
            />
            {failed && <p role="alert">{failed}</p>}
          </div>
        </Dialog>
      )}
    </section>
  );
}
