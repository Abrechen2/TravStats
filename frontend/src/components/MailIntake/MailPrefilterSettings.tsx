import { useState, type JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import {
  MAIL_FETCH_FROM,
  type MailFetchFrom,
  type MailPrefilterDefaults,
} from "../../lib/api/mailIntake";

/** What the privacy block edits; `keepUnread: null` = the default for the folder (INBOX: on). */
export interface PrefilterDraft {
  prefilter: boolean;
  keepUnread: boolean | null;
  fetchFrom: MailFetchFrom;
  senderDomains: string[];
  removedSenderDomains: string[];
  subjectKeywords: string[];
  removedSubjectKeywords: string[];
}

export const EMPTY_PREFILTER: PrefilterDraft = {
  prefilter: true,
  keepUnread: null,
  fetchFrom: "now",
  senderDomains: [],
  removedSenderDomains: [],
  subjectKeywords: [],
  removedSubjectKeywords: [],
};

const DOMAIN_RE = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const normalizeDomain = (value: string): string =>
  value.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");

const toggle = (list: string[], value: string): string[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

interface Props {
  draft: PrefilterDraft;
  folder: string;
  defaults: MailPrefilterDefaults;
  counters: { skipped: number; processed: number } | null;
  disabled: boolean;
  onChange: (next: PrefilterDraft) => void;
}

/**
 * The privacy block of a personal IMAP folder (a private main INBOX): the
 * header-only pre-filter, "do not mark as read", where a fresh cursor starts,
 * and the two lists the filter reads — sender domains and subject words. The
 * defaults stay visible and read-only; each can be switched off, and the user
 * adds their own. Saved with the folder's "Speichern".
 */
export default function MailPrefilterSettings({
  draft,
  folder,
  defaults,
  counters,
  disabled,
  onChange,
}: Props): JSX.Element {
  const { t } = useTranslation(["mailIntake"]);
  const [domain, setDomain] = useState("");
  const [domainInvalid, setDomainInvalid] = useState(false);
  const [word, setWord] = useState("");
  const set = <K extends keyof PrefilterDraft>(key: K, value: PrefilterDraft[K]): void =>
    onChange({ ...draft, [key]: value });
  const keepUnread = draft.keepUnread ?? folder.trim().toUpperCase() === "INBOX";
  const removedWords = new Set(draft.removedSubjectKeywords);
  const removedDomains = new Set(draft.removedSenderDomains);

  const addDomain = (): void => {
    const value = normalizeDomain(domain);
    if (!DOMAIN_RE.test(value)) {
      setDomainInvalid(true);
      return;
    }
    setDomainInvalid(false);
    if (!draft.senderDomains.includes(value)) set("senderDomains", [...draft.senderDomains, value]);
    setDomain("");
  };
  const addWord = (): void => {
    const value = word.trim();
    if (value.length < 2) return;
    if (!draft.subjectKeywords.includes(value)) {
      set("subjectKeywords", [...draft.subjectKeywords, value]);
    }
    setWord("");
  };

  const defaultWord = (w: string): JSX.Element => {
    const off = removedWords.has(w);
    return (
      <li key={w}>
        <button
          type="button"
          className="btn-secondary"
          aria-pressed={!off}
          title={
            off
              ? t("mailIntake:privacy.keywords.switchOn")
              : t("mailIntake:privacy.keywords.switchOff")
          }
          disabled={disabled}
          style={off ? { textDecoration: "line-through", opacity: 0.6 } : undefined}
          onClick={() => set("removedSubjectKeywords", toggle(draft.removedSubjectKeywords, w))}
        >
          {w}
        </button>
      </li>
    );
  };

  return (
    <section
      aria-labelledby="mail-privacy-title"
      className="flex flex-col gap-3"
      data-testid="mail-privacy"
    >
      <h5 id="mail-privacy-title" className="t-label-mono">
        {t("mailIntake:privacy.title")}
      </h5>
      <p className="t-caption">{t("mailIntake:privacy.intro")}</p>
      {counters && (
        <p className="t-caption" data-testid="mail-privacy-counters">
          {t("mailIntake:privacy.counters", {
            processed: counters.processed,
            skipped: counters.skipped,
          })}
        </p>
      )}

      <label className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft.prefilter}
          disabled={disabled}
          onChange={(e) => set("prefilter", e.target.checked)}
        />
        {t("mailIntake:privacy.prefilter")}
      </label>
      {!draft.prefilter && (
        <p role="alert" style={{ color: "var(--ts-bad)" }}>
          {t("mailIntake:privacy.prefilterOffWarning")}
        </p>
      )}

      <label className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          checked={keepUnread}
          disabled={disabled}
          onChange={(e) => set("keepUnread", e.target.checked)}
        />
        {t("mailIntake:privacy.keepUnread")}
      </label>
      <p className="t-caption">{t("mailIntake:privacy.keepUnreadHelp")}</p>

      <label>
        <span className="label">{t("mailIntake:privacy.fetchFrom")}</span>
        <select
          className="input"
          value={draft.fetchFrom}
          disabled={disabled}
          onChange={(e) => set("fetchFrom", e.target.value as MailFetchFrom)}
        >
          {MAIL_FETCH_FROM.map((option) => (
            <option key={option} value={option}>
              {t(`mailIntake:privacy.fetchFromOption.${option}`)}
            </option>
          ))}
        </select>
      </label>
      <p className="t-caption">{t("mailIntake:privacy.fetchFromHelp")}</p>

      <h6 className="t-label-mono">{t("mailIntake:privacy.keywords.title")}</h6>
      <p className="t-caption">{t("mailIntake:privacy.keywords.help")}</p>
      <span className="label">{t("mailIntake:privacy.keywords.defaults")}</span>
      {(
        [
          ["groupDe", defaults.keywords.de],
          ["groupEn", defaults.keywords.en],
        ] as const
      ).map(([group, words]) => (
        <div key={group} className="flex flex-col gap-1">
          <span className="t-caption">{t(`mailIntake:privacy.keywords.${group}`)}</span>
          <ul className="flex flex-wrap gap-1" data-testid={`mail-keywords-${group}`}>
            {words.map(defaultWord)}
          </ul>
        </div>
      ))}
      <span className="label">{t("mailIntake:privacy.keywords.custom")}</span>
      {draft.subjectKeywords.length === 0 ? (
        <p className="t-caption">{t("mailIntake:privacy.keywords.none")}</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {draft.subjectKeywords.map((w) => (
            <li key={w} className="inline-flex items-center gap-1">
              <span>{w}</span>
              <button
                type="button"
                className="btn-secondary"
                disabled={disabled}
                aria-label={`${t("mailIntake:privacy.keywords.remove")}: ${w}`}
                onClick={() =>
                  set(
                    "subjectKeywords",
                    draft.subjectKeywords.filter((v) => v !== w)
                  )
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          className="input"
          value={word}
          placeholder={t("mailIntake:privacy.keywords.placeholder")}
          disabled={disabled}
          onChange={(e) => setWord(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addWord();
            }
          }}
        />
        <button
          type="button"
          className="btn-secondary"
          disabled={disabled || word.trim().length < 2}
          onClick={addWord}
        >
          {t("mailIntake:privacy.keywords.add")}
        </button>
      </div>

      <h6 className="t-label-mono">{t("mailIntake:privacy.senders.title")}</h6>
      <p className="t-caption">{t("mailIntake:privacy.senders.help")}</p>
      <span className="label">{t("mailIntake:privacy.senders.custom")}</span>
      {draft.senderDomains.length === 0 ? (
        <p className="t-caption">{t("mailIntake:privacy.senders.none")}</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {draft.senderDomains.map((d) => (
            <li key={d} className="inline-flex items-center gap-1">
              <span>{d}</span>
              <button
                type="button"
                className="btn-secondary"
                disabled={disabled}
                aria-label={`${t("mailIntake:privacy.senders.remove")}: ${d}`}
                onClick={() =>
                  set(
                    "senderDomains",
                    draft.senderDomains.filter((v) => v !== d)
                  )
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          className="input"
          value={domain}
          placeholder={t("mailIntake:privacy.senders.placeholder")}
          disabled={disabled}
          onChange={(e) => {
            setDomain(e.target.value);
            setDomainInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addDomain();
            }
          }}
        />
        <button
          type="button"
          className="btn-secondary"
          disabled={disabled || !domain.trim()}
          onClick={addDomain}
        >
          {t("mailIntake:privacy.senders.add")}
        </button>
      </div>
      {domainInvalid && (
        <p role="alert" style={{ color: "var(--ts-bad)" }}>
          {t("mailIntake:privacy.senders.invalid")}
        </p>
      )}
      <details>
        <summary className="label">
          {t("mailIntake:privacy.senders.defaults", { count: defaults.senderDomains.length })}
        </summary>
        <ul className="flex flex-col gap-1" data-testid="mail-default-domains">
          {defaults.senderDomains.map((d) => {
            const off = removedDomains.has(d.domain);
            return (
              <li key={d.domain} className="flex flex-wrap items-center gap-2">
                <span style={off ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
                  {d.domain}
                </span>
                <span className="t-caption">{d.brand}</span>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={disabled}
                  aria-pressed={!off}
                  onClick={() =>
                    set("removedSenderDomains", toggle(draft.removedSenderDomains, d.domain))
                  }
                >
                  {off
                    ? t("mailIntake:privacy.senders.switchOn")
                    : t("mailIntake:privacy.senders.switchOff")}
                </button>
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
