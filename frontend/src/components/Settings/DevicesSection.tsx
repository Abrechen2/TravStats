/**
 * Device management UI — Settings → Geräte.
 *
 * Drives the live device-pairing flow: the user mints a one-time pairing
 * code (POST /pairing/start), we render it as a QR the mobile app scans,
 * and we poll /pairing/status until the phone claims it. Below the pairing
 * panel sits the list of already-paired devices — these are the API tokens
 * that carry a `deviceId` (minted via the claim flow), as opposed to the
 * agent/script tokens shown on the API Tokens page.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import { pairingApi, type PairingStart } from "../../lib/api/pairing";
import { apiTokensApi, type ApiToken } from "../../lib/api/tokens";
import { logger } from "../../lib/logger";

/** Embedded in the QR so the app can show which server it's pairing with. */
const SERVER_NAME = "TravStats";
const POLL_INTERVAL_MS = 2000;

function platformIcon(platform: string | null): string {
  const p = (platform ?? "").toLowerCase();
  if (p.includes("ios") || p.includes("apple") || p.includes("iphone") || p.includes("ipad")) {
    return "🍎";
  }
  if (p.includes("android")) return "🤖";
  return "📱";
}

function formatRemaining(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function DevicesSection(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const [devices, setDevices] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<PairingStart | null>(null);
  const [claimedName, setClaimedName] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  // Empty dep array on purpose — the project's useTranslation wrapper does
  // not guarantee a stable `t` reference, so depending on it would loop the
  // load effect. Same pattern as ApiTokensSection.
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const all = await apiTokensApi.list();
      setDevices(all.filter((tok) => tok.deviceId));
    } catch (err) {
      logger.error("Failed to load devices", err);
      setError(t("settings:devices.errors.load"));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Live countdown + status polling while a pairing session is open and
  // unclaimed. Both intervals stop on claim, on expiry, and on unmount.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (!session || claimedName) return;
    let cancelled = false;
    const expiresMs = new Date(session.expiresAt).getTime();

    const handles = { tick: 0, poll: 0 };
    const stopAll = (): void => {
      window.clearInterval(handles.tick);
      window.clearInterval(handles.poll);
    };

    handles.tick = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= expiresMs) stopAll();
    }, 1000);

    handles.poll = window.setInterval(() => {
      if (Date.now() >= expiresMs) {
        stopAll();
        return;
      }
      void (async () => {
        try {
          const status = await pairingApi.status(session.code);
          if (cancelled) return;
          if (status.claimed) {
            setClaimedName(status.deviceName ?? "");
            void reloadRef.current();
            stopAll();
          }
        } catch (err) {
          logger.error("Failed to poll pairing status", err);
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      stopAll();
    };
  }, [session, claimedName]);

  const handleStart = async (): Promise<void> => {
    setError(null);
    setClaimedName(null);
    setStarting(true);
    try {
      const started = await pairingApi.start();
      setNow(Date.now());
      setSession(started);
    } catch (err) {
      logger.error("Failed to start device pairing", err);
      setError(t("settings:devices.errors.start"));
    } finally {
      setStarting(false);
    }
  };

  const handleClose = (): void => {
    setSession(null);
    setClaimedName(null);
  };

  const handleUnpair = async (id: string): Promise<void> => {
    if (!window.confirm(t("settings:devices.confirmUnpair"))) return;
    try {
      await apiTokensApi.revoke(id);
      void reload();
    } catch (err) {
      logger.error("Failed to unpair device", err);
      setError(t("settings:devices.errors.unpair"));
    }
  };

  const remainingSeconds = session
    ? Math.ceil((new Date(session.expiresAt).getTime() - now) / 1000)
    : 0;
  const expired = !!session && !claimedName && remainingSeconds <= 0;

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:devices.title")}
        description={t("settings:devices.description")}
      />

      {/* Pairing panel */}
      {!session ? (
        <button
          type="button"
          onClick={handleStart}
          disabled={starting}
          className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
          style={{ background: "var(--accent)", color: "white" }}
        >
          {starting ? t("common:loading.title") : t("settings:devices.connectButton")}
        </button>
      ) : (
        <div
          className="rounded-lg p-4 space-y-4"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--color-border)",
          }}
        >
          {claimedName !== null ? (
            <div className="flex flex-col items-center gap-2 py-2 text-center">
              <p className="text-base font-medium" style={{ color: "var(--success)" }}>
                {t("settings:devices.claimed", {
                  name: claimedName || t("settings:devices.unnamedDevice"),
                })}
              </p>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm rounded-md"
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border)",
                  color: "var(--text-primary)",
                }}
              >
                {t("settings:devices.done")}
              </button>
            </div>
          ) : !session.publicUrl ? (
            <div className="space-y-3">
              <div
                className="text-sm rounded-md p-3"
                style={{
                  background: "rgba(245, 158, 11, 0.1)",
                  border: "1px solid rgba(245, 158, 11, 0.3)",
                  color: "var(--text-primary)",
                }}
              >
                {t("settings:devices.noPublicUrl")}
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-1.5 text-sm rounded-md"
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border)",
                  color: "var(--text-primary)",
                }}
              >
                {t("settings:devices.cancel")}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {t("settings:devices.qrTitle")}
              </p>
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG
                  value={JSON.stringify({
                    v: 1,
                    u: session.publicUrl,
                    c: session.code,
                    n: SERVER_NAME,
                  })}
                  size={200}
                  level="M"
                />
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t("settings:devices.qrHint")}
              </p>
              <p
                className="text-sm font-medium"
                style={{ color: expired ? "var(--danger)" : "var(--text-secondary)" }}
              >
                {expired
                  ? t("settings:devices.expired")
                  : t("settings:devices.countdown", {
                      time: formatRemaining(remainingSeconds),
                    })}
              </p>
              <div className="flex gap-2">
                {expired && (
                  <button
                    type="button"
                    onClick={handleStart}
                    disabled={starting}
                    className="px-4 py-2 text-sm rounded-md font-medium disabled:opacity-50"
                    style={{ background: "var(--accent)", color: "white" }}
                  >
                    {t("settings:devices.retry")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-sm rounded-md"
                  style={{
                    background: "transparent",
                    border: "1px solid var(--color-border)",
                    color: "var(--text-primary)",
                  }}
                >
                  {t("settings:devices.cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {/* Device list */}
      <div>
        <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          {t("settings:devices.existingTitle")}
        </h3>
        {loading ? (
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("common:loading.title")}
          </div>
        ) : devices.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("settings:devices.empty")}
          </div>
        ) : (
          <ul className="space-y-2">
            {devices.map((dev) => (
              <li
                key={dev.id}
                className="flex items-center justify-between rounded-md p-3"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--color-border)",
                  opacity: dev.revokedAt ? 0.5 : 1,
                }}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-xl" aria-hidden>
                    {platformIcon(dev.platform)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate" style={{ color: "var(--text-primary)" }}>
                      {dev.label}
                    </div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {dev.lastUsedAt
                        ? t("settings:devices.lastUsed", {
                            when: new Date(dev.lastUsedAt).toLocaleString(),
                          })
                        : t("settings:devices.neverUsed")}
                      {dev.lastUsedIp && ` · ${t("settings:devices.ip", { ip: dev.lastUsedIp })}`}
                      {dev.revokedAt && ` · ${t("settings:devices.revoked")}`}
                    </div>
                  </div>
                </div>
                {!dev.revokedAt && (
                  <button
                    type="button"
                    onClick={() => handleUnpair(dev.id)}
                    className="ml-3 px-3 py-1.5 text-xs rounded-md"
                    style={{
                      background: "transparent",
                      border: "1px solid var(--color-border)",
                      color: "var(--danger)",
                    }}
                  >
                    {t("settings:devices.unpairButton")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
