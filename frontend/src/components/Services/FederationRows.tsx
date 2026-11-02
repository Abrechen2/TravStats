import { useRef, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { logger } from "../../lib/logger";
import {
  federationAdminApi,
  federationErrorCode,
  type FederationState,
} from "../../lib/api/federationAdmin";
import Button from "../ui/Button";
import {
  ActionControl,
  ConfirmDialog,
  ErrorLine,
  InputControl,
  SettingItem,
  SwitchControl,
} from "../ui/settings";
import { useExpertRows } from "../Settings/frame/useExpertRows";
import { ConnectionFileDownload, ConnectionQr } from "../Admin/FederationConnectionFile";
import FederationPeerForm, { type PeerValues } from "../Admin/FederationPeerForm";
import FederationSetupChecklist, { CONTROL } from "../Admin/FederationSetupChecklist";
import { useLoaded } from "./useLoaded";
import { useDemoLock } from "./useLockFor";

const NS = "federation";

/**
 * Andere Server: the identity of this server and the servers it trusts.
 * Switches here are not the immediate rows of other cards: each call returns
 * the whole state, so they run one at a time (`busy`) and say their own failure.
 */
export default function FederationRows(): JSX.Element | null {
  const { t } = useTranslation(["settingsRows", "admin"]);
  const fmt = useDisplayFormat();
  const demo = useDemoLock();
  const { isFeatureVisible } = useBetaFeatures();
  const expert = useExpertRows(1);
  const {
    data: state,
    setData,
    failed,
  } = useLoaded<FederationState>(() => federationAdminApi.get());
  const [origin, setOrigin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [rotated, setRotated] = useState(false);
  const [confirmKey, setConfirmKey] = useState(false);

  // Every call answers with the whole state, so two at once would race: they run
  // one after the other, each reading the origin and the switch as they are THEN.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef<{ state: FederationState | null; origin: string | null }>({
    state: null,
    origin: null,
  });
  latest.current = { state, origin };
  const run = (action: () => Promise<FederationState | void>): Promise<boolean> => {
    const job = queue.current.then(async (): Promise<boolean> => {
      setBusy(true);
      setErrorKey(null);
      try {
        const next = (await action()) ?? (await federationAdminApi.get());
        // The next queued job reads this before React has rendered it.
        latest.current = { ...latest.current, state: next };
        setData(next);
        return true;
      } catch (error) {
        logger.error("A federation settings action failed:", error);
        setErrorKey(`${NS}.error.${federationErrorCode(error) ?? "generic"}`);
        return false;
      } finally {
        setBusy(false);
      }
    });
    queue.current = job;
    return job;
  };

  if (failed) return <ErrorLine>{t("admin:federation.error.generic")}</ErrorLine>;
  if (!state) return null;
  const readOnly = state.source === "env";
  const shownOrigin = origin ?? state.origin ?? "";
  const lock =
    demo ??
    (readOnly
      ? { why: "adminForbade" as const, reason: t("admin:federation.envNote") }
      : undefined);
  const generate = async (): Promise<void> => {
    setRotated(false);
    const replacing = Boolean(state.hasKey);
    if (await run(federationAdminApi.generateKey)) setRotated(replacing);
  };

  return (
    <>
      {isFeatureVisible("federatedTripSharing") ? (
        <FederationSetupChecklist
          state={state}
          busy={busy}
          onSwitchOn={() => void run(() => federationAdminApi.setTripSharing(true))}
          onPing={(peer) => void run(() => federationAdminApi.verifyPeer(peer))}
          onError={setErrorKey}
        />
      ) : null}
      <SettingItem
        controlId={CONTROL.federation}
        title={t("settingsRows:services.rows.fedon.t")}
        sub={t("admin:federation.enabledSub")}
        scope="allAccounts"
        locked={lock}
        dependency={
          state.origin || state.enabled
            ? undefined
            : {
                reason: t("admin:federation.error.origin", {
                  defaultValue: t("admin:federation.originHint"),
                }),
              }
        }
        control={
          <SwitchControl
            checked={state.enabled}
            onChange={(on) =>
              void run(() =>
                federationAdminApi.update({
                  enabled: on,
                  origin: latest.current.origin ?? latest.current.state?.origin ?? "",
                })
              )
            }
          />
        }
      />
      {expert || !state.origin ? (
        <SettingItem
          controlId={CONTROL.origin}
          title={t("settingsRows:services.rows.fedorigin.t")}
          sub={t("settingsRows:services.rows.fedorigin.s")}
          expert
          scope="allAccounts"
          locked={lock}
          control={
            <span
              onBlur={() => {
                if (origin && origin !== state.origin) {
                  void run(() =>
                    federationAdminApi.update({
                      enabled: latest.current.state?.enabled ?? state.enabled,
                      origin,
                    })
                  ).then((ok) => ok && setOrigin(null));
                }
              }}
            >
              <InputControl
                type="url"
                value={shownOrigin}
                placeholder="https://travstats.example.org"
                onChange={setOrigin}
              />
            </span>
          }
        />
      ) : null}
      {state.fingerprint && isFeatureVisible("federatedTripSharing") ? (
        <SettingItem
          controlId="federation-trip-sharing"
          title={t("settingsRows:services.rows.fedtrips.t")}
          sub={t("admin:federation.tripSharingSub")}
          scope="allAccounts"
          locked={demo}
          control={
            <SwitchControl
              checked={state.tripSharingEnabled}
              onChange={(on) => void run(() => federationAdminApi.setTripSharing(on))}
            />
          }
        />
      ) : null}
      <SettingItem
        title={t("settingsRows:services.rows.fedkey.t")}
        help={t("settingsRows:services.rows.fedkey.h")}
        scope="allAccounts"
        locked={lock}
        control={
          <span id={CONTROL.key} tabIndex={-1}>
            <ActionControl
              label={t("settingsRows:services.rows.fedkey.btn")}
              busy={busy}
              onClick={() => (state.hasKey ? setConfirmKey(true) : void generate())}
            />
          </span>
        }
      >
        {state.fingerprint ? (
          <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
            <p className="t-caption" style={{ margin: 0 }}>
              {t("admin:federation.fingerprint")}
            </p>
            <code className="break-all">{state.fingerprint}</code>
            {state.publicKey ? (
              <details>
                <summary className="t-label-mono cursor-pointer">
                  {t("admin:federation.showPublicKey")}
                </summary>
                <pre className="t-caption whitespace-pre-wrap break-all">{state.publicKey}</pre>
              </details>
            ) : null}
            {state.origin ? (
              <ConnectionFileDownload
                disabled={busy}
                stale={!readOnly && origin !== null && origin !== state.origin}
                onError={setErrorKey}
              />
            ) : null}
            {state.origin && state.publicKey ? (
              <ConnectionQr
                origin={state.origin}
                publicKey={state.publicKey}
                fingerprint={state.fingerprint}
                stale={!readOnly && origin !== null && origin !== state.origin}
              />
            ) : null}
          </div>
        ) : null}
        {rotated ? (
          <p role="status" className="t-caption" style={{ margin: 0 }}>
            {t("admin:federation.rotatedHint")}
          </p>
        ) : null}
      </SettingItem>
      {state.fingerprint ? (
        <SettingItem
          title={t("settingsRows:services.rows.fedpeers.t")}
          help={t("settingsRows:services.rows.fedpeers.h")}
          scope="allAccounts"
        >
          <ul
            className="flex flex-col"
            style={{ gap: "var(--ts-space-sm)", margin: 0, padding: 0, listStyle: "none" }}
          >
            {state.peers.map((p) => (
              <li
                key={p.origin}
                className="flex flex-wrap items-center justify-between"
                style={{ gap: "var(--ts-space-md)" }}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="break-all">{p.origin}</span>
                  <span className="t-caption">
                    {p.verifiedAt
                      ? t("admin:federation.verifiedAt", { date: fmt.date(p.verifiedAt) }) +
                        (p.leaderboardVersions.includes(1)
                          ? ""
                          : ` · ${t("admin:federation.outdated")}`)
                      : t("admin:federation.unverified")}
                  </span>
                </span>
                <span className="flex" style={{ gap: "var(--ts-space-xs)" }}>
                  <Button
                    variant="secondary"
                    disabled={busy || Boolean(demo)}
                    onClick={() => void run(() => federationAdminApi.verifyPeer(p.origin))}
                  >
                    {t("admin:federation.verify")}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy || !p.enabled || Boolean(demo)}
                    onClick={() => void run(() => federationAdminApi.suspendPeer(p.origin))}
                  >
                    {t("admin:federation.suspend")}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          {demo ? null : (
            <FederationPeerForm
              busy={busy}
              onPin={(peer: PeerValues) =>
                run(() => federationAdminApi.pinPeer({ ...peer, enabled: true }))
              }
              onError={setErrorKey}
            />
          )}
        </SettingItem>
      ) : null}
      {errorKey ? <ErrorLine>{t(errorKey)}</ErrorLine> : null}
      <ConfirmDialog
        open={confirmKey}
        title={t("admin:federation.rotateConfirm.title")}
        affects={t("settingsRows:services.dialogs.fedkey.affects")}
        amount={t("settingsRows:services.dialogs.fedkey.amount")}
        after={t("admin:federation.rotateConfirm.message")}
        confirmLabel={t("admin:federation.rotateConfirm.confirm")}
        busy={busy}
        onConfirm={() => {
          setConfirmKey(false);
          void generate();
        }}
        onCancel={() => setConfirmKey(false)}
      />
    </>
  );
}
