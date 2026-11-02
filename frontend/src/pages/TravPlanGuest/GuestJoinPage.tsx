import { useEffect, useState } from "react";
import { Button, PageHeader } from "../../components/ui";
import { useTranslation } from "../../hooks/useTranslation";
import { travplanGuestsApi } from "../../lib/api/travplanGuests";
import { PlanActions, PlanNotice } from "../TravPlan/planLayout";
import { GuestFrame } from "./GuestFrame";
import { guestErrorKey } from "./guestErrors";

/** `#<inviteId>.<secret>`: the fragment never reaches a proxy log or the server. */
export function parseInviteFragment(hash: string): { inviteId: string; secret: string } | null {
  const m = /^#([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,200})$/.exec(hash);
  return m ? { inviteId: m[1], secret: m[2] } : null;
}

/**
 * Step 2 of the join (spec 2026-10-17 §6.5): the invitation link lands here, on the host. One
 * press sends the browser to the guest's own server, which only confirms who they are.
 */
export default function GuestJoinPage() {
  const { t } = useTranslation("travplan");
  const [invite] = useState(() => parseInviteFragment(window.location.hash));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    // The secret has been read; it does not stay in the address bar.
    if (invite) window.history.replaceState(null, "", window.location.pathname);
  }, [invite]);
  async function go() {
    if (!invite) return;
    setBusy(true);
    setError("");
    try {
      const started = await travplanGuestsApi.startJoin(invite.inviteId, invite.secret);
      window.location.assign(started.vouchUrl);
    } catch (cause) {
      setError(t(guestErrorKey(cause), { defaultValue: t("errors.unknown") }));
      setBusy(false);
    }
  }
  return (
    <GuestFrame>
      <PageHeader title={t("guests.join.title")} />
      <p className="t-body">{t("guests.join.intro")}</p>
      <p className="t-caption">{t("guests.join.privacy")}</p>
      {!invite && <PlanNotice tone="bad">{t("guests.join.incomplete")}</PlanNotice>}
      {error && <PlanNotice tone="bad">{error}</PlanNotice>}
      <PlanActions>
        <Button variant="primary" disabled={!invite || busy} onClick={() => void go()}>
          {t("guests.join.confirm")}
        </Button>
      </PlanActions>
    </GuestFrame>
  );
}
