import { useCallback, useEffect, useState, type JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { mailIntakeApi, type MailSourceView, type MailTlsMode } from "../../lib/api/mailIntake";
import { SectionCard, SectionTitle } from "../Settings/SettingsShared";
import { errorText, minuteOf, requestErrorText } from "./mailIntakeCopy";

interface Draft {
  host: string;
  port: string;
  tlsMode: MailTlsMode;
  username: string;
  password: string;
  address: string;
  authservId: string;
  folder: string;
  enabled: boolean;
}

const EMPTY: Draft = {
  host: "",
  port: "993",
  tlsMode: "tls",
  username: "",
  password: "",
  address: "",
  authservId: "",
  folder: "INBOX",
  enabled: false,
};

/**
 * Administration › Instanz: the one mailbox behind every account's forwarding
 * address (forgejo#313). Unlike a personal folder it may sit on the LAN and
 * may use plain IMAP; it stays off until the admin switches it on.
 */
export default function MailIntakeAdminCard(): JSX.Element | null {
  const { t } = useTranslation(["mailIntake", "common"]);
  const [source, setSource] = useState<MailSourceView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const { source: next } = await mailIntakeApi.instance();
      setSource(next);
      setLoaded(true);
      if (next) {
        setDraft({
          host: next.host,
          port: String(next.port),
          tlsMode: next.tlsMode,
          username: next.username,
          password: "",
          address: next.address ?? "",
          authservId: next.authservId ?? "",
          folder: next.folder,
          enabled: next.enabled,
        });
      }
    } catch (err) {
      logger.error("Failed to load the instance mailbox", err);
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<string | null>): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const ok = await work();
      if (ok) setMessage({ ok: true, text: ok });
    } catch (err) {
      setMessage({ ok: false, text: requestErrorText(t, err) });
    } finally {
      setBusy(false);
    }
  };

  if (loadFailed) return <p className="t-caption">{t("mailIntake:loadError")}</p>;
  if (!loaded) return null;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <SectionCard>
      <SectionTitle title={t("mailIntake:admin.title")} description={t("mailIntake:admin.help")} />
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))" }}
      >
        <label>
          <span className="label">{t("mailIntake:folder.host")}</span>
          <input
            className="input"
            value={draft.host}
            disabled={busy}
            onChange={(e) => set("host", e.target.value)}
          />
        </label>
        <label>
          <span className="label">{t("mailIntake:folder.port")}</span>
          <input
            className="input"
            inputMode="numeric"
            value={draft.port}
            disabled={busy}
            onChange={(e) => set("port", e.target.value)}
          />
        </label>
        <label>
          <span className="label">{t("mailIntake:folder.security")}</span>
          <select
            className="input"
            value={draft.tlsMode}
            disabled={busy}
            onChange={(e) => set("tlsMode", e.target.value as MailTlsMode)}
          >
            <option value="tls">{t("mailIntake:folder.tls")}</option>
            <option value="starttls">{t("mailIntake:folder.starttls")}</option>
            <option value="none">{t("mailIntake:folder.none")}</option>
          </select>
        </label>
        <label>
          <span className="label">{t("mailIntake:folder.username")}</span>
          <input
            className="input"
            autoComplete="off"
            value={draft.username}
            disabled={busy}
            onChange={(e) => set("username", e.target.value)}
          />
        </label>
        <label>
          <span className="label">{t("mailIntake:folder.password")}</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={draft.password}
            placeholder={source?.hasPassword ? t("mailIntake:folder.passwordSaved") : ""}
            disabled={busy}
            onChange={(e) => set("password", e.target.value)}
          />
        </label>
        <label>
          <span className="label">{t("mailIntake:admin.address")}</span>
          <input
            className="input"
            type="email"
            value={draft.address}
            disabled={busy}
            onChange={(e) => set("address", e.target.value)}
          />
        </label>
        <label>
          <span className="label">{t("mailIntake:folder.name")}</span>
          <input
            className="input"
            value={draft.folder}
            disabled={busy}
            onChange={(e) => set("folder", e.target.value)}
          />
        </label>
        <label>
          <span className="label">{t("mailIntake:admin.authservId")}</span>
          <input
            className="input"
            value={draft.authservId}
            disabled={busy}
            onChange={(e) => set("authservId", e.target.value)}
          />
          <span className="t-caption">{t("mailIntake:admin.authservHelp")}</span>
        </label>
      </div>
      {draft.tlsMode === "none" && <p className="t-caption">{t("mailIntake:admin.plainNote")}</p>}
      <label className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={busy}
          onChange={(e) => set("enabled", e.target.checked)}
        />
        {t("mailIntake:folder.enabled")}
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !draft.host || !draft.username || !draft.address}
          onClick={() =>
            void run(async () => {
              await mailIntakeApi.saveInstance({
                host: draft.host.trim(),
                port: Number(draft.port),
                tlsMode: draft.tlsMode,
                username: draft.username.trim(),
                address: draft.address.trim(),
                authservId: draft.authservId.trim() || null,
                folder: draft.folder.trim() || "INBOX",
                enabled: draft.enabled,
                ...(draft.password ? { password: draft.password } : {}),
              });
              await load();
              return null;
            })
          }
        >
          {t("mailIntake:folder.save")}
        </button>
        {source && (
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await mailIntakeApi.testInstance();
                  if (!r.ok)
                    throw Object.assign(new Error("test"), {
                      response: { data: { code: r.error } },
                    });
                  return t("mailIntake:status.testOk");
                })
              }
            >
              {t("mailIntake:folder.test")}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await mailIntakeApi.removeInstance();
                  setSource(null);
                  setDraft(EMPTY);
                  return null;
                })
              }
            >
              {t("mailIntake:folder.remove")}
            </button>
          </>
        )}
      </div>
      {source ? (
        <p className="t-caption" data-testid="mail-instance-status" role="status">
          {source.lastError
            ? `${errorText(t, source.lastError, "mailIntake:errors.protocol_error")} (${source.lastErrorAt ? minuteOf(source.lastErrorAt) : ""})`
            : source.lastOkAt
              ? t("mailIntake:status.lastOk", { time: minuteOf(source.lastOkAt) })
              : t("mailIntake:status.never")}
        </p>
      ) : (
        <p className="t-caption">{t("mailIntake:admin.notSet")}</p>
      )}
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          style={message.ok ? undefined : { color: "var(--ts-bad)" }}
        >
          {message.text}
        </p>
      )}
    </SectionCard>
  );
}
