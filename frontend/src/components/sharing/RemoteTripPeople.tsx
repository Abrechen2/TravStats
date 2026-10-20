import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";

import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { useTranslation } from "../../hooks/useTranslation";
import { sharingRemoteApi } from "../../lib/api/sharingRemote";
import { useDisplayFormat } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import type {
  CreatedRemoteInvite,
  RemoteMember,
  RemoteMemberState,
  TripRemoteSharing,
} from "../../types/sharingRemote";
import { Button, Pill } from "../ui";
import DetailSection from "../ui/DetailSection";
import { Field, Input } from "../ui/Field";
import { remoteSharingError, type RemoteSharingError } from "./remoteSharingCopy";

const NS = "sharing:remote.trip";

const STATE_COLOR: Readonly<Record<RemoteMemberState, string>> = {
  invited: "var(--ts-warn)",
  active: "var(--ts-good)",
  declined: "var(--ts-muted)",
  unreachable: "var(--ts-warn)",
  suspended: "var(--ts-warn)",
  left: "var(--ts-muted)",
  revoked: "var(--ts-muted)",
};
/** The reasons the server names; anything else reads as the generic one. */
const KNOWN_REASONS = new Set([
  "entries-too-large",
  "restore",
  "off",
  "peer-blocked",
  "unreachable",
]);
/** Why the other server refused a change, as it answered; anything else reads as "refused". */
const KNOWN_REFUSALS = new Set(["schema", "not-member", "consent"]);
/** States whose member receives changes, so where those changes stand is the line to show. */
const RECEIVING = new Set<RemoteMemberState>(["active", "unreachable"]);

/**
 * The trip's people on other servers (spec 2026-10-20 §7, phases F-S4c/F-S4d), inside "Reisende":
 * each with their server and state — invited, on the trip, declined — and, for someone on the
 * trip, where the changes made here stand on their way to them: arrived, on the way, retried
 * since when, unreachable since when, or refused and why. Each its own sentence, so a member who
 * silently holds nothing cannot happen. The caller's paired people can be offered the
 * trip from here, or anyone with a code for this trip. Drawn only behind the beta key and while
 * the server has the feature on; a trip that came from another server names it and offers nobody.
 */
export default function RemoteTripPeople({
  tripId,
  standalone = false,
}: {
  tripId: string;
  /** Without the people section around it (nobody local to list): brings its own frame. */
  standalone?: boolean;
}): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const fmt = useDisplayFormat();
  const { isFeatureVisible } = useBetaFeatures();
  const visible = isFeatureVisible("federatedTripSharing");
  const [view, setView] = useState<{ tripId: string; value: TripRemoteSharing } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RemoteSharingError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedRemoteInvite | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    try {
      const status = await sharingRemoteApi.status();
      const next = status.available ? await sharingRemoteApi.tripSharing(tripId) : null;
      if (request !== latest.current) return;
      setView(next ? { tripId, value: next } : null);
      setLoadFailed(false);
    } catch (error) {
      if (request !== latest.current) return;
      logger.error("Failed to load the trip's people on other servers:", error);
      setLoadFailed(true);
    }
  }, [tripId]);

  useEffect(() => {
    if (visible) void load();
  }, [load, visible]);

  if (!visible) return null;
  const current = view?.tripId === tripId ? view.value : null;
  if (!current && !loadFailed) return null;

  const run = async (action: () => Promise<void>, fallbackKey: string): Promise<void> => {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      await action();
      await load();
    } catch (error) {
      logger.error("Cross-server trip sharing action failed:", error);
      setFailure(remoteSharingError(error, fallbackKey));
    } finally {
      setBusy(false);
    }
  };

  const offer = (remoteId: string, name: string, origin: string): void =>
    void run(async () => {
      await sharingRemoteApi.offerTrip(tripId, remoteId);
      setNotice(t(`${NS}.offered`, { name, origin }));
    }, `${NS}.errors.offerFailed`);

  const createCode = (): void =>
    void run(async () => {
      setCreated(await sharingRemoteApi.createTripInvite(tripId));
    }, "sharing:remote.errors.createFailed");

  const reasonLine = (m: RemoteMember): string | null =>
    m.stateReason
      ? t(`${NS}.reason.${KNOWN_REASONS.has(m.stateReason) ? m.stateReason : "other"}`, {
          name: m.displayName,
          origin: m.origin,
        })
      : null;

  const deliveryLine = (m: RemoteMember): string => {
    const d = m.delivery;
    if (d.state === "rejected")
      return t(`${NS}.delivery.rejected`, {
        name: m.displayName,
        entry: d.label ?? t(`${NS}.delivery.unknownEntry`),
        why: t(
          `${NS}.delivery.why.${d.reason && KNOWN_REFUSALS.has(d.reason) ? d.reason : "other"}`
        ),
      });
    return t(`${NS}.delivery.${d.state}`, {
      name: m.displayName,
      origin: m.origin,
      date: d.stateSince ? fmt.date(d.stateSince) : "",
    });
  };

  /** The member's own sentence: a suspension's reason, else where the changes stand. */
  const statusLines = (m: RemoteMember): string[] => {
    if (RECEIVING.has(m.state)) {
      const loss = m.stateReason === "entries-too-large" ? reasonLine(m) : null;
      return [deliveryLine(m), ...(loss ? [loss] : [])];
    }
    return [reasonLine(m) ?? t(`${NS}.since`, { date: fmt.dateTime(m.stateSince) })];
  };

  const body = (
    <div className="flex flex-col text-sm" style={{ gap: "var(--ts-space-md)" }}>
      {!standalone && <h3 className="t-label-mono">{t(`${NS}.title`)}</h3>}
      {loadFailed && (
        <p role="alert" style={{ color: "var(--ts-warn)" }}>
          {t(`${NS}.errors.loadFailed`)}
        </p>
      )}
      {current?.homeOrigin && (
        <p className="t-caption">{t(`${NS}.fromServer`, { origin: current.homeOrigin })}</p>
      )}
      {current && current.members.length > 0 && (
        <ul className="flex flex-col gap-2">
          {current.members.map((m) => (
            <li key={m.id} className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span>
                  {t(`${NS}.row`, { name: m.displayName, username: m.username, origin: m.origin })}
                </span>
                <Pill color={STATE_COLOR[m.state]}>{t(`${NS}.state.${m.state}`)}</Pill>
              </span>
              {statusLines(m).map((line) => (
                <span key={line} className="t-caption" data-testid="remote-member-status">
                  {line}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {current && !current.homeOrigin && (
        <>
          {current.offerable.length > 0 && (
            <ul className="flex flex-col gap-2">
              {current.offerable.map((p) => (
                <li key={p.remoteId} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {t(`${NS}.row`, {
                      name: p.displayName,
                      username: p.username,
                      origin: p.origin,
                    })}
                  </span>
                  <Button
                    disabled={busy}
                    onClick={() => offer(p.remoteId, p.displayName, p.origin)}
                  >
                    {t(`${NS}.offer`)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button disabled={busy} onClick={createCode}>
              {t(`${NS}.createCode`)}
            </Button>
            <p className="t-caption mt-1">{t(`${NS}.codeHint`)}</p>
          </div>
          {created && (
            <Field
              label={t("sharing:remote.invites.codeLabel")}
              htmlFor={`trip-invite-code-${tripId}`}
              hint={t("sharing:remote.invites.codeHint", {
                date: fmt.dateTime(created.expiresAt),
              })}
            >
              <Input
                id={`trip-invite-code-${tripId}`}
                readOnly
                value={created.code}
                onFocus={(e) => e.target.select()}
              />
            </Field>
          )}
        </>
      )}
      {failure && (
        <p role="alert" style={{ color: "var(--ts-warn)" }}>
          {t(failure.key, { origin: failure.origin })}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
  return standalone ? <DetailSection title={t(`${NS}.title`)}>{body}</DetailSection> : body;
}
