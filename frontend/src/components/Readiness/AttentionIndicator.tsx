import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { useTranslation } from "../../hooks/useTranslation";
import { useReadinessShellStore } from "../../store/readinessShellStore";
import { attentionOf, READINESS_PAGE, TONE_COLOR } from "../Settings/readiness/readinessModel";

/** The shell's attention answer, reduced to tone and count (null: nothing to show). */
export function useAttention(): ReturnType<typeof attentionOf> {
  return attentionOf(useReadinessShellStore((s) => s.attention));
}

/**
 * The dot on the account button (owner, 2026-11-23; the demo chip's pattern):
 * amber or red with the count, never a banner. The server already left admin
 * items out for an ordinary account, so what it counts is this viewer's.
 */
export function AttentionDot(): JSX.Element | null {
  const { t } = useTranslation(["readiness"]);
  const attention = useAttention();
  if (!attention) return null;
  return (
    <span
      role="img"
      data-testid="attention-dot"
      data-tone={attention.tone}
      aria-label={t("readiness:attention.dot", { count: attention.count })}
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{
        minWidth: 18,
        height: 18,
        padding: "0 5px",
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        color: "var(--ts-bg)",
        background: TONE_COLOR[attention.tone],
      }}
    >
      {attention.count}
    </span>
  );
}

/** "N Punkte brauchen deine Aufmerksamkeit" in the account menu, linking to the section. */
export function AttentionMenuLine({ onNavigate }: { onNavigate: () => void }): JSX.Element | null {
  const { t } = useTranslation(["readiness"]);
  const coarse = useCoarsePointer();
  const attention = useAttention();
  if (!attention) return null;
  return (
    <Link
      to={READINESS_PAGE}
      role="menuitem"
      data-testid="attention-menu-line"
      onClick={onNavigate}
      className="flex w-full items-center gap-2 px-3 text-left text-sm hover:bg-(--ts-tile)"
      style={{
        minHeight: coarse ? 44 : 36,
        color: TONE_COLOR[attention.tone],
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: TONE_COLOR[attention.tone] }}
      />
      {t("readiness:attention.menuLine", { count: attention.count })}
    </Link>
  );
}
