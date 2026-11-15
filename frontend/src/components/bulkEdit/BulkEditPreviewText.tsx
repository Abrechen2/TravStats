import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { BulkDomain } from "../../shared/bulkEditFields";
import type { BulkEditPreview, ListPreview } from "./bulkEditModel";

type Translate = (key: string, options?: Record<string, unknown>) => string;

function listLines(
  field: "tags" | "companions",
  preview: ListPreview,
  t: Translate,
  noun: (n: number) => string
): string[] {
  const values = preview.values.join(", ");
  const args = { values, count: preview.change, noun: noun(preview.change) };
  const lines =
    preview.kind === "add"
      ? [t(`bulkEdit:preview.${field}Add`, args)]
      : [
          preview.values.length === 0
            ? t(`bulkEdit:preview.${field}Clear`, args)
            : t(`bulkEdit:preview.${field}Replace`, args),
        ];
  if (preview.kind === "replace" && preview.lost.length > 0) {
    lines.push(t("bulkEdit:preview.lost", { values: preview.lost.join(", ") }));
  }
  return lines;
}

/**
 * What confirming will do, per field, BEFORE it is done (forgejo#405 A4): which
 * values are ADDED and which REPLACED, and to how many of the selected rows.
 * Announced politely, so a screen reader hears it follow the choices.
 */
export default function BulkEditPreviewText({
  domain,
  preview,
  tripName,
}: {
  domain: BulkDomain;
  preview: BulkEditPreview;
  tripName: string;
}): JSX.Element {
  const { t } = useTranslation(["bulkEdit"]);
  const noun = (count: number): string => t(`bulkEdit:noun.${domain}`, { count });
  const sections: Array<{ key: string; title: string; lines: string[] }> = [];
  const already = (count: number) =>
    count > 0 ? [t("bulkEdit:preview.already", { count, noun: noun(count) })] : [];

  if (preview.trip) {
    const p = preview.trip;
    sections.push({
      key: "trip",
      title: t("bulkEdit:field.trip"),
      lines: [
        t("bulkEdit:preview.tripSet", { name: tripName }),
        ...(p.gain > 0
          ? [t("bulkEdit:preview.tripGain", { count: p.gain, noun: noun(p.gain) })]
          : []),
        ...(p.replace > 0
          ? [t("bulkEdit:preview.tripReplace", { count: p.replace, noun: noun(p.replace) })]
          : []),
        ...already(p.already),
      ],
    });
  } else if (preview.tripClear) {
    sections.push({
      key: "trip",
      title: t("bulkEdit:field.trip"),
      lines: [
        t("bulkEdit:preview.tripClear", {
          count: preview.tripClear.remove,
          noun: noun(preview.tripClear.remove),
        }),
        ...already(preview.tripClear.none),
      ],
    });
  }
  for (const field of ["tags", "companions"] as const) {
    const p = preview[field];
    if (p) {
      sections.push({
        key: field,
        title: t(`bulkEdit:field.${field}`),
        lines: [...listLines(field, p, t, noun), ...already(p.already)],
      });
    }
  }
  if (preview.status) {
    sections.push({
      key: "status",
      title: t("bulkEdit:field.status"),
      lines: [
        t(`bulkEdit:preview.status.${preview.status.mode}`, {
          count: preview.status.change,
          noun: noun(preview.status.change),
        }),
        ...already(preview.status.already),
      ],
    });
  }
  for (const field of ["operator", "serviceClass"] as const) {
    const p = preview[field];
    if (p) {
      sections.push({
        key: field,
        title: t(`bulkEdit:field.${field}`),
        lines: [
          t(`bulkEdit:preview.${field}.${p.mode}`, {
            count: p.change,
            noun: noun(p.change),
            value: p.value,
          }),
          ...already(p.already),
        ],
      });
    }
  }
  return (
    <section
      aria-live="polite"
      data-testid="bulk-preview"
      className="rounded-md p-3 text-sm"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}
    >
      <h3 className="font-semibold">{t("bulkEdit:preview.title")}</h3>
      {sections.length === 0 ? (
        <p className="mt-1" style={{ color: "var(--text-muted)" }}>
          {t("bulkEdit:preview.nothing")}
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
