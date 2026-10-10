import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import Pill from "../ui/Pill";

interface Props {
  tier: string | null | undefined;
}

/**
 * The status a card holds today, as a badge beside the programme name — what
 * the tester asked to see on a chain's page: "ein Badge mit dem aktuellen
 * Status" (Discord, 2026-09-26). A card without a status draws nothing rather
 * than an empty or placeholder badge.
 */
export default function TierBadge({ tier }: Props): JSX.Element | null {
  const { t } = useTranslation(["loyalty"]);
  const value = tier?.trim();
  if (!value) return null;
  return (
    <span data-testid="tier-badge" aria-label={`${t("loyalty:field.tier")}: ${value}`}>
      <Pill color="var(--ts-accent)">{value}</Pill>
    </span>
  );
}
