import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";

export interface SectionChip {
  id: string;
  label: string;
}

interface Props {
  chips: readonly SectionChip[];
  /** The anchor id of a chip's section: `settings-<id>` or `admin-<id>`. */
  anchorOf: (id: string) => string;
  /** The section on screen, marked. */
  active: string | null;
  onJump: (id: string) => void;
}

/**
 * The sections of the page as a row of anchor chips at its top (forgejo#321).
 *
 * The menu names pages now, not sections, so a page with several sections
 * says what is on it here — and nowhere else. A page with one section draws
 * no row: a chip that jumps to the only thing on the page is noise.
 */
export function SectionChips({ chips, anchorOf, active, onJump }: Props): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const coarse = useCoarsePointer();
  if (chips.length < 2) return null;
  return (
    <nav
      aria-label={t("settings:sectionChips")}
      className="flex flex-wrap"
      style={{ gap: "var(--ts-space-sm)" }}
    >
      {chips.map((chip) => {
        const isActive = chip.id === active;
        return (
          <a
            key={chip.id}
            href={`#${anchorOf(chip.id)}`}
            aria-current={isActive ? "location" : undefined}
            onClick={(event) => {
              event.preventDefault();
              onJump(chip.id);
            }}
            className="ts-chip"
            style={{
              display: "inline-flex",
              alignItems: "center",
              // The pointer decides the target size, not the width: an iPad is
              // wide and finger-operated at once.
              minHeight: coarse ? "var(--ts-size-touch-min)" : 34,
              padding: "0 var(--ts-space-lg)",
              borderRadius: "var(--ts-radius-chip)",
              background: isActive ? "var(--ts-tile)" : "transparent",
              color: isActive ? "var(--ts-text-bright)" : "var(--ts-text)",
              border: "1px solid var(--ts-border-button)",
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {chip.label}
          </a>
        );
      })}
    </nav>
  );
}
