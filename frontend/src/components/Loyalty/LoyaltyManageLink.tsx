import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { LOYALTY_SETTINGS_PATH } from "../../pages/Settings/settingsModel";

interface Props {
  testId: string;
  className?: string;
}

/**
 * Where every loyalty programme of every domain is managed (Einstellungen →
 * Bonusprogramme). A plain anchor that opens a new tab, on purpose: the
 * pickers that carry it sit inside open forms, and leaving by a router
 * navigation would drop what the user has typed.
 */
export default function LoyaltyManageLink({ testId, className }: Props): JSX.Element {
  const { t } = useTranslation(["loyalty"]);
  return (
    <a
      href={LOYALTY_SETTINGS_PATH}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      className={className ?? "text-xs text-[var(--accent)] hover:underline"}
    >
      {t("loyalty:manageAll")}
    </a>
  );
}
