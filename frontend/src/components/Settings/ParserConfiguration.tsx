import { useState, useEffect } from "react";
import { parseApi } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";

interface ProviderEntry {
  provider: string;
  availability: {
    available: boolean;
    reason?: string;
  };
}

interface ProvidersData {
  vision: ProviderEntry[];
  text: ProviderEntry[];
}

interface ParserConfigurationProps {
  className?: string;
}

function ProviderStatusBadge({
  available,
  reason,
}: {
  available: boolean;
  reason?: string;
}): JSX.Element {
  if (available) {
    return (
      <div className="flex items-center gap-1 text-xs text-green-600">
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
        <span>Available</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-xs text-yellow-600" title={reason}>
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
      <span>Unavailable</span>
    </div>
  );
}

export default function ParserConfiguration({
  className = "",
}: ParserConfigurationProps): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const [providers, setProviders] = useState<ProvidersData | null>(null);
  const [loadingProviders, setLoadingProviders] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const providersData = await parseApi.getProviders();
        setProviders(providersData);
      } catch (error) {
        logger.error("Failed to load parser providers:", error);
      } finally {
        setLoadingProviders(false);
      }
    };
    loadData();
  }, []);

  const getProviderStatus = (providerType: "vision" | "text", providerName: string) => {
    if (!providers) return null;
    return providers[providerType]?.find((p) => p.provider === providerName)?.availability ?? null;
  };

  const tesseractStatus = getProviderStatus("vision", "tesseract");
  const regexStatus = getProviderStatus("text", "regex");

  return (
    <div className={`card space-y-4 ${className}`}>
      <div>
        <h2 className="text-xl font-semibold">{t("settings:parser.title")}</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">{t("settings:parser.description")}</p>
      </div>

      <div className="bg-[var(--bg-base)] rounded-lg p-4 space-y-3">
        <p className="text-xs font-medium text-[var(--text-primary)]">Parser Status:</p>

        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--text-muted)]">Tesseract OCR (Boarding Pass)</span>
          {loadingProviders ? (
            <span className="text-xs text-[var(--text-muted)]">{t("common:buttons.loading")}</span>
          ) : tesseractStatus ? (
            <ProviderStatusBadge
              available={tesseractStatus.available}
              reason={tesseractStatus.reason}
            />
          ) : (
            <ProviderStatusBadge available={true} />
          )}
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--text-muted)]">Regex Templates (Email)</span>
          {loadingProviders ? (
            <span className="text-xs text-[var(--text-muted)]">{t("common:buttons.loading")}</span>
          ) : regexStatus ? (
            <ProviderStatusBadge available={regexStatus.available} reason={regexStatus.reason} />
          ) : (
            <ProviderStatusBadge available={true} />
          )}
        </div>
      </div>
    </div>
  );
}
