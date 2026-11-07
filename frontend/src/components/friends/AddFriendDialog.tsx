import { useState } from "react";
import type { JSX } from "react";
import { Button, Dialog, Field, Input, SectionLabel } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { comparisonApi, comparisonFailureCode } from "../../lib/api/comparison";
import { decodeInvitePayload, payloadOfPastedLink } from "../../lib/comparison/inviteLink";
import type { InviteRedeemStatus, LeaderboardScope } from "../../lib/comparison/types";
import { logger } from "../../lib/logger";
import ConsentDialog from "../comparison/ConsentDialog";

/** A pre-1.1 code, `https://<host>#<64 hex>`: still redeemable (the server's check is the one that counts). */
const LEGACY_CODE = /^https:\/\/[a-z0-9.-]+#[a-f0-9]{64}$/;

type Pending =
  | { kind: "username"; username: string }
  | { kind: "payload"; payload: string; origin: string }
  | { kind: "code"; code: string; origin: string };

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

/**
 * One dialog for every way to add a friend: a username on this server, a freshly made invitation
 * link to pass on, or a link / code somebody else sent. A link is redeemed on THIS server, so
 * the other side's server is asked only after the reader has seen whose it is and chosen what to
 * share (ConsentDialog). The made link lives in component state only and is never stored.
 */
export default function AddFriendDialog({ open, onClose, onChanged }: Props): JSX.Element {
  const { t } = useTranslation(["comparison", "common"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const [username, setUsername] = useState("");
  const [pasted, setPasted] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const [pending, setPending] = useState<Pending | null>(null);
  const [outcome, setOutcome] = useState<InviteRedeemStatus | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const text = pasted.trim();
  const payload = payloadOfPastedLink(text);
  const decoded = payload ? decodeInvitePayload(payload) : null;
  const legacy = LEGACY_CODE.test(text);
  const damaged = text !== "" && !legacy && !(decoded && decoded.ok);

  const makeLink = async (): Promise<void> => {
    setFailed(null);
    setCopy("idle");
    try {
      setLink((await comparisonApi.createInviteLink()).url);
    } catch (failure) {
      setFailed(tr(`error.${comparisonFailureCode(failure)}`));
    }
  };
  const copyLink = async (): Promise<void> => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopy("done");
    } catch (failure) {
      logger.debug("invite link copy failed", failure);
      setCopy("failed");
    }
  };
  const startRedeem = (): void => {
    if (decoded && decoded.ok && payload)
      setPending({ kind: "payload", payload, origin: decoded.payload.origin });
    else if (legacy) setPending({ kind: "code", code: text, origin: text.split("#")[0] });
  };
  const confirm = async (scope: LeaderboardScope): Promise<void> => {
    if (!pending) return;
    if (pending.kind === "username") await comparisonApi.request(pending.username, scope);
    else if (pending.kind === "code") await comparisonApi.claimInvite(pending.code, scope);
    else setOutcome((await comparisonApi.redeemInviteLink(pending.payload, scope)).status);
    setPending(null);
    setUsername("");
    setPasted("");
    onChanged();
  };

  return (
    <>
      <Dialog
        open={open && !pending}
        onClose={onClose}
        title={tr("add.title")}
        dismissLabel={tr("detail.close")}
      >
        <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
          <Field label={tr("add.username")} htmlFor="friends-username">
            <Input
              id="friends-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <div>
            <Button
              disabled={!username.trim()}
              onClick={() => setPending({ kind: "username", username: username.trim() })}
            >
              {tr("add.ask")}
            </Button>
          </div>

          <SectionLabel>{tr("add.inviteTitle")}</SectionLabel>
          <div>
            <Button variant="secondary" onClick={() => void makeLink()}>
              {tr("friends.makeLink")}
            </Button>
          </div>
          {link && (
            <Field
              label={tr("friends.linkLabel")}
              htmlFor="friends-link"
              hint={tr("friends.linkHint")}
            >
              <div className="flex" style={{ gap: "var(--ts-space-xs)" }}>
                <Input id="friends-link" readOnly value={link} onFocus={(e) => e.target.select()} />
                <Button variant="secondary" onClick={() => void copyLink()}>
                  {tr(copy === "done" ? "add.copied" : "add.copy")}
                </Button>
              </div>
              {copy === "failed" && <p role="status">{tr("add.copyFailed")}</p>}
            </Field>
          )}

          <Field
            label={tr("friends.pasteLabel")}
            htmlFor="friends-paste"
            error={damaged ? tr("friends.linkDamaged") : undefined}
          >
            <Input
              id="friends-paste"
              value={pasted}
              invalid={damaged}
              onChange={(e) => setPasted(e.target.value)}
            />
          </Field>
          <div>
            <Button variant="secondary" disabled={text === "" || damaged} onClick={startRedeem}>
              {tr("friends.redeem")}
            </Button>
          </div>
          {outcome && (
            <p role="status" data-testid="add-outcome">
              {tr(`friends.outcome.${outcome}`)}
            </p>
          )}
          {failed && <p role="alert">{failed}</p>}
        </div>
      </Dialog>
      {pending && (
        <ConsentDialog
          open
          mode="ask"
          person={
            pending.kind === "username"
              ? { displayName: pending.username, origin: null }
              : { displayName: tr("people.remoteFriend"), origin: pending.origin }
          }
          onClose={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </>
  );
}
