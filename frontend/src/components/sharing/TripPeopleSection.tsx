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
import InlineError from "../ui/InlineError";
import { reportPageError } from "../../store/pageErrorStore";

const NS = "sharing:people";
/** The same-person question shares its words with the one for people on other servers. */
const COMPANION_NS = "sharing:remote.trip.companion";

/** A loaded view, a failure or a picked row — each remembers the trip it belongs to. */
type ForTrip<T> = { tripId: string; value: T } | null;
type Picked = { kind: "share" | "link"; person: TripPerson };

const alertLine = (text: string): JSX.Element => <InlineError tone="warning">{text}</InlineError>;

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
  bare = false,
}: {
  tripId: string;
  companionNames: readonly string[];
  onChanged?: () => void;
  /**
   * Inside the "Teilen" dialog, which carries the title: no section frame, and
   * the ways to offer the trip to people on other servers are drawn too.
   */
  bare?: boolean;
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
      reportPageError(t(sharingErrorKey(error, "sharing:trip.errors.leaveFailed")));
    } finally {
      setBusy(false);
    }
  };

  const failure = loadFailed && alertLine(t("sharing:trip.errors.loadFailed"));
  // Hidden only when there is nobody AND nothing to say — a failed load on a
  // trip without names still says it failed.
  // People on other servers (F-S4c) still have their place when nobody local is listed.
  if (companionNames.length === 0 && (view?.people.length ?? 0) === 0 && !loadFailed)
    return isSharedDemo ? null : (
      <RemoteTripPeople tripId={tripId} standalone={!bare} bare={bare} offerControls={bare} />
    );
  const frame = (children: JSX.Element): JSX.Element =>
    bare ? (
      children
    ) : (
      <DetailSection title={t("trips:detail.companions")}>{children}</DetailSection>
    );
  if (isSharedDemo || !view) {
    return frame(
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        {failure}
        <PeopleList names={companionNames} />
        {bare && !isSharedDemo && <RemoteTripPeople tripId={tripId} bare offerControls />}
      </div>
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
  /**
   * A member of this server who is none of the reader's companions, but one of them has their
   * name: the same "Ist das <Name>?" a person on another server gets. Only "Ja" links.
   */
  const answer = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await task();
      changed();
    } catch (error) {
      logger.error("Failed to answer the same-person question:", error);
      reportPageError(t(sharingErrorKey(error, `${COMPANION_NS}.failed`)));
    } finally {
      setBusy(false);
    }
  };
  const question = (p: TripPerson): JSX.Element | undefined => {
    const account = p.account;
    const matches = p.nameMatches ?? [];
    if (!account || p.companionId || matches.length === 0) return undefined;
    return (
      <span className="flex flex-col gap-1">
        {matches.map((match) => (
          <span
            key={match.id}
            className="flex flex-wrap items-center gap-2"
            data-testid="local-companion-question"
          >
            <span>{t(`${COMPANION_NS}.question`, { name: match.name, person: p.name })}</span>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void answer(async () => {
                  await sharingApi.linkCompanion(match.id, account.id);
                })
              }
            >
              {t(`${COMPANION_NS}.yes`)}
            </Button>
            <Button
              disabled={busy}
              onClick={() => void answer(() => sharingApi.markNotSameLocal(match.id, account.id))}
            >
              {t(`${COMPANION_NS}.no`)}
            </Button>
          </span>
        ))}
      </span>
    );
  };
  const action = (p: TripPerson): JSX.Element | undefined => {
    const asked = question(p);
    if (asked) return asked;
    if (p.shareBlockedBy === "notLinked" && p.companionId) {
      return (
        <button
          type="button"
          className="t-caption underline"
          onClick={() => setPicked({ tripId, value: { kind: "link", person: p } })}
        >
          {t(`${NS}.actions.link`)}
        </button>
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
      {frame(
        <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
          {failure}
          <PeopleList rows={rows} />
          <RemoteTripPeople tripId={tripId} bare={bare} offerControls={bare} />
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
      )}
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
