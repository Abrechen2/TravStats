import { useCallback, useEffect, useRef, useState } from "react";
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
import RemoteTripPeople from "./RemoteTripPeople";
import ShareTripDialog from "./ShareTripDialog";
import { nameKey } from "./addTraveller";
import { shareBlockKey, sharingErrorKey } from "./sharingCopy";

const NS = "sharing:people";

/** A loaded view, a failure or a picked row — each remembers the trip it belongs to. */
type ForTrip<T> = { tripId: string; value: T } | null;
type Picked = { kind: "share" | "link"; person: TripPerson };

const alertLine = (text: string): JSX.Element => (
  <p role="alert" className="text-sm" style={{ color: "var(--ts-warn)" }}>
    {text}
  </p>
);

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
  // State is tagged with its trip, so a trip change never shows the previous
  // trip's rows, failure or open dialog, not even for one render.
  const [loaded, setLoaded] = useState<ForTrip<TripSharing>>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [picked, setPicked] = useState<ForTrip<Picked>>(null);
  const [busy, setBusy] = useState(false);
  const latestRequest = useRef(0);
  const view = loaded?.tripId === tripId ? loaded.value : null;
  const loadFailed = failedFor === tripId;
  const pick = picked?.tripId === tripId ? picked.value : null;

  const load = useCallback(async () => {
    // Only the newest request may land: an older answer arriving last would
    // otherwise paint a state that is no longer true.
    const request = ++latestRequest.current;
    try {
      const next = await sharingApi.tripSharing(tripId);
      if (request !== latestRequest.current) return;
      setLoaded({ tripId, value: next });
      setFailedFor(null);
    } catch (error) {
      if (request !== latestRequest.current) return;
      logger.error("Failed to load trip sharing:", error);
      setFailedFor(tripId);
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

  const failure = loadFailed && alertLine(t("sharing:trip.errors.loadFailed"));
  // Hidden only when there is nobody AND nothing to say — a failed load on a
  // trip without names still says it failed.
  // People on other servers (F-S4c) still have their place when nobody local is listed.
  if (companionNames.length === 0 && (view?.people.length ?? 0) === 0 && !loadFailed)
    return isSharedDemo ? null : <RemoteTripPeople tripId={tripId} standalone />;
  if (isSharedDemo || !view) {
    return (
      <DetailSection title={t("trips:detail.companions")}>
        <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
          {failure}
          <PeopleList names={companionNames} />
        </div>
      </DetailSection>
    );
  }

  const badges = (p: TripPerson): JSX.Element | undefined => {
    // A member whose changes already arrive (consent accepted the other way)
    // waits on nothing, even while the reader's own request to them is open.
    const pending =
      p.receivesChanges === false || (p.consent === "pending" && p.receivesChanges !== true);
    if (!p.account && !p.member && !pending) return undefined;
    return (
      <>
        {p.account && <Pill color="var(--ts-muted)">{t(`${NS}.badges.linked`)}</Pill>}
        {p.member && <Pill color="var(--ts-good)">{t(`${NS}.badges.member`)}</Pill>}
        {pending && <Pill color="var(--ts-warn)">{t(`${NS}.badges.consentPending`)}</Pill>}
      </>
    );
  };
  const meta = (p: TripPerson): string | undefined => {
    if (p.receivesChanges === false) return t(`${NS}.noChangesHint`);
    if (p.shareBlockedBy === "consentMissing")
      return t(`${NS}.blocked.${shareBlockKey(p)}`, { name: p.name });
    if (p.shareBlockedBy === "accountInactive") {
      return t("sharing:shareDialog.blocked.accountInactive", { name: p.name });
    }
    if (p.shareBlockedBy === "groupConsentMissing") {
      return t(`${NS}.blocked.groupConsentMissing`, { name: p.name });
    }
    return p.account ? `@${p.account.username}` : undefined;
  };
  const action = (p: TripPerson): JSX.Element | undefined => {
    if (p.shareBlockedBy === "notLinked" && p.companionId) {
      return (
        <Button onClick={() => setPicked({ tripId, value: { kind: "link", person: p } })}>
          {t(`${NS}.actions.link`)}
        </Button>
      );
    }
    if (p.shareBlockedBy === null) {
      return (
        <Button onClick={() => setPicked({ tripId, value: { kind: "share", person: p } })}>
          {t(`${NS}.actions.share`)}
        </Button>
      );
    }
    return undefined;
  };
  const personRows: PersonRow[] = view.people.map((p) => ({
    key: p.key,
    name: p.name,
    meta: meta(p),
    badges: badges(p),
    action: action(p),
  }));
  const rows = [...personRows, ...uncoveredNameRows(companionNames, view.people)];

  return (
    <>
      <DetailSection title={t("trips:detail.companions")}>
        <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
          {failure}
          <PeopleList rows={rows} />
          <RemoteTripPeople tripId={tripId} />
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
      {pick?.kind === "share" && (
        <ShareTripDialog
          open
          onClose={() => setPicked(null)}
          tripId={tripId}
          people={view.people}
          linkableUsers={view.linkableUsers}
          preselectedKey={pick.person.key}
          onShared={changed}
          onPeopleChanged={changed}
        />
      )}
      {pick?.kind === "link" && pick.person.companionId && (
        <LinkAccountDialog
          open
          onClose={() => setPicked(null)}
          companion={{ id: pick.person.companionId, name: pick.person.name }}
          linkableUsers={view.linkableUsers}
          onLinked={changed}
        />
      )}
      {confirmDialog}
    </>
  );
}

/**
 * The trip's companion names that no companion row stands for, as plain rows.
 * A trip may carry bare legacy names with no companion entry behind them, and
 * then only share-group members have person rows — those names must still
 * show. Each companion row covers one occurrence of its name (compared by
 * `nameKey`, the original string is what is shown), so nobody
 * appears twice and two people of the same name both stay.
 */
function uncoveredNameRows(names: readonly string[], people: readonly TripPerson[]): PersonRow[] {
  const covered = people.filter((p) => p.companionId !== null).map((p) => nameKey(p.name));
  const keys = names.map(nameKey);
  const count = (list: readonly string[], key: string): number =>
    list.filter((k) => k === key).length;
  return names
    .map((name, index) => ({ name, index, key: keys[index] ?? "" }))
    .filter(({ index, key }) => count(keys.slice(0, index), key) >= count(covered, key))
    .map(({ name, index }) => ({ key: `n:${index}:${name}`, name }));
}
