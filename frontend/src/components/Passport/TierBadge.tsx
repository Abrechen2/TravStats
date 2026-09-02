import { useTranslation } from "../../hooks/useTranslation";
import type { CountryTier } from "../../types/passport";

/**
 * The evidence strength of one country, as a word rather than a colour alone.
 *
 * Colour carries no meaning on its own here: the label is always rendered, and
 * the tint only reinforces it. A reader who cannot tell the three tints apart
 * still reads "Übernachtet" / "Nur umgestiegen".
 *
 * FOUR tiers, and the two weakest are not the same thing. `transited` is a
 * border crossed on the ground — driving through, which counts by default —
 * while `connection` is a change of planes, which does not. Only a location
 * history can produce the first, so a badge saying "Durchgefahren" appears only
 * on an account that has one; nothing here has to gate it, because a tier no
 * row carries simply never renders.
 *
 * The two share a tint deliberately: they are the two rungs below a stay, and
 * the WORD is what tells them apart. A fourth grey would be a distinction the
 * eye cannot make, dressed as one it can.
 */

const TINT: Record<CountryTier, string> = {
  slept: "var(--accent)",
  visited: "var(--text-secondary)",
  transited: "var(--text-muted)",
  connection: "var(--text-muted)",
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
