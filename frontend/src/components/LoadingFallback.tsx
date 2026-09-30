import { useTranslation } from "../hooks/useTranslation";

/**
 * The full-screen placeholder while a lazily loaded page arrives. It said
 * "Loading... / Please wait..." in English whatever the UI language
 * (acceptance 2026-09-26); i18n initialises synchronously with suspense off,
 * so the translation is there before the first page chunk is.
 */
export default function LoadingFallback(): JSX.Element {
  const { t } = useTranslation("common");
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--bg-base)" }}
    >
      <div className="text-center">
        <div
          className="text-2xl font-display font-bold mb-2"
          style={{ color: "var(--text-primary)" }}
        >
          {t("common:loading.title")}
        </div>
        <div style={{ color: "var(--text-muted)" }}>{t("common:loading.pleaseWait")}</div>
      </div>
    </div>
  );
}
