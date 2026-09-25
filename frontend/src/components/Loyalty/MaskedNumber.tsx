import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { Icon } from "../ui/Icon";

/** Characters left readable at the end — enough to tell two cards apart. */
const VISIBLE_TAIL = 4;
const MASK = "••••";

/**
 * The masked form of a membership number: only the last four characters stay
 * readable, and a number that short is masked whole — showing all of a
 * four-digit number is not masking it.
 */
export function maskNumber(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= VISIBLE_TAIL) return MASK;
  return `${MASK} ${trimmed.slice(-VISIBLE_TAIL)}`;
}

interface Props {
  value: string;
}

/**
 * A membership number, masked until asked for.
 *
 * A loyalty number opens an account — status, points, sometimes bookings —
 * and this page is the kind a user shows someone or shares on a screen. So
 * the number is masked on every render and revealed per card, never
 * remembered: a reload masks it again.
 */
export default function MaskedNumber({ value }: Props): JSX.Element {
  const { t } = useTranslation(["loyalty"]);
  const [revealed, setRevealed] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="t-caption"
        data-testid="masked-number"
        style={{ fontFamily: "var(--ts-font-mono)" }}
      >
        {revealed ? value : maskNumber(value)}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((was) => !was)}
        aria-pressed={revealed}
        aria-label={revealed ? t("loyalty:number.hide") : t("loyalty:number.show")}
        title={revealed ? t("loyalty:number.hide") : t("loyalty:number.show")}
        className="inline-flex items-center"
        style={{ color: "var(--ts-muted)" }}
      >
        <Icon name={revealed ? "eye-off" : "eye"} size={14} />
      </button>
    </span>
  );
}
