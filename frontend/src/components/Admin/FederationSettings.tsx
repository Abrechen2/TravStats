import { useEffect, useState } from "react";
import type { JSX } from "react";
import {
  federationAdminApi,
  federationErrorCode,
  type FederationState,
} from "../../lib/api/federationAdmin";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { logger } from "../../lib/logger";
import { Button, Field, Input, Switch, ListRow, SectionLabel } from "../ui";
import { SectionCard, SectionTitle } from "../Settings/SettingsShared";
import { ConnectionFileDownload } from "./FederationConnectionFile";
import FederationPeerForm, { type PeerValues } from "./FederationPeerForm";
import FederationSetupChecklist from "./FederationSetupChecklist";

const NS = "federation";

/** Admin → Instanz: this server's identity and the servers it trusts (comparison rework 2026-10-16). */
export default function FederationSettings(): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const fmt = useDisplayFormat();
  const { isFeatureVisible } = useBetaFeatures();
  const [state, setState] = useState<FederationState | null>(null);
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [rotated, setRotated] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();
  // The i18n key of the last failure, so a wrong fingerprint, a dead peer and an
  // env-managed identity each get their own sentence instead of one shared shrug.
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    federationAdminApi.get().then(
      (s) => {
        if (!alive) return;
        setState(s);
        setOrigin(s.origin ?? "");
      },
      (error: unknown) => {
        logger.error("Loading the federation settings failed:", error);
        if (alive) setErrorKey(`${NS}.error.${federationErrorCode(error) ?? "generic"}`);
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  /** Runs one action and reloads the state; resolves whether the action itself went through. */
  const run = async (action: () => Promise<FederationState | void>): Promise<boolean> => {
    setBusy(true);
    setErrorKey(null);
    let next: FederationState | void;
    try {
      next = await action();
    } catch (error) {
      logger.error("A federation settings action failed:", error);
      setErrorKey(`${NS}.error.${federationErrorCode(error) ?? "generic"}`);
      setBusy(false);
      return false;
    }
    try {
      setState(next ?? (await federationAdminApi.get()));
    } catch (error) {
      // The action went through; only the list behind it is stale.
      logger.error("Reloading the federation settings failed:", error);
      setErrorKey(`${NS}.error.refresh`);
    } finally {
      setBusy(false);
    }
    return true;
  };

  const pin = (peer: PeerValues): Promise<boolean> =>
    run(() => federationAdminApi.pinPeer({ ...peer, enabled: true }));

  /** A first key needs no question; replacing one cuts every server that pinned the old one. */
  const generateKey = async (): Promise<void> => {
    // `hasKey`, not `fingerprint`: with federation off or no address the fingerprint is null
    // while a stored key still exists, and replacing it would pass without a question.
    const replacing = Boolean(state?.hasKey);
    if (
      replacing &&
      !(await confirm({
        title: t(`${NS}.rotateConfirm.title`),
        message: t(`${NS}.rotateConfirm.message`),
        confirmText: t(`${NS}.rotateConfirm.confirm`),
        destructive: true,
      }))
    )
      return;
    setRotated(false);
    if ((await run(federationAdminApi.generateKey)) && replacing) setRotated(true);
  };

  const readOnly = state?.source === "env";
  return (
    <SectionCard>
      <SectionTitle title={t(`${NS}.title`)} description={t(`${NS}.description`)} />
      {state && isFeatureVisible("federatedTripSharing") && (
        <FederationSetupChecklist
          state={state}
          busy={busy}
          onSwitchOn={() => void run(() => federationAdminApi.setTripSharing(true))}
          onPing={(peer) => void run(() => federationAdminApi.verifyPeer(peer))}
          onError={setErrorKey}
        />
      )}
      {state && readOnly && <p className="t-caption">{t(`${NS}.envNote`)}</p>}
      {state && !readOnly && (
        <>
          <Switch
            id="federation-enabled"
            checked={state.enabled}
            disabled={busy || !origin}
            onChange={(on) => void run(() => federationAdminApi.update({ enabled: on, origin }))}
            label={t(`${NS}.enabled`)}
            sub={t(`${NS}.enabledSub`)}
          />
          <Field label={t(`${NS}.origin`)} htmlFor="federation-origin" hint={t(`${NS}.originHint`)}>
            <Input
              id="federation-origin"
              value={origin}
              placeholder="https://travstats.example.org"
              onChange={(e) => setOrigin(e.target.value)}
              onBlur={() =>
                origin &&
                origin !== state.origin &&
                void run(() => federationAdminApi.update({ enabled: state.enabled, origin }))
              }
            />
          </Field>
          <Button
            id="federation-generate-key"
            variant="secondary"
            disabled={busy}
            onClick={() => void generateKey()}
          >
            {t(`${NS}.generateKey`)}
          </Button>
          {state.hasKey && <p className="t-caption">{t(`${NS}.rotateWarning`)}</p>}
          {rotated && <p role="status">{t(`${NS}.rotatedHint`)}</p>}
        </>
      )}
      {state?.fingerprint && (
        <div>
          <p className="t-caption">{t(`${NS}.fingerprint`)}</p>
          <code className="break-all">{state.fingerprint}</code>
          {state.publicKey && (
            <details>
              <summary className="t-label-mono cursor-pointer">{t(`${NS}.showPublicKey`)}</summary>
              <pre className="t-caption whitespace-pre-wrap break-all">{state.publicKey}</pre>
            </details>
          )}
          {state.origin && (
            <ConnectionFileDownload
              disabled={busy}
              stale={!readOnly && origin !== state.origin}
              onError={setErrorKey}
            />
          )}
        </div>
      )}
      {state?.fingerprint && isFeatureVisible("federatedTripSharing") && (
        // Trip sharing across servers (forgejo#301): settable under env-held identity too.
        <Switch
          id="federation-trip-sharing"
          checked={state.tripSharingEnabled}
          disabled={busy}
          onChange={(on) => void run(() => federationAdminApi.setTripSharing(on))}
          label={t(`${NS}.tripSharing`)}
          sub={t(`${NS}.tripSharingSub`)}
        />
      )}
      {state?.fingerprint && (
        <>
          <SectionLabel>{t(`${NS}.peers`)}</SectionLabel>
          {state.peers.map((p) => (
            <ListRow
              key={p.origin}
              dense
              title={p.origin}
              subtitle={
                p.verifiedAt
                  ? t(`${NS}.verifiedAt`, { date: fmt.date(p.verifiedAt) }) +
                    (p.leaderboardVersions.includes(1) ? "" : ` · ${t(`${NS}.outdated`)}`)
                  : t(`${NS}.unverified`)
              }
              trailing={
                <span className="flex" style={{ gap: "var(--ts-space-xs)" }}>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void run(() => federationAdminApi.verifyPeer(p.origin))}
                  >
                    {t(`${NS}.verify`)}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy || !p.enabled}
                    onClick={() => void run(() => federationAdminApi.suspendPeer(p.origin))}
                  >
                    {t(`${NS}.suspend`)}
                  </Button>
                </span>
              }
            />
          ))}
          <FederationPeerForm busy={busy} onPin={pin} onError={setErrorKey} />
        </>
      )}
      {errorKey && <p role="alert">{t(errorKey)}</p>}
      {confirmDialog}
    </SectionCard>
  );
}
