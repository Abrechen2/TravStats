import { useCallback, useEffect, useState, type JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { logger } from "../../lib/logger";
import {
  mailIntakeApi,
  type MailIntakeStatus,
  type MailSourceInput,
  type MailTlsMode,
} from "../../lib/api/mailIntake";
import { SectionCard, SectionTitle } from "../Settings/SettingsShared";
import { errorText, minuteOf, requestErrorText } from "./mailIntakeCopy";

interface Draft {
  host: string;
  port: string;
  tlsMode: Exclude<MailTlsMode, "none">;
  username: string;
  password: string;
  folder: string;
  enabled: boolean;
}

const EMPTY: Draft = {
  host: "",
  port: "993",
  tlsMode: "tls",
  username: "",
  password: "",
  folder: "TravStats",
  enabled: false,
};

/**
 * Settings › Import › "Buchungsmails automatisch einlesen" (forgejo#313): the
 * personal IMAP folder (mode A), the personal forwarding address (mode B) and
 * the senders allowed to use it. Every failure is shown as its own sentence,
 * with the time of the last run — a red status, not a log line.
 */
export default function MailIntakeSettingsCard(): JSX.Element | null {
  const { t } = useTranslation(["mailIntake", "common"]);
  const isDemo = useIsDemoAccount();
  const [status, setStatus] = useState<MailIntakeStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sender, setSender] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await mailIntakeApi.status();
      setStatus(next);
      setLoadFailed(false);
      if (next.source) {
        setDraft({
          host: next.source.host,
          port: String(next.source.port),
          tlsMode: next.source.tlsMode === "starttls" ? "starttls" : "tls",
          username: next.source.username,
          password: "",
          folder: next.source.folder,
          enabled: next.source.enabled,
        });
      }
    } catch (err) {
      logger.error("Failed to load the mail intake settings", err);
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

  const save = (): Promise<void> =>
    run(async () => {
      const input: MailSourceInput = {
        host: draft.host.trim(),
        port: Number(draft.port),
        tlsMode: draft.tlsMode,
        username: draft.username.trim(),
        folder: draft.folder.trim(),
        enabled: draft.enabled,
        ...(draft.password ? { password: draft.password } : {}),
      };
      await mailIntakeApi.saveSource(input);
      await load();
      return null;
    });

  const test = (): Promise<void> =>
    run(async () => {
      const result = await mailIntakeApi.testSource();
      return result.ok
        ? t("mailIntake:status.testOk")
        : (() => {
            throw Object.assign(new Error("test"), {
              response: { data: { code: result.error } },
            });
          })();
    });

  const checkNow = (): Promise<void> =>
    run(async () => {
      const r = await mailIntakeApi.runNow();
      await load();
      if (r.skipped) return t(`mailIntake:status.skipped.${r.skipped}`);
      if (r.error) {
        throw Object.assign(new Error("run"), { response: { data: { code: r.error } } });
      }
      return r.seen === 0
        ? t("mailIntake:status.runNothing")
        : t("mailIntake:status.runResult", { count: r.seen, proposed: r.proposed });
    });

  if (loadFailed) return <p className="t-caption">{t("mailIntake:loadError")}</p>;
  if (!status) return null;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));
  const source = status.source;
  const off = status.off;

  return (
    <SectionCard>
      <SectionTitle title={t("mailIntake:title")} description={t("mailIntake:intro")} />
      {off && <p role="status">{t(`mailIntake:off.${off}`)}</p>}
      {!off && (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
          <section aria-labelledby="mail-folder-title" className="flex flex-col gap-3">
            <h4 id="mail-folder-title" className="t-label-mono">
              {t("mailIntake:folder.title")}
            </h4>
            <p className="t-caption">{t("mailIntake:folder.help")}</p>
            <p className="t-caption">{t("mailIntake:folder.privateNote")}</p>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))" }}
            >
              <label>
                <span className="label">{t("mailIntake:folder.host")}</span>
                <input
                  className="input"
                  value={draft.host}
                  disabled={isDemo || busy}
                  onChange={(e) => set("host", e.target.value)}
                />
              </label>
              <label>
                <span className="label">{t("mailIntake:folder.port")}</span>
                <input
                  className="input"
                  inputMode="numeric"
                  value={draft.port}
                  disabled={isDemo || busy}
                  onChange={(e) => set("port", e.target.value)}
                />
              </label>
              <label>
                <span className="label">{t("mailIntake:folder.security")}</span>
                <select
                  className="input"
                  value={draft.tlsMode}
                  disabled={isDemo || busy}
                  onChange={(e) => {
                    const mode = e.target.value as Draft["tlsMode"];
                    setDraft((d) => ({
                      ...d,
                      tlsMode: mode,
                      port:
                        d.port === "993" || d.port === "143"
                          ? mode === "tls"
                            ? "993"
                            : "143"
                          : d.port,
                    }));
                  }}
                >
                  <option value="tls">{t("mailIntake:folder.tls")}</option>
                  <option value="starttls">{t("mailIntake:folder.starttls")}</option>
                </select>
              </label>
              <label>
                <span className="label">{t("mailIntake:folder.username")}</span>
                <input
                  className="input"
                  autoComplete="off"
                  value={draft.username}
                  disabled={isDemo || busy}
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
                  disabled={isDemo || busy}
                  onChange={(e) => set("password", e.target.value)}
                />
              </label>
              <label>
                <span className="label">{t("mailIntake:folder.name")}</span>
                <input
                  className="input"
                  value={draft.folder}
                  disabled={isDemo || busy}
                  onChange={(e) => set("folder", e.target.value)}
                />
              </label>
            </div>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.enabled}
                disabled={isDemo || busy}
                onChange={(e) => set("enabled", e.target.checked)}
              />
              {t("mailIntake:folder.enabled")}
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={isDemo || busy || !draft.host || !draft.username || !draft.folder}
                onClick={() => void save()}
              >
                {t("mailIntake:folder.save")}
              </button>
              {source && (
                <>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => void test()}
                  >
                    {t("mailIntake:folder.test")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy || !source.enabled}
                    onClick={() => void checkNow()}
                  >
                    {t("mailIntake:folder.run")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isDemo || busy}
                    onClick={() =>
                      void run(async () => {
                        await mailIntakeApi.removeSource();
                        setDraft(EMPTY);
                        await load();
                        return null;
                      })
                    }
                  >
                    {t("mailIntake:folder.remove")}
                  </button>
                </>
              )}
            </div>
            {source && (
              <p className="t-caption" data-testid="mail-source-status" role="status">
                {source.lastError ? (
                  <span style={{ color: "var(--ts-bad)" }}>
                    {`${errorText(t, source.lastError, "mailIntake:errors.protocol_error")} (${source.lastErrorAt ? minuteOf(source.lastErrorAt) : ""})`}
                  </span>
                ) : source.lastOkAt ? (
                  t("mailIntake:status.lastOk", { time: minuteOf(source.lastOkAt) })
                ) : (
                  t("mailIntake:status.never")
                )}
              </p>
            )}
            {message && (
              <p
                role={message.ok ? "status" : "alert"}
                style={message.ok ? undefined : { color: "var(--ts-bad)" }}
              >
                {message.text}
              </p>
            )}
          </section>

          <section aria-labelledby="mail-forward-title" className="flex flex-col gap-3">
            <h4 id="mail-forward-title" className="t-label-mono">
              {t("mailIntake:forwarding.title")}
            </h4>
            {!status.forwardingAvailable ? (
              <p className="t-caption">{t("mailIntake:forwarding.unavailable")}</p>
            ) : (
              <>
                <p className="t-caption">{t("mailIntake:forwarding.help")}</p>
                {status.address ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <code data-testid="mail-address">{status.address}</code>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        void navigator.clipboard
                          ?.writeText(status.address!)
                          .then(() => setCopied(true));
                      }}
                    >
                      {copied ? t("mailIntake:forwarding.copied") : t("mailIntake:forwarding.copy")}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={isDemo || busy}
                      onClick={() =>
                        void run(async () => {
                          await mailIntakeApi.issueAddress();
                          setCopied(false);
                          await load();
                          return null;
                        })
                      }
                    >
                      {t("mailIntake:forwarding.regenerate")}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={isDemo || busy}
                      onClick={() =>
                        void run(async () => {
                          await mailIntakeApi.revokeAddress();
                          await load();
                          return null;
                        })
                      }
                    >
                      {t("mailIntake:forwarding.revoke")}
                    </button>
                    <span className="t-caption">{t("mailIntake:forwarding.regenerateHint")}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="t-caption">{t("mailIntake:forwarding.none")}</span>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={isDemo || busy}
                      onClick={() =>
                        void run(async () => {
                          await mailIntakeApi.issueAddress();
                          await load();
                          return null;
                        })
                      }
                    >
                      {t("mailIntake:forwarding.create")}
                    </button>
                  </div>
                )}
                <h5 className="t-label-mono">{t("mailIntake:forwarding.senders")}</h5>
                <p className="t-caption">{t("mailIntake:forwarding.sendersHelp")}</p>
                {status.senders.length === 0 ? (
                  <p className="t-caption">{t("mailIntake:forwarding.noSenders")}</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {status.senders.map((s) => (
                      <li key={s.id} className="flex items-center gap-2">
                        <span>{s.address}</span>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              setStatus(await mailIntakeApi.removeSender(s.id));
                              return null;
                            })
                          }
                        >
                          {t("mailIntake:forwarding.senderRemove")}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!sender.trim()) return;
                    void run(async () => {
                      setStatus(await mailIntakeApi.addSender(sender.trim()));
                      setSender("");
                      return null;
                    });
                  }}
                >
                  <input
                    className="input"
                    type="email"
                    value={sender}
                    placeholder={t("mailIntake:forwarding.senderPlaceholder")}
                    disabled={isDemo || busy}
                    onChange={(e) => setSender(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="btn-secondary"
                    disabled={isDemo || busy || !sender.trim()}
                  >
                    {t("mailIntake:forwarding.senderAdd")}
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </SectionCard>
  );
}
