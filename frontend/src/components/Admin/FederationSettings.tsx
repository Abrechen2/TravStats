import { useEffect, useState } from "react";
import type { JSX } from "react";
import {
  federationAdminApi,
  federationErrorCode,
  type FederationState,
} from "../../lib/api/federationAdmin";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import { Button, Field, Input, TextArea, Switch, ListRow, SectionLabel } from "../ui";
import { SectionCard, SectionTitle } from "../Settings/SettingsShared";

const NS = "federation";
const EMPTY_PEER = { origin: "", publicKey: "", fingerprint: "" };

/** Admin → Instanz: this server's identity and the servers it trusts (comparison rework 2026-10-16). */
export default function FederationSettings(): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const fmt = useDisplayFormat();
  const [state, setState] = useState<FederationState | null>(null);
  const [origin, setOrigin] = useState("");
  const [peer, setPeer] = useState(EMPTY_PEER);
  const [busy, setBusy] = useState(false);
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

  const run = async (action: () => Promise<FederationState | void>): Promise<void> => {
    setBusy(true);
    setErrorKey(null);
    let next: FederationState | void;
    try {
      next = await action();
    } catch (error) {
      logger.error("A federation settings action failed:", error);
      setErrorKey(`${NS}.error.${federationErrorCode(error) ?? "generic"}`);
      setBusy(false);
      return;
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
  };

  const pin = (): Promise<void> =>
    run(async () => {
      const next = await federationAdminApi.pinPeer({ ...peer, enabled: true });
      setPeer(EMPTY_PEER);
      return next;
    });

  const readOnly = state?.source === "env";
  return (
    <SectionCard>
      <SectionTitle title={t(`${NS}.title`)} description={t(`${NS}.description`)} />
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
            variant="secondary"
            disabled={busy}
            onClick={() => void run(federationAdminApi.generateKey)}
          >
            {t(`${NS}.generateKey`)}
          </Button>
          {state.fingerprint && <p className="t-caption">{t(`${NS}.rotateWarning`)}</p>}
        </>
      )}
      {state?.fingerprint && (
        <div>
          <p className="t-caption">{t(`${NS}.fingerprint`)}</p>
          <code className="break-all">{state.fingerprint}</code>
          {state.publicKey && (
            <pre className="t-caption whitespace-pre-wrap break-all">{state.publicKey}</pre>
          )}
        </div>
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
          <Field label={t(`${NS}.peerOrigin`)} htmlFor="peer-origin">
            <Input
              id="peer-origin"
              value={peer.origin}
              onChange={(e) => setPeer({ ...peer, origin: e.target.value })}
            />
          </Field>
          <Field label={t(`${NS}.peerKey`)} htmlFor="peer-key">
            <TextArea
              id="peer-key"
              rows={6}
              value={peer.publicKey}
              onChange={(e) => setPeer({ ...peer, publicKey: e.target.value })}
            />
          </Field>
          <Field
            label={t(`${NS}.peerFingerprint`)}
            htmlFor="peer-fingerprint"
            hint={t(`${NS}.peerFingerprintHint`)}
          >
            <Input
              id="peer-fingerprint"
              value={peer.fingerprint}
              onChange={(e) => setPeer({ ...peer, fingerprint: e.target.value.trim() })}
            />
          </Field>
          <Button
            disabled={busy || !peer.origin || !peer.publicKey || !peer.fingerprint}
            onClick={() => void pin()}
          >
            {t(`${NS}.pin`)}
          </Button>
        </>
      )}
      {errorKey && <p role="alert">{t(errorKey)}</p>}
    </SectionCard>
  );
}
