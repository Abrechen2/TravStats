/**
 * Passkeys, rendered underneath the TOTP block in Settings → Security.
 *
 * A passkey REPLACES the password here rather than adding a step to it, and it
 * also satisfies two-factor on its own — the backend only allows that because
 * it demands user verification, so the authenticator has already asked for a
 * PIN, a fingerprint or a vault unlock.
 */

import { useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

import { useTranslation } from "../../hooks/useTranslation";
import { passkeyApi, type Passkey, type PasskeyUnavailableReason } from "../../lib/api";
import { logger } from "../../lib/logger";

/** Cancelling the OS or password-manager dialog rejects with this. It is a
 *  normal user action, not an error worth showing. */
function isUserCancellation(error: unknown): boolean {
  return error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError");
}

export default function PasskeySection(): JSX.Element {
  const { t, i18n } = useTranslation(["settings", "common"]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [reason, setReason] = useState<PasskeyUnavailableReason | null>(null);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    setPasskeys(await passkeyApi.list());
  };

  // Empty dep array on purpose — see ApiTokensSection: the project's
  // useTranslation wrapper does not give a stable `t`.
  useEffect(() => {
    void (async () => {
      try {
        const status = await passkeyApi.availability();
        // The server judges its CONFIGURED origins; the browser judges the page
        // we are actually on. A plain-http LAN visit to an instance whose
        // tunnel origin is https must see the explanation, not a broken button.
        // Strict false, not falsy: every real browser defines the field; only
        // test DOMs leave it undefined, and those must not hide the feature.
        if (window.isSecureContext === false) {
          setAvailable(false);
          setReason("insecureOrigin");
          return;
        }
        setAvailable(status.available);
        setReason(status.reason);
        if (status.available) await refresh();
      } catch (err) {
        logger.error("Failed to read passkey availability", err);
        setAvailable(false);
        setReason("notConfigured");
      }
    })();
  }, []);

  const add = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const options = await passkeyApi.registerOptions();
      const response = await startRegistration({ optionsJSON: options });
      await passkeyApi.registerVerify(name.trim(), response);
      setAdding(false);
      setName("");
      await refresh();
    } catch (err) {
      if (isUserCancellation(err)) {
        setAdding(false);
        setName("");
        return;
      }
      logger.error("Passkey registration failed", err);
      setError(t("settings:passkeys.addFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setError(null);
    try {
      await passkeyApi.remove(id);
      await refresh();
    } catch (err) {
      logger.error("Passkey removal failed", err);
      setError(t("settings:passkeys.removeFailed"));
    }
  };

  if (available === null) return <div />;

  return (
    <div className="mt-8 pt-6" style={{ borderTop: "1px solid var(--color-border)" }}>
      <h3 className="text-base font-semibold mb-1">{t("settings:passkeys.title")}</h3>
      <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
        {t("settings:passkeys.description")}
      </p>

      {!available && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {reason === "insecureOrigin"
            ? t("settings:passkeys.insecureOrigin")
            : t("settings:passkeys.notConfigured")}
        </p>
      )}

      {available && (
        <div className="space-y-4">
          {passkeys.length === 0 && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("settings:passkeys.none")}
            </p>
          )}

          {passkeys.length > 0 && (
            <ul className="space-y-2">
              {passkeys.map((key) => (
                <li
                  key={key.id}
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                  style={{ background: "var(--bg-elevated)" }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{key.name}</p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {t("settings:passkeys.rpIdLabel")}: {key.rpId}
                      {key.lastUsedAt
                        ? ` · ${t("settings:passkeys.lastUsed")} ${new Date(
                            key.lastUsedAt
                          ).toLocaleDateString(i18n.language)}`
                        : ` · ${t("settings:passkeys.neverUsed")}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary shrink-0"
                    onClick={() => void remove(key.id)}
                  >
                    {t("settings:passkeys.remove")}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!adding && (
            <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
              {t("settings:passkeys.add")}
            </button>
          )}

          {adding && (
            <div className="space-y-2">
              <label
                htmlFor="passkey-name"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("settings:passkeys.nameLabel")}
              </label>
              <input
                id="passkey-name"
                type="text"
                className="input w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("settings:passkeys.namePlaceholder")}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || name.trim().length === 0}
                  onClick={() => void add()}
                >
                  {t("settings:passkeys.confirmAdd")}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setAdding(false);
                    setName("");
                    setError(null);
                  }}
                >
                  {t("common:buttons.cancel")}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div role="alert" className="text-sm text-red-400">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
