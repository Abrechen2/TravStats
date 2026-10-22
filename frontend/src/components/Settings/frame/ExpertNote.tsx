import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";

type NoteKind = "settings" | "pages";

/**
 * "2 weitere Einstellungen in der Ansicht „Experte“", with the switch beside
 * it. The standard level hides things; this line is what keeps hiding from
 * reading as missing — the reader sees that there is more and how to get it.
 *
 * Under a section it is the prototype's dashed footer with "Einblenden"
 * (forgejo#321); under the menu ("2 weitere Seiten") a plain line.
 */
export function ExpertNote({
  count,
  kind = "settings",
}: {
  count: number;
  kind?: NoteKind;
}): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const setLevel = useSettingsLevelStore((s) => s.setLevel);
  const coarse = useCoarsePointer();
  if (count <= 0) return null;
  const footer = kind === "settings";
  return (
    <p
      className="t-caption flex flex-wrap items-center"
      data-expert-note={kind}
      style={{
        gap: "var(--ts-space-sm)",
        color: "var(--ts-muted)",
        ...(footer
          ? {
              justifyContent: "space-between",
              padding: "var(--ts-space-sm) var(--ts-space-lg)",
              border: "1px dashed var(--ts-border-button)",
              borderRadius: "var(--ts-radius-card)",
            }
          : {}),
      }}
    >
      <span>
        {t(footer ? "settings:level.moreSettings" : "settings:level.morePages", { count })}
      </span>
      <button
        type="button"
        onClick={() => setLevel("expert")}
        className={footer ? undefined : "underline"}
        style={{
          color: "var(--ts-accent)",
          fontWeight: 600,
          minHeight: coarse ? "var(--ts-size-touch-min)" : undefined,
        }}
      >
        {t(footer ? "settings:level.reveal" : "settings:level.showExpert")}
      </button>
    </p>
  );
}

/**
 * At the top of a page, at the standard level: how many settings on this page
 * only the expert view draws — whole expert sections and the expert rows of
 * standard ones alike — with "In Experte zeigen" (forgejo#321 prototype). It
 * counts settings, not sections: "1 weiterer Abschnitt" said nothing about
 * how much was behind it.
 */
export function PageExpertNote({ count }: { count: number }): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const setLevel = useSettingsLevelStore((s) => s.setLevel);
  const coarse = useCoarsePointer();
  if (count <= 0) return null;
  return (
    <p
      className="t-caption flex flex-wrap items-center"
      data-expert-note="page"
      data-count={count}
      style={{
        gap: "var(--ts-space-sm)",
        padding: "var(--ts-space-md) var(--ts-space-lg)",
        borderRadius: "var(--ts-radius-card)",
        background: "var(--ts-surface2)",
        border: "1px solid var(--ts-border)",
        color: "var(--ts-text)",
      }}
    >
      <span className="flex-1">{t("settings:level.pageMore", { count })}</span>
      <button
        type="button"
        onClick={() => setLevel("expert")}
        className="btn-secondary"
        style={{ minHeight: coarse ? "var(--ts-size-touch-min)" : undefined }}
      >
        {t("settings:level.showInExpert")}
      </button>
    </p>
  );
}

/** Said above a section a link opened although the standard level hides it. */
export function DeepLinkedExpertNote({
  messageKey = "settings:level.deepLinkedExpert",
}: {
  messageKey?: string;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const setLevel = useSettingsLevelStore((s) => s.setLevel);
  const coarse = useCoarsePointer();
  return (
    <p
      role="status"
      className="t-caption flex flex-wrap items-center"
      style={{
        gap: "var(--ts-space-sm)",
        padding: "var(--ts-space-md) var(--ts-space-lg)",
        borderRadius: "var(--ts-radius-card)",
        background: "var(--ts-surface2)",
        border: "1px solid var(--ts-border)",
        color: "var(--ts-text)",
      }}
    >
      <span>{t(messageKey)}</span>
      <button
        type="button"
        onClick={() => setLevel("expert")}
        className="underline"
        style={{
          color: "var(--ts-accent)",
          fontWeight: 600,
          minHeight: coarse ? "var(--ts-size-touch-min)" : undefined,
        }}
      >
        {t("settings:level.showExpert")}
      </button>
    </p>
  );
}

/**
 * Said above a section whose expert rows a link named: they show although the
 * level would hide them. Only while the level is standard — at expert there is
 * nothing to explain.
 */
export function RevealedRowsNote(): JSX.Element | null {
  const level = useSettingsLevelStore((s) => s.level);
  if (level !== "standard") return null;
  return <DeepLinkedExpertNote messageKey="settings:level.revealedRows" />;
}

/** Said at the top of a page that belongs to the expert view as a whole. */
export function ExpertPageNotice(): JSX.Element {
  return <DeepLinkedExpertNote messageKey="settings:level.expertPage" />;
}
