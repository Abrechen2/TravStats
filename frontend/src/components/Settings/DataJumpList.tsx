import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";

/** Anchor ids of the data page's three parts; the cards carry them. */
export const DATA_PART_ANCHOR = {
  backup: "data-part-backup",
  export: "settings-export",
  import: "data-part-import",
} as const;

const PARTS = ["backup", "export", "import"] as const;

/**
 * Sicherung / Mitnehmen / Einlesen as a jump list at the top of the data page.
 * The page is three long cards (the import one lists every domain's tiles), so
 * on a narrow screen it was a scroll of several thousand pixels with no way to
 * say "I came to import". Nothing is hidden: each link scrolls to its card.
 */
export function DataJumpList(): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const coarse = useCoarsePointer();
  return (
    <nav
      aria-label={t("settingsRows:data.jump.label")}
      data-testid="data-jump-list"
      className="flex flex-wrap"
      style={{ gap: "var(--ts-space-sm)" }}
    >
      {PARTS.map((part) => (
        <a
          key={part}
          href={`#${DATA_PART_ANCHOR[part]}`}
          className="ts-chip"
          onClick={(event) => {
            event.preventDefault();
            const target = document.getElementById(DATA_PART_ANCHOR[part]);
            if (!target) return;
            target.scrollIntoView?.({ block: "start", behavior: "smooth" });
            target.focus({ preventScroll: true });
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: coarse ? "var(--ts-size-touch-min)" : 34,
            padding: "0 var(--ts-space-lg)",
            borderRadius: "var(--ts-radius-chip)",
            border: "1px solid var(--ts-border-button)",
            color: "var(--ts-text)",
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {t(`settingsRows:data.sections.${part}`)}
        </a>
      ))}
    </nav>
  );
}
