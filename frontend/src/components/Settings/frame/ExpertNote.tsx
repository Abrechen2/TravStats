import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";

type NoteKind = "settings" | "pages";

/**
 * "2 weitere Einstellungen in der Ansicht „Experte“", with the switch beside
 * it. The standard level hides things; this line is what keeps hiding from
 * reading as missing — the reader sees that there is more and how to get it.
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
  return (
    <p
      className="t-caption flex flex-wrap items-center"
      data-expert-note={kind}
      style={{ gap: "var(--ts-space-sm)", color: "var(--ts-muted)" }}
    >
      <span>
        {t(kind === "pages" ? "settings:level.morePages" : "settings:level.moreSettings", {
          count,
        })}
      </span>
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

/** Said above a section a link opened although the standard level hides it. */
export function DeepLinkedExpertNote({
  messageKey = "settings:level.deepLinkedExpert",
}: {
  messageKey?: string;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const setLevel = useSettingsLevelStore((s) => s.setLevel);
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
        style={{ color: "var(--ts-accent)", fontWeight: 600 }}
      >
        {t("settings:level.showExpert")}
      </button>
    </p>
  );
}

/** Said at the top of a page that belongs to the expert view as a whole. */
export function ExpertPageNotice(): JSX.Element {
  return <DeepLinkedExpertNote messageKey="settings:level.expertPage" />;
}
