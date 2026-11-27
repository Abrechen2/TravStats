import { useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";

import { useConfirmDialog } from "../../../hooks/useConfirmDialog";
import { useBetaFeatures } from "../../../hooks/useBetaFeatures";
import { useIsDemoAccount } from "../../../hooks/useIsDemoAccount";
import { useTranslation } from "../../../hooks/useTranslation";
import { comparisonApi } from "../../../lib/api/comparison";
import { sharingApi } from "../../../lib/api/sharing";
import { sharingConnectionsApi } from "../../../lib/api/sharingConnections";
import { sharingRemoteApi } from "../../../lib/api/sharingRemote";
import { logger } from "../../../lib/logger";
import { useToastStore } from "../../../store/toastStore";
import { NO_SWITCHES } from "../../../types/sharingRemote";
import ConsentDialog from "../../comparison/ConsentDialog";
import RemotePersonField from "../../sharing/RemotePersonField";
import LinkAccountDialog from "../../sharing/LinkAccountDialog";
import ReceivedRemoteOffers from "../../sharing/ReceivedRemoteOffers";
import RemotePlanInvitations from "../../sharing/RemotePlanInvitations";
import { remoteSharingError } from "../../sharing/remoteSharingCopy";
import { sharingErrorKey } from "../../sharing/sharingCopy";
import Button from "../../ui/Button";
import PeopleList, { type PersonRow } from "../../ui/PeopleList";
import Pill from "../../ui/Pill";
import CompanionMergeDialog from "../companions/CompanionMergeDialog";
import CompanionRenameDialog from "../companions/CompanionRenameDialog";
import { CompanionDeleteDialog, DeleteUnusedDialog } from "../companions/CompanionDeleteDialogs";
import RemotePersonAchievements from "../RemotePersonAchievements";
import RemotePersonStats from "../RemotePersonStats";
import { SectionCard, SectionTitle } from "../SettingsShared";
import type { PendingRequest, PersonEntry } from "./buildPeople";
import InvitationCodeDialog from "./InvitationCodeDialog";
import { originHost } from "../../../lib/personHandle";
import BulkLinkDialog from "../../sharing/BulkLinkDialog";
import { PersonMenu, PersonSwitches, type PersonHandlers } from "./PersonControls";
import { usePeople } from "./usePeople";
import { comparisonFailureCode } from "../../../lib/api/comparison";
import InlineError from "../../ui/InlineError";

const NS = "sharing:friends";

type Open =
  | { kind: "rename"; person: PersonEntry }
  | { kind: "merge"; person: PersonEntry }
  | { kind: "delete"; person: PersonEntry }
  | { kind: "link"; person: PersonEntry }
  | { kind: "deleteUnused" }
  | { kind: "totals"; person: PersonEntry; mode: "ask" | "change" }
  | { kind: "acceptTotals"; request: Extract<PendingRequest, { kind: "comparison" }> }
  | { kind: "code" }
  | { kind: "bulk"; person: PersonEntry }
  | null;

const PILL_COLOR = { requested: "var(--ts-warn)" } as const;

/**
 * "Personen" (owner, 2026-11-20): the companions and the connected accounts as ONE list, one row
 * per person — a companion linked to an account is a single row. Per person, the switches for what
 * they get (trips, leaderboard totals behind its beta gate; each its own consent record and API,
 * and a quiet link to the encrypted hand-over page) and the small row actions. Requests to the caller wait
 * above the list; the one field for a person on another server and the invitation code sit under it.
 * Every failure is shown as itself and logged, never swallowed.
 */
export default function PeopleSection(): JSX.Element {
  const { t } = useTranslation(["sharing", "companions", "settings"]);
  const { isFeatureVisible } = useBetaFeatures();
  const isDemo = useIsDemoAccount();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const { confirm, confirmDialog } = useConfirmDialog();
  const state = usePeople();
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [stats, setStats] = useState<string | null>(null);
  const [achievements, setAchievements] = useState<string | null>(null);
  const [offersVersion, setOffersVersion] = useState(0);

  /** Runs one write: its failure is said on the page, logged, and the list is read again. */
  const run = async (
    action: () => Promise<string | null>,
    failureKey: string,
    mapError: (error: unknown, fallback: string) => string = (error, fallback) =>
      t(sharingErrorKey(error, fallback))
  ): Promise<boolean> => {
    setBusy(true);
    setProblem(null);
    try {
      const done = await action();
      if (done) addToast("success", done);
      await state.reload();
      return true;
    } catch (error) {
      logger.warn("Settings people: an action failed", error);
      setProblem(mapError(error, failureKey));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const remoteError = (error: unknown, fallback: string): string => {
    const failure = remoteSharingError(error, fallback);
    return t(failure.key, { origin: failure.origin });
  };
  const comparisonError = (error: unknown): string =>
    t(`comparison:error.${comparisonFailureCode(error)}`);

  const handlers: PersonHandlers = {
    toggleShare: (p, on) => {
      const account = p.account;
      if (!account) return;
      if (account.kind === "remote") {
        const conn = p.connection;
        if (!conn) return;
        void run(
          async () => {
            await sharingConnectionsApi.setSwitches(conn.id, { ...conn.mine, tripOffers: on });
            return t(`${NS}.done.switchSaved`);
          },
          "sharing:remote.errors.switchesFailed",
          remoteError
        );
        return;
      }
      if (on) {
        void run(async () => {
          await sharingApi.requestConsent(account.username);
          return t(`${NS}.done.shareAsked`, { name: p.name });
        }, "sharing:settings.errors.requestFailed");
        return;
      }
      const consent = p.shareConsent;
      if (!consent) return;
      void (async () => {
        // Nothing was shared while a request is still open: no question then.
        if (
          consent.status === "accepted" &&
          !(await confirm({
            message: t(`${NS}.confirm.withdrawShare`, { name: p.name }),
            confirmText: t(`${NS}.confirm.withdrawShareAction`),
            destructive: true,
          }))
        )
          return;
        await run(async () => {
          await sharingApi.answerConsent(consent.id, "withdraw");
          return t(`${NS}.done.shareWithdrawn`, { name: p.name });
        }, "sharing:settings.errors.withdrawFailed");
      })();
    },
    toggleTotals: (p, on) => {
      if (on) {
        // Only a local account can be asked by username; never send a remote person's.
        if (p.account?.kind !== "local") return;
        setOpen({ kind: "totals", person: p, mode: "ask" });
        return;
      }
      const mine = p.comparison?.mine;
      const key = p.comparison?.person.key;
      if (!mine || !key) return;
      void (async () => {
        if (
          !(await confirm({
            message: t(`${NS}.confirm.totalsOff`, { name: p.name }),
            confirmText: t(`${NS}.confirm.totalsOffAction`),
            destructive: true,
          }))
        )
          return;
        await run(
          async () => {
            await comparisonApi.end(key);
            return t(`${NS}.done.totalsOff`, { name: p.name });
          },
          `${NS}.errors.action`,
          (error) => comparisonError(error)
        );
      })();
    },
    editTotalsScope: (p) => setOpen({ kind: "totals", person: p, mode: "change" }),
    link: (p) => setOpen({ kind: "link", person: p }),
    rename: (p) => setOpen({ kind: "rename", person: p }),
    merge: (p) => setOpen({ kind: "merge", person: p }),
    remove: (p) => setOpen({ kind: "delete", person: p }),
    endConnection: (p) => {
      const conn = p.connection;
      if (!conn) return;
      void (async () => {
        if (
          !(await confirm({
            message: t(`${NS}.confirm.endConnection`, { name: p.name }),
            confirmText: t(`${NS}.confirm.endConnectionAction`),
            destructive: true,
          }))
        )
          return;
        await run(
          async () => {
            await sharingConnectionsApi.end(conn.id);
            return t(`${NS}.done.ended`);
          },
          "sharing:remote.errors.endFailed",
          remoteError
        );
      })();
    },
    withdrawPaired: (p) => {
      const paired = p.paired;
      if (!paired) return;
      void (async () => {
        if (
          !(await confirm({
            message: t(`${NS}.confirm.withdrawPaired`, { name: p.name, origin: paired.origin }),
            confirmText: t(`${NS}.confirm.withdrawPairedAction`),
            destructive: true,
          }))
        )
          return;
        await run(
          async () => {
            await sharingRemoteApi.withdrawPerson(paired.id);
            return t(`${NS}.done.withdrawn`);
          },
          "sharing:remote.errors.withdrawFailed",
          remoteError
        );
      })();
    },
    withdrawIncoming: (p) => {
      const incoming = p.incomingConsent;
      if (!incoming) return;
      void (async () => {
        if (
          !(await confirm({
            message: t(`${NS}.confirm.withdrawIncoming`, { name: p.name }),
            confirmText: t(`${NS}.confirm.withdrawIncomingAction`),
            destructive: true,
          }))
        )
          return;
        await run(async () => {
          await sharingApi.answerConsent(incoming.id, "withdraw");
          return t(`${NS}.done.withdrawn`);
        }, "sharing:settings.errors.withdrawFailed");
      })();
    },
    toggleStats: (p) => setStats((id) => (id === p.key ? null : p.key)),
    toggleAchievements: (p) => setAchievements((id) => (id === p.key ? null : p.key)),
    bulkLink: (p) => setOpen({ kind: "bulk", person: p }),
  };

  const answer = (request: PendingRequest, accept: boolean): void => {
    if (request.kind === "comparison" && accept) {
      setOpen({ kind: "acceptTotals", request });
      return;
    }
    void run(
      async () => {
        if (request.kind === "share") {
          await sharingApi.answerConsent(request.id, accept ? "accept" : "decline");
        } else if (request.kind === "connection") {
          if (accept) await sharingConnectionsApi.accept(request.id, NO_SWITCHES);
          else if (request.connection.state === "reconfirm")
            await sharingConnectionsApi.end(request.id);
          else await sharingConnectionsApi.decline(request.id);
        } else {
          await comparisonApi.decline(request.id);
        }
        return t(`${NS}.done.${accept ? "accepted" : "declined"}`);
      },
      request.kind === "connection"
        ? "sharing:remote.errors.confirmFailed"
        : "sharing:settings.errors.requestFailed",
      request.kind === "connection"
        ? remoteError
        : request.kind === "comparison"
          ? (error) => comparisonError(error)
          : undefined
    );
  };

  const requestLine = (r: PendingRequest): string =>
    r.kind === "share"
      ? t(`${NS}.requests.share`, { name: r.person.displayName, username: r.person.username })
      : r.kind === "connection"
        ? t(`${NS}.requests.${r.connection.state === "reconfirm" ? "reconfirm" : "connection"}`, {
            name: r.connection.displayName,
            username: r.connection.username,
            host: originHost(r.connection.origin),
          })
        : t(`${NS}.requests.comparison`, { name: r.request.person.displayName });

  const unused = state.companions.filter((c) => !c.inUse).length;
  const rows: PersonRow[] = state.people.map((p) => ({
    key: p.key,
    name: p.name,
    meta: (
      <span style={{ color: "var(--ts-muted)" }}>
        {p.account === null
          ? t(`${NS}.account.none`)
          : p.account.kind === "local"
            ? t(`${NS}.account.local`, { username: p.account.username })
            : t(`${NS}.account.remote`, {
                username: p.account.username,
                host: originHost(p.account.origin),
              })}
        {p.status === "connected" && ` · ${t(`${NS}.status.connected`)}`}
      </span>
    ),
    // Only a state that needs attention gets a pill: a request nobody has answered yet.
    badges:
      p.status === "requested" ? (
        <Pill color={PILL_COLOR.requested}>{t(`${NS}.status.requested`)}</Pill>
      ) : undefined,
    details: (
      <>
        <PersonSwitches person={p} handlers={handlers} disabled={isDemo || busy} />
        {stats === p.key && p.connection && <RemotePersonStats person={p.connection} />}
        {achievements === p.key && p.connection && (
          <RemotePersonAchievements person={p.connection} />
        )}
      </>
    ),
    action: (
      <PersonMenu
        person={p}
        handlers={handlers}
        disabled={isDemo || busy}
        canMerge={state.companions.length > 1}
        statsOpen={stats === p.key}
        achievementsOpen={achievements === p.key}
      />
    ),
  }));

  const companionOf = (p: PersonEntry) => p.companion;
  const done = (): void => {
    setOpen(null);
    void state.reload();
  };
  const totalsPerson = open?.kind === "totals" ? open.person : null;

  return (
    <SectionCard>
      <SectionTitle title={t(`${NS}.title`)} />
      <div className="flex flex-col gap-4">
        <p className="t-caption">{t(`${NS}.intro`)}</p>
        {isDemo && <p className="t-caption">{t(`${NS}.demo`)}</p>}
        {state.failed.map((source) => (
          <div
            key={source}
            role="alert"
            className="flex flex-wrap items-center gap-2 text-sm"
            style={{ color: "var(--ts-warn)" }}
          >
            <span>{t(`${NS}.loadFailed.${source}`)}</span>
            <Button onClick={() => void state.reload()}>{t(`${NS}.retry`)}</Button>
          </div>
        ))}
        {problem && <InlineError tone="warning">{problem}</InlineError>}

        {state.requests.length > 0 && (
          <div className="flex flex-col gap-2" data-testid="people-requests">
            <p className="t-label-mono">{t(`${NS}.requests.title`)}</p>
            <ul className="flex flex-col gap-2">
              {state.requests.map((r) => (
                <li key={`${r.kind}:${r.id}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1">{requestLine(r)}</span>
                  {!(r.kind === "connection" && r.connection.state === "reconfirm") && (
                    <Button
                      variant="primary"
                      disabled={isDemo || busy}
                      onClick={() => answer(r, true)}
                    >
                      {t(`${NS}.requests.accept`)}
                    </Button>
                  )}
                  <Button disabled={isDemo || busy} onClick={() => answer(r, false)}>
                    {r.kind === "connection" && r.connection.state === "reconfirm"
                      ? t(`${NS}.requests.endReconfirm`)
                      : t(`${NS}.requests.decline`)}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {state.remoteAvailable && !isDemo && (
          <>
            <ReceivedRemoteOffers refresh={offersVersion} />
            <RemotePlanInvitations />
          </>
        )}

        {state.loading && <p className="t-caption">{t(`${NS}.loading`)}</p>}
        {!state.loading && rows.length === 0 && <p className="t-caption">{t(`${NS}.empty`)}</p>}
        {rows.length > 0 && <PeopleList rows={rows} />}

        {unused > 0 && !isDemo && (
          <p>
            <button
              type="button"
              className="t-caption underline"
              data-testid="delete-unused-link"
              disabled={busy}
              onClick={() => setOpen({ kind: "deleteUnused" })}
            >
              {t(`${NS}.unusedLink`, { count: unused })}
            </button>
          </p>
        )}
        {isFeatureVisible("encryptedShare") && (
          <p>
            <button
              type="button"
              className="t-caption underline"
              onClick={() => navigate("/encrypted-share")}
            >
              {t(`${NS}.encryptedManage`)}
            </button>
          </p>
        )}

        {state.remoteAvailable && !isDemo && (
          <RemotePersonField
            settingsPage
            busy={busy}
            onCreateCode={() => setOpen({ kind: "code" })}
            onOffer={async (origin, username) => {
              addToast("info", t(`${NS}.remote.alreadyConnected`, { name: username, origin }));
              return false;
            }}
          />
        )}
      </div>

      {open?.kind === "rename" && companionOf(open.person) && (
        <CompanionRenameDialog
          companion={companionOf(open.person)!}
          onClose={() => setOpen(null)}
          onDone={done}
          onMergeInstead={() => setOpen({ kind: "merge", person: open.person })}
        />
      )}
      {open?.kind === "merge" && companionOf(open.person) && (
        <CompanionMergeDialog
          companion={companionOf(open.person)!}
          others={state.companions.filter((c) => c.id !== companionOf(open.person)!.id)}
          onClose={() => setOpen(null)}
          onDone={done}
        />
      )}
      {open?.kind === "delete" && companionOf(open.person) && (
        <CompanionDeleteDialog
          companion={companionOf(open.person)!}
          onClose={() => setOpen(null)}
          onDone={done}
        />
      )}
      {open?.kind === "deleteUnused" && (
        <DeleteUnusedDialog count={unused} onClose={() => setOpen(null)} onDone={done} />
      )}
      {open?.kind === "link" && companionOf(open.person) && (
        <LinkAccountDialog
          open
          onClose={() => setOpen(null)}
          companion={{ id: companionOf(open.person)!.id, name: open.person.name }}
          linkableUsers={state.linkable?.linkableUsers ?? []}
          onLinked={done}
        />
      )}
      {open?.kind === "bulk" && (
        <BulkLinkDialog person={open.person} onClose={() => setOpen(null)} />
      )}
      {open?.kind === "code" && (
        <InvitationCodeDialog
          onClose={() => setOpen(null)}
          onClaimed={() => {
            setOffersVersion((v) => v + 1);
            void state.reload();
          }}
        />
      )}
      {totalsPerson && open?.kind === "totals" && totalsPerson.account && (
        <ConsentDialog
          open
          mode={open.mode}
          onClose={() => setOpen(null)}
          person={{
            displayName: totalsPerson.name,
            origin: totalsPerson.account.kind === "remote" ? totalsPerson.account.origin : null,
          }}
          initialScope={totalsPerson.comparison?.mine?.scope ?? null}
          onConfirm={async (scope) => {
            const mine = totalsPerson.comparison?.mine;
            if (open.mode === "change" && mine) {
              await comparisonApi.updateScope(mine.consentId, scope);
            } else if (totalsPerson.account) {
              await comparisonApi.request(totalsPerson.account.username, scope);
              addToast("success", t(`${NS}.done.totalsAsked`, { name: totalsPerson.name }));
            }
            done();
          }}
        />
      )}
      {open?.kind === "acceptTotals" && (
        <ConsentDialog
          open
          mode="accept"
          onClose={() => setOpen(null)}
          person={{
            displayName: open.request.request.person.displayName,
            origin: open.request.request.person.origin,
          }}
          onConfirm={async (scope) => {
            await comparisonApi.accept(open.request.id, scope);
            addToast("success", t(`${NS}.done.accepted`));
            done();
          }}
        />
      )}
      {confirmDialog}
    </SectionCard>
  );
}
