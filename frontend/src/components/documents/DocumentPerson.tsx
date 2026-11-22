import type { JSX } from "react";

import Modal from "../Modal";

import { useTranslation } from "../../hooks/useTranslation";
import type { EntryTraveller } from "../../lib/api/entryTravellers";
import type { TravelDocument } from "../../lib/api/documents";

/**
 * Who a document is for at THIS entry (plan D7): "Für: Norbert", with the provenance when a
 * parsed passenger name set it. An undecided document says so instead of pretending it is the
 * owner's. The row shows only this status (owner, 2026-11-22); the choice is made in the row
 * menu's "Für Person …" (`DocumentPersonSelect`, in a dialog).
 */
export function DocumentPerson({ doc }: { doc: TravelDocument }): JSX.Element | null {
  const { t } = useTranslation(["documents"]);
  const person = doc.forCompanion ?? null;
  const source = doc.forSource ?? null;
  if (!showsPerson(doc)) return null;

  const status = person
    ? t("documents:person.forPerson", { name: person.displayName })
    : source === null
      ? t("documents:person.pickUndecided")
      : t("documents:person.forMe");
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
    </div>
  );
}

/** Whether the row has anything to say about its person (an older server sends nothing). */
export function showsPerson(doc: TravelDocument): boolean {
  return !(doc.forSource === undefined && !doc.forCompanion);
}

/** The picker the row menu's "Für Person …" opens: the people on the entry, "Mich / alle" first. */
function DocumentPersonSelect({
  doc,
  travellers,
  disabled,
  onPick,
}: {
  doc: TravelDocument;
  travellers: readonly EntryTraveller[];
  disabled: boolean;
  onPick: (companionId: string | null) => void;
}): JSX.Element {
  const { t } = useTranslation(["documents"]);
  const person = doc.forCompanion ?? null;
  const source = doc.forSource ?? null;
  // The picked person can have left the entry: keep them selectable so the select shows the truth.
  const options =
    person && !travellers.some((c) => c.companionId === person.id)
      ? [...travellers, { companionId: person.id, displayName: person.displayName }]
      : travellers;
  return (
    <select
      aria-label={t("documents:person.pickLabel", { name: doc.displayName })}
      value={person?.id ?? (source === null ? "undecided" : "")}
      disabled={disabled}
      onChange={(e): void => {
        if (e.target.value === "undecided") return;
        onPick(e.target.value === "" ? null : e.target.value);
      }}
      className="w-full rounded-md border border-border bg-(--bg-surface) px-2 py-1 text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
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
  );
}

/** The dialog behind the row menu's "Für Person …": picks, then closes and hands the choice on. */
export function DocumentPersonDialog({
  doc,
  travellers,
  disabled,
  onClose,
  onPick,
}: {
  doc: TravelDocument;
  travellers: readonly EntryTraveller[];
  disabled: boolean;
  onClose: () => void;
  onPick: (companionId: string | null) => void;
}): JSX.Element {
  const { t } = useTranslation(["documents", "common"]);
  return (
    <Modal
      open
      onClose={onClose}
      maxWidth={360}
      closeLabel={t("common:buttons.close")}
      title={t("documents:person.rowAction")}
    >
      <DocumentPersonSelect
        doc={doc}
        travellers={travellers}
        disabled={disabled}
        onPick={(companionId) => {
          onClose();
          onPick(companionId);
        }}
      />
    </Modal>
  );
}
