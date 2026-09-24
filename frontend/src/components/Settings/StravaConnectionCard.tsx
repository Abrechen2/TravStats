import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { stravaApi, stravaFailureKind, type StravaStatus } from "../../lib/api/strava";
import { SectionCard, SectionTitle } from "./SettingsShared";
import DemoLockedNotice from "./DemoLockedNotice";
import { token } from "../ui/tokens";

/**
 * Strava (2.7). Three states, each saying what to do next:
 *
 * - not configured — the instance has no Strava application. An admin sees
 *   the two fields to register one (their own; TravStats ships none) and the
 *   callback domain Strava will ask for. Everybody else is told who to ask.
 * - configured, not connected — one button to Strava's consent page.
 * - connected — which account, and a way out.
 *
 * Strava's terms are stated where the reader decides: their Strava data is
 * shown to them only, and never to the AI summary.
 */
export default function StravaConnectionCard({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  const isDemo = useIsDemoAccount();
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [adminSecretSet, setAdminSecretSet] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setStatus(await stravaApi.status());
      if (isAdmin) {
        const admin = await stravaApi.admin.get();
        setClientId(admin.clientId ?? "");
        setAdminSecretSet(admin.secretSet);
      }
    } catch {
      setError(t("roadtrips:strava.loadError"));
    }
  }, [isAdmin, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const fail = (err: unknown): void => {
    const kind = stravaFailureKind(err);
    setError(kind ? t(`roadtrips:strava.failure.${kind}`) : t("roadtrips:strava.genericError"));
  };

  const connect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      window.location.assign(await stravaApi.authorizeUrl());
    } catch (err) {
      fail(err);
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    try {
      await stravaApi.disconnect();
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const saveAdmin = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await stravaApi.admin.update({
        clientId: clientId.trim() || null,
        ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
      });
      setClientSecret("");
      await load();
    } catch {
      setError(t("roadtrips:strava.adminSaveError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard>
      <SectionTitle
        title={t("roadtrips:strava.title")}
        description={t("roadtrips:strava.subtitle")}
      />
      {isDemo ? (
        <DemoLockedNotice />
      ) : (
        <div className="space-y-3">
          <p className="t-caption">{t("roadtrips:strava.privacy")}</p>

          {status?.connected && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span style={{ color: token("good") }}>
                {t("roadtrips:strava.connected", { athlete: status.athleteId ?? "?" })}
              </span>
              <button
                type="button"
                disabled={busy}
                className="btn-secondary"
                onClick={() => void disconnect()}
              >
                {t("roadtrips:strava.disconnect")}
              </button>
            </div>
          )}

          {status && status.configured && !status.connected && (
            <button
              type="button"
              disabled={busy}
              className="btn-primary"
              onClick={() => void connect()}
            >
              {t("roadtrips:strava.connect")}
            </button>
          )}

          {status && !status.configured && !isAdmin && (
            <p className="text-sm">{t("roadtrips:strava.askAdmin")}</p>
          )}

          {isAdmin && (
            <details className="text-sm" open={status !== null && !status.configured}>
              <summary className="cursor-pointer">{t("roadtrips:strava.adminTitle")}</summary>
              <div className="mt-2 space-y-2">
                <p className="t-caption">
                  {t("roadtrips:strava.adminHelp", { domain: window.location.hostname })}
                </p>
                <label className="label" htmlFor="strava-client-id">
                  {t("roadtrips:strava.clientId")}
                </label>
                <input
                  id="strava-client-id"
                  className="input"
                  inputMode="numeric"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
                <label className="label" htmlFor="strava-client-secret">
                  {t("roadtrips:strava.clientSecret")}
                </label>
                <input
                  id="strava-client-secret"
                  type="password"
                  autoComplete="off"
                  className="input"
                  placeholder={adminSecretSet ? t("roadtrips:strava.secretStored") : ""}
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                />
                <button
                  type="button"
                  disabled={busy}
                  className="btn-primary"
                  onClick={() => void saveAdmin()}
                >
                  {t("roadtrips:strava.adminSave")}
                </button>
              </div>
            </details>
          )}

          {error && (
            <p role="alert" className="text-sm" style={{ color: token("bad") }}>
              {error}
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
}
