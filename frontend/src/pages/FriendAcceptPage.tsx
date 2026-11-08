import { useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { AppShell, Button, Card, EmptyState, PageHeader } from "../components/ui";
import SwitchesAskDialog from "../components/friends/SwitchesAskDialog";
import { useTranslation } from "../hooks/useTranslation";
import { useBetaFeatureAccess } from "../hooks/useBetaFeatures";
import { useAuthStore } from "../store/authStore";
import { comparisonApi, comparisonFailureCode } from "../lib/api/comparison";
import { decodeInvitePayload } from "../lib/comparison/inviteLink";
import type { InviteRedeemStatus } from "../lib/comparison/types";

/** `ab12cd34…` as `ab12 cd34 …`: a fingerprint is read aloud and compared by eye. */
const grouped = (hex: string): string => hex.replace(/(.{4})(?=.)/g, "$1 ");

/**
 * /freunde/annehmen (spec 2026-11-07 §6.3): the friend's side of an invitation link, on the
 * reader's OWN server. The payload comes from the URL fragment, which no server ever sees; it is
 * parsed here, shown (whose server, which fingerprint), and sent only when the reader presses the
 * button and has chosen what to share — never on load or prefetch. Afterwards the fragment is
 * dropped from the address bar, so the single-use token does not sit in history.
 */
export default function FriendAcceptPage(): JSX.Element {
  const { t } = useTranslation(["comparison", "common", "auth"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const user = useAuthStore((s) => s.user);
  const access = useBetaFeatureAccess("comparison");
  // Read once: the fragment is cleared after redeeming, and a re-render must not forget it first.
  const [raw] = useState(() => window.location.hash.replace(/^#/, ""));
  const [asking, setAsking] = useState(false);
  const [outcome, setOutcome] = useState<InviteRedeemStatus | null>(null);
  const decoded = decodeInvitePayload(raw);

  const redeem = async (
    switches: Parameters<typeof comparisonApi.redeemInviteLink>[1]
  ): Promise<void> => {
    const { status } = await comparisonApi.redeemInviteLink(raw, switches);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setAsking(false);
    setOutcome(status);
  };

  const body = (): JSX.Element => {
    if (!user)
      return (
        <EmptyState
          title={tr("friends.accept.signIn")}
          description={tr("friends.accept.signInHint")}
          action={
            <Link to="/login" className="btn-primary">
              {tr("auth:login.submit")}
            </Link>
          }
        />
      );
    if (access === "pending") return <p className="t-caption">{tr("common:loading.default")}</p>;
    if (access === "denied") return <EmptyState title={tr("friends.accept.off")} />;
    if (outcome)
      return (
        <Card>
          <p role="status" data-testid="accept-outcome">
            {tr(`friends.outcome.${outcome}`)}
          </p>
          <Link to="/freunde">{tr("friends.accept.toFriends")}</Link>
        </Card>
      );
    if (!decoded.ok)
      return (
        <EmptyState
          kind="degraded"
          title={tr("friends.accept.damaged")}
          description={tr("friends.accept.damagedHint")}
        />
      );
    const { origin, fingerprint } = decoded.payload;
    return (
      <Card>
        <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
          <p>{tr("friends.accept.intro", { origin })}</p>
          <dl className="m-0">
            <dt className="t-caption">{tr("friends.accept.server")}</dt>
            <dd className="m-0" data-testid="accept-origin">
              {origin}
            </dd>
            <dt className="t-caption">{tr("friends.accept.fingerprint")}</dt>
            <dd className="m-0 t-mono" data-testid="accept-fingerprint">
              {grouped(fingerprint)}
            </dd>
          </dl>
          <p className="t-caption">{tr("friends.accept.verify")}</p>
          <div>
            <Button onClick={() => setAsking(true)}>{tr("friends.accept.button")}</Button>
          </div>
        </div>
        {asking && (
          <SwitchesAskDialog
            title={tr("friend.add.switchesTitle", { name: tr("people.remoteFriend") })}
            hint={tr("friend.add.redeemHint", { origin })}
            onConfirm={redeem}
            errorText={(failure) => tr(`error.${comparisonFailureCode(failure)}`)}
            onClose={() => setAsking(false)}
          />
        )}
      </Card>
    );
  };

  return (
    <AppShell width="reading">
      <PageHeader title={tr("friends.accept.title")} />
      {body()}
    </AppShell>
  );
}
