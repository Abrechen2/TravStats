import { useTranslation } from "../../hooks/useTranslation";
import type { CountryTier } from "../../types/passport";

/**
 * The evidence strength of one country, as a word rather than a colour alone.
 *
 * Colour carries no meaning on its own here: the label is always rendered, and
 * the tint only reinforces it. A reader who cannot tell the three tints apart
 * still reads "Übernachtet" / "Nur umgestiegen".
 *
 * There are exactly THREE tiers because there are exactly three the data can
 * produce. The design plans a fourth — crossed by road — that only GPS tracks
 * can populate; offering it before a record can carry it would be a category
 * that is permanently empty, which reads as a defect rather than as an
 * honest zero.
 */

const TINT: Record<CountryTier, string> = {
  slept: "var(--accent)",
  visited: "var(--text-secondary)",
  transit: "var(--text-muted)",
};

export default function TierBadge({ tier }: { tier: CountryTier }): JSX.Element {
  const { t } = useTranslation(["passport"]);
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide border whitespace-nowrap"
      style={{ borderColor: TINT[tier], color: TINT[tier] }}
      title={t(`passport:tiers.${tier}Explained`)}
      data-testid={`tier-${tier}`}
    >
      {t(`passport:tiers.${tier}`)}
    </span>
  );
}
