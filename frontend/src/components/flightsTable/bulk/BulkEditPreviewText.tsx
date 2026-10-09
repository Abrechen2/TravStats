import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import type { BulkEditPreview, ListPreview } from "./bulkEditModel";

type Translate = (key: string, options?: Record<string, unknown>) => string;

function listLines(field: "tags" | "companions", preview: ListPreview, t: Translate): string[] {
  const values = preview.values.join(", ");
  const lines =
    preview.kind === "add"
      ? [t(`flights:bulk.preview.${field}Add`, { values, count: preview.change })]
      : [
          preview.values.length === 0
            ? t(`flights:bulk.preview.${field}Clear`, { count: preview.change })
            : t(`flights:bulk.preview.${field}Replace`, { values, count: preview.change }),
        ];
  if (preview.kind === "replace" && preview.lost.length > 0) {
    lines.push(t("flights:bulk.preview.lost", { values: preview.lost.join(", ") }));
  }
  if (preview.already > 0) {
    lines.push(t("flights:bulk.preview.already", { count: preview.already }));
  }
  return lines;
}

/**
 * What confirming will do, per field, BEFORE it is done (forgejo#217): which
 * values are ADDED and which REPLACED, and to how many of the selected
 * flights. Announced politely, so a screen reader hears it follow the choices.
 */
export default function BulkEditPreviewText({
  preview,
}: {
  preview: BulkEditPreview;
}): JSX.Element {
  const { t } = useTranslation(["flights"]);
  const sections: Array<{ key: string; title: string; lines: string[] }> = [];
  if (preview.trip?.kind === "set") {
    const p = preview.trip;
    sections.push({
      key: "trip",
      title: t("flights:bulk.trip"),
      lines: [
        t("flights:bulk.preview.tripSet", { name: p.tripName }),
        ...(p.gain > 0 ? [t("flights:bulk.preview.tripGain", { count: p.gain })] : []),
        ...(p.replace > 0 ? [t("flights:bulk.preview.tripReplace", { count: p.replace })] : []),
        ...(p.already > 0 ? [t("flights:bulk.preview.already", { count: p.already })] : []),
      ],
    });
  } else if (preview.trip?.kind === "clear") {
    sections.push({
      key: "trip",
      title: t("flights:bulk.trip"),
      lines: [
        t("flights:bulk.preview.tripClear", { count: preview.trip.remove }),
        ...(preview.trip.none > 0
          ? [t("flights:bulk.preview.already", { count: preview.trip.none })]
          : []),
      ],
    });
  }
  if (preview.tags) {
    sections.push({
      key: "tags",
      title: t("flights:bulk.tags"),
      lines: listLines("tags", preview.tags, t),
    });
  }
  if (preview.companions) {
    sections.push({
      key: "companions",
      title: t("flights:bulk.companions"),
      lines: listLines("companions", preview.companions, t),
    });
  }
  return (
    <section
      aria-live="polite"
      data-testid="bulk-preview"
      className="rounded-md p-3 text-sm"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}
    >
      <h3 className="font-semibold">{t("flights:bulk.preview.title")}</h3>
      {sections.length === 0 ? (
        <p className="mt-1" style={{ color: "var(--text-muted)" }}>
          {t("flights:bulk.preview.nothing")}
        </p>
      ) : (
        sections.map((section) => (
          <div key={section.key} className="mt-2" data-testid={`bulk-preview-${section.key}`}>
            <p className="font-medium">{section.title}</p>
            <ul className="list-disc pl-5">
              {section.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
