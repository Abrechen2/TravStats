/**
 * Personal Access Token (PAT) management UI.
 *
 * Lives under Settings → API Tokens. Lets the user mint a new PAT for
 * use with AI agents / scripts / external apps, view existing tokens
 * (without their plaintext — that's gone after creation), and revoke.
 *
 * Once-revealed UX: the dialog that announces a freshly-created token
 * is dismissable but the plaintext is held only in component state and
 * is dropped as soon as the dialog closes. Refresh = gone forever.
 */

import { useCallback, useEffect, useState } from "react";

import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import {
  apiTokensApi,
  type ApiToken,
  type ApiTokenScope,
  type CreatedApiToken,
} from "../../lib/api/tokens";
import { logger } from "../../lib/logger";

const SCOPES: ApiTokenScope[] = ["read", "write", "admin"];

export default function ApiTokensSection(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newScope, setNewScope] = useState<ApiTokenScope>("read");
  const [justCreated, setJustCreated] = useState<CreatedApiToken | null>(null);
  const [copyOk, setCopyOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setTokens(await apiTokensApi.list());
    } catch (err) {
      logger.error("Failed to load API tokens", err);
      setError(t("settings:apiTokens.errors.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleCreate = async (): Promise<void> => {
    setError(null);
    if (!newLabel.trim()) {
      setError(t("settings:apiTokens.errors.labelRequired"));
      return;
    }
    setCreating(true);
    try {
      const created = await apiTokensApi.create({ label: newLabel.trim(), scope: newScope });
      setJustCreated(created);
      setNewLabel("");
      setNewScope("read");
      void reload();
    } catch (err) {
      logger.error("Failed to create API token", err);
      setError(t("settings:apiTokens.errors.create"));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string): Promise<void> => {
    if (!window.confirm(t("settings:apiTokens.confirmRevoke"))) return;
    try {
      await apiTokensApi.revoke(id);
      void reload();
    } catch (err) {
      logger.error("Failed to revoke API token", err);
      setError(t("settings:apiTokens.errors.revoke"));
    }
  };

  const copyPlaintext = async (): Promise<void> => {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.plaintext);
      setCopyOk(true);
      window.setTimeout(() => setCopyOk(false), 2000);
    } catch {
      // Some browsers block clipboard without HTTPS — leave it visible to copy manually.
    }
  };

  const dismissJustCreated = (): void => {
    setJustCreated(null);
    setCopyOk(false);
  };

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:apiTokens.title")}
        description={t("settings:apiTokens.description")}
      />

      <div
        className="rounded-lg p-4 text-sm"
        style={{
          background: "var(--bg-muted)",
          border: "1px solid var(--color-border)",
          color: "var(--text-muted)",
        }}
      >
        <div className="font-medium mb-2" style={{ color: "var(--text-primary)" }}>
          {t("settings:apiTokens.docsTitle")}
        </div>
        <p className="mb-2">{t("settings:apiTokens.docsBody")}</p>
        <a
          href="/api/v1/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
          style={{ color: "var(--accent)" }}
        >
          {t("settings:apiTokens.docsLink")}
        </a>
      </div>

      {/* Create form */}
      <div className="space-y-3">
        <label className="block text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {t("settings:apiTokens.newLabel")}
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder={t("settings:apiTokens.newLabelPlaceholder")}
            className="mt-1 block w-full rounded-md px-3 py-2 text-sm"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--color-border)",
              color: "var(--text-primary)",
            }}
            disabled={creating}
            maxLength={80}
          />
        </label>

        <label className="block text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {t("settings:apiTokens.scope")}
          <select
            value={newScope}
            onChange={(e) => setNewScope(e.target.value as ApiTokenScope)}
            className="mt-1 block w-full rounded-md px-3 py-2 text-sm"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--color-border)",
              color: "var(--text-primary)",
            }}
            disabled={creating}
          >
            {SCOPES.map((s) => (
              <option key={s} value={s}>
                {t(`settings:apiTokens.scopes.${s}`)}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={handleCreate}
          disabled={creating || !newLabel.trim()}
          className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
          style={{ background: "var(--accent)", color: "white" }}
        >
          {creating ? t("common:loading") : t("settings:apiTokens.create")}
        </button>

        {error && (
          <div className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </div>
        )}
      </div>

      {/* Token list */}
      <div>
        <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          {t("settings:apiTokens.existingTitle")}
        </h3>
        {loading ? (
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("common:loading")}
          </div>
        ) : tokens.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("settings:apiTokens.empty")}
          </div>
        ) : (
          <ul className="space-y-2">
            {tokens.map((tok) => (
              <li
                key={tok.id}
                className="flex items-center justify-between rounded-md p-3"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--color-border)",
                  opacity: tok.revokedAt ? 0.5 : 1,
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate" style={{ color: "var(--text-primary)" }}>
                    {tok.label}
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {t(`settings:apiTokens.scopes.${tok.scope}`)} · {tok.prefix}…
                    {tok.lastUsedAt
                      ? ` · ${t("settings:apiTokens.lastUsed", {
                          when: new Date(tok.lastUsedAt).toLocaleString(),
                        })}`
                      : ` · ${t("settings:apiTokens.neverUsed")}`}
                    {tok.revokedAt && ` · ${t("settings:apiTokens.revoked")}`}
                  </div>
                </div>
                {!tok.revokedAt && (
                  <button
                    type="button"
                    onClick={() => handleRevoke(tok.id)}
                    className="ml-3 px-3 py-1.5 text-xs rounded-md"
                    style={{
                      background: "transparent",
                      border: "1px solid var(--color-border)",
                      color: "var(--danger)",
                    }}
                  >
                    {t("settings:apiTokens.revokeButton")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Just-created modal — plaintext shown ONCE */}
      {justCreated && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="rounded-xl p-6 max-w-lg w-full space-y-4"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--color-border)",
            }}
          >
            <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              {t("settings:apiTokens.justCreatedTitle")}
            </h3>
            <div
              className="text-sm rounded-md p-3"
              style={{
                background: "rgba(245, 158, 11, 0.1)",
                border: "1px solid rgba(245, 158, 11, 0.3)",
                color: "var(--text-primary)",
              }}
            >
              {t("settings:apiTokens.justCreatedWarning")}
            </div>
            <div className="space-y-2">
              <code
                className="block break-all rounded-md p-3 text-xs font-mono"
                style={{
                  background: "var(--bg-muted)",
                  border: "1px solid var(--color-border)",
                  color: "var(--text-primary)",
                }}
              >
                {justCreated.plaintext}
              </code>
              <button
                type="button"
                onClick={copyPlaintext}
                className="px-3 py-1.5 text-sm rounded-md"
                style={{ background: "var(--accent)", color: "white" }}
              >
                {copyOk ? t("settings:apiTokens.copied") : t("settings:apiTokens.copy")}
              </button>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={dismissJustCreated}
                className="px-4 py-2 text-sm rounded-md"
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border)",
                  color: "var(--text-primary)",
                }}
              >
                {t("settings:apiTokens.dismiss")}
              </button>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
