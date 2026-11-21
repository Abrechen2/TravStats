import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { EntryTraveller } from "../../lib/api/entryTravellers";
import type { TravelDocument } from "../../lib/api/documents";

/**
 * Who a document is for at THIS entry (plan D7): "Für: Norbert", with the
 * provenance when a parsed passenger name set it. The picker offers the people
 * on the entry; an undecided document says so instead of pretending it is the
 * owner's. Read-only when the entry has no travellers to pick from.
 */
export function DocumentPerson({
  doc,
  travellers,
  disabled,
  onPick,
}: {
  doc: TravelDocument;
  travellers: readonly EntryTraveller[];
  disabled: boolean;
  onPick: (companionId: string | null) => void;
}): JSX.Element | null {
  const { t } = useTranslation(["documents"]);
  const person = doc.forCompanion ?? null;
  const source = doc.forSource ?? null;
  if (doc.forSource === undefined && !person) return null; // an older server: nothing to say
  if (travellers.length === 0 && !person && source === null) return null;

  const status = person
    ? t("documents:person.forPerson", { name: person.displayName })
    : source === null
      ? t("documents:person.pickUndecided")
      : t("documents:person.forMe");
  // The picked person can have left the entry: keep them selectable so the select shows the truth.
  const options =
    person && !travellers.some((c) => c.companionId === person.id)
      ? [...travellers, { companionId: person.id, displayName: person.displayName }]
      : travellers;

  return (
    <div
      className="t-caption flex flex-wrap items-center"
      style={{ gap: "var(--ts-space-sm)" }}
      data-testid="document-person"
    >
      <span>{status}</span>
      {source === "auto" && (
        <span data-testid="document-person-auto" style={{ color: "var(--ts-muted)" }}>
          · {t("documents:person.auto")}
        </span>
      )}
      {travellers.length > 0 && (
        <select
          aria-label={t("documents:person.pickLabel", { name: doc.displayName })}
          value={person?.id ?? (source === null ? "undecided" : "")}
          disabled={disabled}
          onChange={(e): void => {
            if (e.target.value === "undecided") return;
            onPick(e.target.value === "" ? null : e.target.value);
          }}
          className="rounded-md border border-border bg-(--bg-surface) px-2 py-1 text-xs pointer-coarse:min-h-(--ts-size-touch-min)"
        >
          {source === null && !person && (
            <option value="undecided" disabled>
              {t("documents:person.pickUndecided")}
            </option>
          )}
          <option value="">{t("documents:person.pickMe")}</option>
          {options.map((c) => (
            <option key={c.companionId} value={c.companionId}>
              {c.displayName}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
