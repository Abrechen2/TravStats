import { useTranslation } from "../hooks/useTranslation";

/**
 * Privacy-policy link plus the named controller. Shown wherever usage-stats
 * consent is asked for or changed, so the consent is informed (GDPR Art. 7,
 * Art. 13). The policy URL is a locale string, so it follows the UI language.
 */
export default function UsageStatsLegalNote(): JSX.Element {
  const { t } = useTranslation(["usageStats"]);

  return (
    <p className="text-sm" style={{ color: "var(--text-muted)" }} data-testid="usage-stats-legal">
      <a
        href={t("usageStats:legal.privacyUrl")}
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        {t("usageStats:legal.privacyLink")}
      </a>
      {" · "}
      <span>{t("usageStats:legal.controller")}</span>
    </p>
  );
}
