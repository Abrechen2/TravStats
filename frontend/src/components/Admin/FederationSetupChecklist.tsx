import type { JSX, ReactNode } from "react";
import type { FederationPeer, FederationState } from "../../lib/api/federationAdmin";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import { Button } from "../ui";

const NS = "federation.checklist";

/** The ids of the controls an open step leads to, all inside `FederationSettings`. */
export const CONTROL = {
  origin: "federation-origin",
  key: "federation-generate-key",
  federation: "federation-enabled",
  peerForm: "peer-origin",
} as const;

type IdentityGap = "noOrigin" | "noKey" | "federationOff" | "invalidOrigin";

/**
 * Why `loadIdentity()` fails, in the order the admin fixes it. Only reached while the
 * fingerprint is null — which is exactly "the identity does not load".
 */
function identityGap(state: FederationState): { gap: IdentityGap; control: string } {
  if (!state.origin) return { gap: "noOrigin", control: CONTROL.origin };
  if (!state.hasKey) return { gap: "noKey", control: CONTROL.key };
  if (!state.enabled) return { gap: "federationOff", control: CONTROL.federation };
  // Origin, key and switch are there: then the address is what loadIdentity refused
  // (http, a port, a path).
  return { gap: "invalidOrigin", control: CONTROL.origin };
}

/** Admitted = pinned with its fingerprint, not suspended, and a ping reached it (spec §10). */
export const isAdmitted = (p: FederationPeer): boolean => p.enabled && p.verifiedAt !== null;

function focusControl(id: string): void {
  const el = document.getElementById(id);
  el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  el?.focus();
}

function Step({
  n,
  done,
  title,
  children,
}: {
  n: number;
  /** `null`: a step for the users, nothing the admin can tick off. */
  done: boolean | null;
  title: string;
  children: ReactNode;
}): JSX.Element {
  const { t } = useTranslation(["admin"]);
  return (
    <li
      data-testid={`federation-step-${n}`}
      data-done={done === null ? undefined : String(done)}
      className="flex flex-col"
      style={{ gap: "var(--ts-space-xs)" }}
    >
      <span className="flex flex-wrap items-baseline" style={{ gap: "var(--ts-space-sm)" }}>
        {done !== null && (
          <span
            className="t-label-mono"
            style={{ color: done ? "var(--ts-good)" : "var(--ts-warn)" }}
          >
            {t(done ? `${NS}.done` : `${NS}.open`)}
          </span>
        )}
        <span style={{ fontWeight: 600 }}>
          {n}. {title}
        </span>
      </span>
      {children}
    </li>
  );
}

/**
 * Admin → Instanz: what trip sharing across servers needs, each with its live state and, while
 * open, the button to the control that fixes it (owner 2026-10-26). Read from the same
 * `GET /admin/federation` answer the section below draws, so the two never disagree.
 */
export default function FederationSetupChecklist({
  state,
  busy,
  onSwitchOn,
  onPing,
  onError,
}: {
  state: FederationState;
  busy: boolean;
  onSwitchOn: () => void;
  onPing: (origin: string) => void;
  onError: (key: string) => void;
}): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const fmt = useDisplayFormat();
  const identityOk = state.fingerprint !== null;
  const gap = identityOk ? null : identityGap(state);
  const admitted = state.peers.some(isAdmitted);

  const copy = (value: string): void => {
    navigator.clipboard.writeText(value).catch((error: unknown) => {
      logger.error("Copying a federation value failed:", error);
      onError(`${NS}.copyFailed`);
    });
  };

  const peerLine = (p: FederationPeer): string => {
    if (!p.enabled) return t(`${NS}.peerSuspended`);
    if (!p.verifiedAt) return t(`${NS}.peerUnreached`);
    return t(`${NS}.peerReached`, { date: fmt.dateTime(p.verifiedAt) });
  };

  return (
    <div
      data-testid="federation-checklist"
      className="flex flex-col rounded-lg p-3"
      style={{ gap: "var(--ts-space-sm)", border: "1px solid var(--ts-border)" }}
    >
      <p style={{ fontWeight: 600 }}>{t(`${NS}.title`)}</p>
      <ol className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <Step n={1} done={identityOk} title={t(`${NS}.identity.title`)}>
          {identityOk && state.origin && state.fingerprint ? (
            <>
              <code className="break-all">{state.origin}</code>
              <code className="break-all t-caption">{state.fingerprint}</code>
              <span className="flex flex-wrap" style={{ gap: "var(--ts-space-xs)" }}>
                <Button onClick={() => copy(state.origin ?? "")}>{t(`${NS}.copyOrigin`)}</Button>
                <Button onClick={() => copy(state.fingerprint ?? "")}>
                  {t(`${NS}.copyFingerprint`)}
                </Button>
              </span>
            </>
          ) : (
            gap && (
              <>
                <p className="t-caption">{t(`${NS}.identity.${gap.gap}`)}</p>
                <span>
                  <Button onClick={() => focusControl(gap.control)}>{t(`${NS}.fix`)}</Button>
                </span>
              </>
            )
          )}
        </Step>

        <Step n={2} done={state.tripSharingEnabled} title={t(`${NS}.switch.title`)}>
          {!state.tripSharingEnabled && (
            <>
              <p className="t-caption">
                {t(identityOk ? `${NS}.switch.off` : `${NS}.switch.afterIdentity`)}
              </p>
              <span>
                <Button variant="primary" disabled={busy || !identityOk} onClick={onSwitchOn}>
                  {t(`${NS}.switchOn`)}
                </Button>
              </span>
            </>
          )}
        </Step>

        <Step n={3} done={admitted} title={t(`${NS}.peers.title`)}>
          {state.peers.length > 0 && (
            <ul className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
              {state.peers.map((p) => (
                <li key={p.origin} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 flex-col">
                    <code className="break-all">{p.origin}</code>
                    <span className="t-caption">{peerLine(p)}</span>
                  </span>
                  {p.enabled && !p.verifiedAt && (
                    <Button disabled={busy || !identityOk} onClick={() => onPing(p.origin)}>
                      {t(`${NS}.ping`)}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="t-caption">{t(`${NS}.peersHint`)}</p>
          {!admitted && identityOk && (
            <span>
              <Button onClick={() => focusControl(CONTROL.peerForm)}>{t(`${NS}.addPeer`)}</Button>
            </span>
          )}
        </Step>

        <Step n={4} done={null} title={t(`${NS}.usersTitle`)}>
          <p className="t-caption">{t(`${NS}.users`)}</p>
        </Step>
      </ol>
    </div>
  );
}
