import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import { sharingApi } from "../../lib/api/sharing";
import { logger } from "../../lib/logger";
import { formatCurrency } from "../../lib/units";
import { useToastStore } from "../../store/toastStore";
import { useTripSharingStore } from "../../store/tripSharingStore";
import type { TripPerson, TripSharing } from "../../types/sharing";
import { Button, Pill } from "../ui";
import DetailSection from "../ui/DetailSection";
import PeopleList, { type PersonRow } from "../ui/PeopleList";
import LinkAccountDialog from "./LinkAccountDialog";
import ShareTripDialog from "./ShareTripDialog";
import { sharingErrorKey } from "./sharingCopy";

const NS = "sharing:people";

/**
 * "Reisende" on the trip overview (spec 2026-10-16, D9) — the trip's people
 * and its sharing in one place: who is linked to an account, who holds this
 * trip, whose consent is missing, and the ONE thing to do next for each (link,
 * or share through a dialog). The names show at once from the trip; the
 * sharing state follows, and a failed load says so without hiding the names.
 */
export default function TripPeopleSection({
  tripId,
  companionNames,
  onChanged,
}: {
  tripId: string;
  companionNames: readonly string[];
  onChanged?: () => void;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["sharing", "trips"]);
  const isSharedDemo = useIsDemoAccount();
  const addToast = useToastStore((s) => s.addToast);
  const revision = useTripSharingStore((s) => s.revision[tripId] ?? 0);
  const bump = useTripSharingStore((s) => s.bump);
  const { confirm, confirmDialog } = useConfirmDialog();
  const [view, setView] = useState<TripSharing | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sharing, setSharing] = useState<TripPerson | null>(null);
  const [linking, setLinking] = useState<TripPerson | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await sharingApi.tripSharing(tripId));
      setLoadFailed(false);
    } catch (error) {
      logger.error("Failed to load trip sharing:", error);
      setLoadFailed(true);
    }
  }, [tripId]);

  useEffect(() => {
    if (!isSharedDemo) void load();
  }, [load, revision, isSharedDemo]);

  const changed = (): void => {
    bump(tripId);
    onChanged?.();
  };

  const leave = async (): Promise<void> => {
    if (
      !(await confirm({ message: t("sharing:trip.leaveConfirm"), confirmText: t(`${NS}.leave`) }))
    )
      return;
    setBusy(true);
    try {
      await sharingApi.leaveGroup(tripId);
      addToast("success", t("sharing:trip.left"));
      changed();
    } catch (error) {
      logger.error("Failed to leave share group:", error);
      addToast("error", t(sharingErrorKey(error, "sharing:trip.errors.leaveFailed")));
    } finally {
      setBusy(false);
    }
  };

  if (companionNames.length === 0 && (view?.people.length ?? 0) === 0) return null;
  if (isSharedDemo || !view) {
    return (
      <DetailSection title={t("trips:detail.companions")}>
        <PeopleList names={companionNames} />
        {loadFailed && (
          <p role="alert" className="text-sm" style={{ color: "var(--ts-warn)" }}>
            {t("sharing:trip.errors.loadFailed")}
          </p>
        )}
      </DetailSection>
    );
  }

  const badges = (p: TripPerson): JSX.Element => (
    <>
      {p.account && <Pill color="var(--ts-muted)">{t(`${NS}.badges.linked`)}</Pill>}
      {p.member && <Pill color="var(--ts-good)">{t(`${NS}.badges.member`)}</Pill>}
      {(p.consent === "pending" || p.receivesChanges === false) && (
        <Pill color="var(--ts-warn)">{t(`${NS}.badges.consentPending`)}</Pill>
      )}
    </>
  );
  const meta = (p: TripPerson): string | undefined => {
    if (p.receivesChanges === false) return t(`${NS}.noChangesHint`);
    if (p.shareBlockedBy === "consentMissing")
      return t(`${NS}.blocked.consentMissing`, { name: p.name });
    if (p.shareBlockedBy === "groupConsentMissing") {
      return t(`${NS}.blocked.groupConsentMissing`, { name: p.name });
    }
    return p.account ? `@${p.account.username}` : undefined;
  };
  const action = (p: TripPerson): JSX.Element | undefined => {
    if (p.shareBlockedBy === "notLinked" && p.companionId) {
      return <Button onClick={() => setLinking(p)}>{t(`${NS}.actions.link`)}</Button>;
    }
    if (p.shareBlockedBy === null) {
      return <Button onClick={() => setSharing(p)}>{t(`${NS}.actions.share`)}</Button>;
    }
    return undefined;
  };
  const rows: PersonRow[] = view.people.map((p) => ({
    key: p.key,
    name: p.name,
    meta: meta(p),
    badges: badges(p),
    action: action(p),
  }));

  return (
    <>
      <DetailSection title={t("trips:detail.companions")}>
        <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
          {/* A trip whose companions are bare names, with no companion entry
              behind them, has names but no person rows — keep the names. */}
          {rows.length > 0 ? <PeopleList rows={rows} /> : <PeopleList names={companionNames} />}
          {view.bookingTotals.length > 0 && (
            <div data-testid="share-booking-totals" className="text-sm">
              <p className="t-label-mono">{t("sharing:trip.bookingTotals")}</p>
              <ul className="flex flex-col gap-1">
                {view.bookingTotals.map((entry) => (
                  <li key={entry.member.id}>
                    {entry.member.displayName}:{" "}
                    {entry.totals
                      .map((sum) =>
                        formatCurrency(sum.amount, sum.currency, { language: i18n.language })
                      )
                      .join(" + ")}
                  </li>
                ))}
              </ul>
              <p className="t-caption">{t("sharing:trip.bookingTotalsHint")}</p>
            </div>
          )}
          {view.groupId && (
            <div>
              <Button disabled={busy} onClick={() => void leave()}>
                {t(`${NS}.leave`)}
              </Button>
            </div>
          )}
        </div>
      </DetailSection>
      {sharing && (
        <ShareTripDialog
          open
          onClose={() => setSharing(null)}
          tripId={tripId}
          people={view.people}
          preselectedKey={sharing.key}
          onShared={changed}
        />
      )}
      {linking?.companionId && (
        <LinkAccountDialog
          open
          onClose={() => setLinking(null)}
          companion={{ id: linking.companionId, name: linking.name }}
          linkableUsers={view.linkableUsers}
          onLinked={changed}
        />
      )}
      {confirmDialog}
    </>
  );
}
