import { useState } from "react";
import { Button, Dialog, Field, Input } from "../../components/ui";
import { useTranslation } from "../../hooks/useTranslation";
import { travplanApi, type PlanCollab, type PlanMember } from "../../lib/api/travplan";
import { apiErrorMachineCode } from "../../lib/apiError";
import { PlanActions, PlanGrow, PlanNotice, PlanRow } from "./planLayout";
import { PlanRemoteInvite } from "./PlanRemoteInvite";

/**
 * Who plans together (spec §6.1, §6.4). The owner invites a person on this server by username, or a connected
 * person on another server, and removes them again; a member sees the roster and can leave. Every refusal is worded from its
 * machine code - the sharing-consent ones say whose answer is missing - and none is swallowed.
 */
export function PlanMembersDialog({
  tripId,
  collab,
  onClose,
  onChanged,
  onLeft,
}: {
  tripId: string;
  collab: PlanCollab;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onLeft: () => void;
}) {
  const { t } = useTranslation("travplan"),
    [username, setUsername] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [info, setInfo] = useState(""),
    owner = collab.self.isOwner;
  const fail = (cause: unknown) => {
    const code = apiErrorMachineCode(cause);
    setError(t("errors." + code, { defaultValue: t("errors.unknown") }));
  };
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await task();
      await onChanged();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  }
  const status = (m: PlanMember) => t("members.status." + m.status);
  return (
    <Dialog open onClose={onClose} busy={busy} title={t("members.title")}>
      <p className="t-caption">{t(owner ? "members.introOwner" : "members.introMember")}</p>
      {collab.members.map((m) => (
        <PlanRow key={m.id}>
          <PlanGrow>
            <strong>{m.displayName}</strong>
            {m.username && <span className="t-caption"> @{m.username}</span>}
            <p className="t-caption">
              {m.kind === "owner" ? t("members.owner") : status(m)}
              {m.kind === "remote" && <> · {t("remote.member")}</>}
              {owner && m.status === "active" && m.kind === "local" && (
                <> · {m.shared ? t("members.shared") : t("members.notShared")}</>
              )}
            </p>
          </PlanGrow>
          {owner && m.kind === "local" && m.status === "active" && !m.shared && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await travplanApi.shareWithMember(tripId, m.id);
                  if (!result.ok)
                    throw Object.assign(new Error(result.code), {
                      response: { data: { code: result.code } },
                    });
                  setInfo(t("members.sharedDone", { name: m.displayName }));
                })
              }
            >
              {t("members.shareNow")}
            </Button>
          )}
          {owner && m.kind !== "owner" && (m.status === "active" || m.status === "invited") && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void run(async () => void (await travplanApi.removeMember(tripId, m.id)))
              }
            >
              {t(m.status === "invited" ? "members.withdraw" : "members.remove")}
            </Button>
          )}
        </PlanRow>
      ))}
      {owner && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!username.trim()) return;
            void run(async () => {
              await travplanApi.invite(tripId, username.trim());
              setUsername("");
              setInfo(t("members.invited"));
            });
          }}
        >
          <Field label={t("members.username")} htmlFor="plan-member-username">
            <Input
              id="plan-member-username"
              value={username}
              maxLength={100}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <p className="t-caption">{t("members.consentNote")}</p>
          <PlanActions>
            <Button variant="primary" type="submit" disabled={busy || !username.trim()}>
              {t("members.invite")}
            </Button>
          </PlanActions>
        </form>
      )}
      {owner && <PlanRemoteInvite tripId={tripId} onChanged={onChanged} />}
      {error && <PlanNotice tone="bad">{error}</PlanNotice>}
      {info && <PlanNotice>{info}</PlanNotice>}
      <PlanActions>
        {!owner && (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              void (async () => {
                setBusy(true);
                try {
                  await travplanApi.leave(tripId);
                  onLeft();
                } catch (cause) {
                  fail(cause);
                  setBusy(false);
                }
              })()
            }
          >
            {t("members.leave")}
          </Button>
        )}
        <Button onClick={onClose} disabled={busy}>
          {t("members.close")}
        </Button>
      </PlanActions>
    </Dialog>
  );
}
