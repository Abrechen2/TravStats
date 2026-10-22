import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { Abrechen2Wordmark } from "./Abrechen2Wordmark";

const SITE_URL_DE = "https://www.abrechen2.de/";
const SITE_URL_EN = "https://www.abrechen2.de/en/";

/** The maker's site in the reader's language; German is the site's default. */
export function abrechen2SiteUrl(language: string | undefined): string {
  return language?.toLowerCase().startsWith("de") ? SITE_URL_DE : SITE_URL_EN;
}

/**
 * "A project by <abrechen2 />" — a quiet maker credit. The label and the mark
 * form one link, so its accessible name reads "A project by abrechen2".
 */
export function Abrechen2Credit(): JSX.Element {
  const { t, i18n } = useTranslation(["settings"]);
  return (
    <a
      href={abrechen2SiteUrl(i18n.language)}
      target="_blank"
      rel="noopener noreferrer"
      className="t-caption inline-flex flex-wrap items-center"
      style={{ gap: "var(--ts-space-sm)", color: "var(--ts-muted)", textDecoration: "none" }}
    >
      <span>{t("settings:about.madeBy")}</span>
      <span style={{ color: "var(--ts-text)" }}>
        <Abrechen2Wordmark />
      </span>
    </a>
  );
}
