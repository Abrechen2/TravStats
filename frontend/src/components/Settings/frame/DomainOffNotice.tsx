import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import type { DomainKey } from "../../../shared/domains";
import { DOMAINS } from "../../../shared/domains";

/** Where a domain is switched on: Einstellungen › Darstellung › Bereiche & Farben. */
export const DOMAINS_SETTINGS_PATH = "/settings/display?section=domains";

/**
 * Said on the page of a switched-off domain instead of its settings
 * (forgejo#321 prototype). The page used to vanish and its address to send
 * the reader to the account page, so a bookmark or a link from elsewhere
 * landed somewhere it never pointed and nothing said why.
 */
export function DomainOffNotice({ domain }: { domain: DomainKey }): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const coarse = useCoarsePointer();
  return (
    <div
      role="status"
      data-domain-off={domain}
      className="flex flex-col items-start"
      style={{
        gap: "var(--ts-space-md)",
        padding: "var(--ts-space-lg) var(--ts-space-xl)",
        borderRadius: "var(--ts-radius-card)",
        background: "var(--ts-surface2)",
        border: "1px solid var(--ts-border)",
        color: "var(--ts-text)",
      }}
    >
      <p style={{ fontSize: 14 }}>
        {t("settings:domainOff.message", { domain: t(`common:${DOMAINS[domain].i18nKey}`) })}
      </p>
      <Link
        to={DOMAINS_SETTINGS_PATH}
        className="btn-secondary inline-flex items-center"
        style={{ minHeight: coarse ? "var(--ts-size-touch-min)" : undefined }}
      >
        {t("settings:domainOff.action")}
      </Link>
    </div>
  );
}
