import Modal from "../Modal";
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
import Pill from "../ui/Pill";
import { token } from "../ui/tokens";
import { Segmented } from "../ui/Segmented";
import { SettingRow, SettingRows } from "../ui/SettingRow";
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
  // The form is folded behind one button, as round 4 draws it: most visits
  // are to read or revoke, and a standing form made the list scroll away.
  const [formOpen, setFormOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newScope, setNewScope] = useState<ApiTokenScope>("read");
  const [justCreated, setJustCreated] = useState<CreatedApiToken | null>(null);
  const [copyOk, setCopyOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Empty dep array on purpose: this only ever runs on mount and after
  // explicit user actions. Using `[t]` here caused an infinite re-render
  // loop because the project's useTranslation wrapper doesn't guarantee
  // a stable `t` reference across renders, so reload's identity changed
  // every render → useEffect fired every render → setLoading(true) →
  // re-render → loop.
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setTokens(await apiTokensApi.list());
    } catch (err) {
      logger.error("Failed to load API tokens", err);
      setError("Failed to load tokens");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setFormOpen(false);
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

      <SettingRows>
        {loading ? (
          <p className="t-caption">{t("common:loading.title")}</p>
        ) : tokens.length === 0 ? (
          <p className="t-caption">{t("settings:apiTokens.empty")}</p>
        ) : (
          tokens.map((tok) => (
            <div key={tok.id} style={{ opacity: tok.revokedAt ? 0.55 : 1 }}>
              <SettingRow
                title={tok.label}
                sub={
                  <span style={{ fontFamily: "var(--ts-font-mono)" }}>
                    {tok.prefix}…
                    {tok.lastUsedAt
                      ? ` · ${t("settings:apiTokens.lastUsed", {
                          when: new Date(tok.lastUsedAt).toLocaleString(),
                        })}`
                      : ` · ${t("settings:apiTokens.neverUsed")}`}
                  </span>
                }
                control={
                  tok.revokedAt ? (
                    <Pill color={token("muted")} dashed>
                      {t("settings:apiTokens.revoked")}
                    </Pill>
                  ) : (
                    <>
                      <Pill color={tok.scope === "read" ? token("good") : token("accent")}>
                        {t(`settings:apiTokens.scopesShort.${tok.scope}`)}
                      </Pill>
                      <button
                        type="button"
                        onClick={() => handleRevoke(tok.id)}
                        className="btn-secondary"
                        style={{ color: "var(--ts-bad)" }}
                      >
                        {t("settings:apiTokens.revokeButton")}
                      </button>
                    </>
                  )
                }
              />
            </div>
          ))
        )}

        {formOpen ? (
          <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
            <label className="label" htmlFor="api-token-label">
              {t("settings:apiTokens.newLabel")}
            </label>
            <input
              id="api-token-label"
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={t("settings:apiTokens.newLabelPlaceholder")}
              className="input"
              disabled={creating}
              maxLength={80}
            />
            <span className="label">{t("settings:apiTokens.scope")}</span>
            <Segmented
              label={t("settings:apiTokens.scope")}
              value={newScope}
              options={SCOPES.map((scope) => ({
                value: scope,
                label: t(`settings:apiTokens.scopesShort.${scope}`),
                name: t(`settings:apiTokens.scopes.${scope}`),
              }))}
              onChange={setNewScope}
              disabled={creating}
            />
            <p className="t-caption">{t(`settings:apiTokens.scopes.${newScope}`)}</p>
            <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating || !newLabel.trim()}
                className="btn-primary"
              >
                {creating ? t("common:loading.title") : t("settings:apiTokens.create")}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setFormOpen(false);
                  setError(null);
                }}
              >
                {t("common:buttons.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button type="button" className="btn-primary" onClick={() => setFormOpen(true)}>
              {t("settings:apiTokens.create")}
            </button>
          </div>
        )}

        <SettingRow
          title={t("settings:apiTokens.docsTitle")}
          sub={t("settings:apiTokens.docsBody")}
          control={
            <a
              href="/api/v1/docs"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--ts-accent)", fontWeight: 600 }}
            >
              {t("settings:apiTokens.docsLink")}
            </a>
          }
        />
      </SettingRows>

      {error && (
        <p role="alert" className="t-caption" style={{ color: "var(--ts-bad)" }}>
          {error}
        </p>
      )}

      {/* Just-created dialog — plaintext shown ONCE */}
      <Modal
        open={justCreated !== null}
        onClose={dismissJustCreated}
        title={t("settings:apiTokens.justCreatedTitle")}
        maxWidth={512}
        closeLabel={t("settings:apiTokens.dismiss")}
        footer={
          <button
            type="button"
            onClick={dismissJustCreated}
            className="rounded-md px-4 py-2 text-sm"
            style={{
              background: "transparent",
              border: "1px solid var(--color-border)",
              color: "var(--text-primary)",
            }}
          >
            {t("settings:apiTokens.dismiss")}
          </button>
        }
      >
        <div className="space-y-4">
          <div
            className="rounded-md p-3 text-sm"
            style={{
              background: "color-mix(in srgb, var(--ts-warn) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--ts-warn) 30%, transparent)",
              color: "var(--text-primary)",
            }}
          >
            {t("settings:apiTokens.justCreatedWarning")}
          </div>
          <div className="space-y-2">
            <code
              className="block rounded-md p-3 font-mono text-xs break-all"
              style={{
                background: "var(--bg-muted)",
                border: "1px solid var(--color-border)",
                color: "var(--text-primary)",
              }}
            >
              {justCreated?.plaintext}
            </code>
            <button
              type="button"
              onClick={copyPlaintext}
              className="rounded-md px-3 py-1.5 text-sm"
              style={{ background: "var(--accent)", color: "var(--ts-accent-text)" }}
            >
              {copyOk ? t("settings:apiTokens.copied") : t("settings:apiTokens.copy")}
            </button>
          </div>
        </div>
      </Modal>
    </SectionCard>
  );
}
