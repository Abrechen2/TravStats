import { useEffect, useRef, type JSX } from "react";

import OverflowMenu, { type OverflowEntry } from "../../ui/OverflowMenu";
import { useTranslation } from "../../../hooks/useTranslation";
import type { UnfiledDocument } from "../../../lib/api/documents";
import { formatDate } from "../../../lib/displayFormat";
import { formatBytes } from "../../../lib/fileSize";

interface Props {
  document: UnfiledDocument;
  selected: boolean;
  /** An upload of the same bytes matched this document: it is marked and scrolled into view. */
  highlighted?: boolean;
  onToggle: () => void;
  onPreview: () => void;
  onLink: () => void;
  onEdit: () => void;
  onCreate: () => void;
  onDelete: () => void;
}

/**
 * One unassigned document: select box, name and dates, the two actions people
 * reach for (open, link) and everything else in the row's ⋯ menu — rename,
 * create from it, and delete last, red, confirmed (owner rule 2026-11-22).
 */
export default function UnfiledDocumentRow({
  document,
  selected,
  highlighted = false,
  onToggle,
  onPreview,
  onLink,
  onEdit,
  onCreate,
  onDelete,
}: Props): JSX.Element {
  const { t } = useTranslation(["dataQuality", "documents"]);
  const name = document.displayName;
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [highlighted]);
  const entries: OverflowEntry[] = [
    {
      key: "edit",
      label: t("dataQuality:unfiledDocuments.actions.edit"),
      onSelect: onEdit,
      testId: "unfiled-edit",
    },
    {
      key: "create",
      label: t("dataQuality:unfiledDocuments.actions.create"),
      onSelect: onCreate,
      testId: "unfiled-create",
    },
    {
      key: "delete",
      label: t("dataQuality:unfiledDocuments.actions.delete"),
      onSelect: onDelete,
      danger: true,
      confirm: {
        title: t("dataQuality:unfiledDocuments.delete.title"),
        message: t("dataQuality:unfiledDocuments.delete.message", { name }),
        confirmText: t("dataQuality:unfiledDocuments.actions.delete"),
      },
      testId: "unfiled-delete",
    },
  ];
  const action =
    "rounded-md border border-border px-3 py-1.5 text-sm font-medium pointer-coarse:min-h-(--ts-size-touch-min)";

  return (
    <li
      ref={rowRef}
      data-testid="unfiled-document"
      data-highlighted={highlighted ? "true" : undefined}
      className="flex flex-wrap items-center"
      style={{
        gap: "var(--ts-space-md)",
        borderTop: "1px solid var(--ts-border)",
        paddingTop: "var(--ts-space-md)",
        ...(highlighted
          ? {
              outline: "2px solid var(--ts-accent)",
              outlineOffset: 4,
              borderRadius: 6,
            }
          : {}),
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={t("dataQuality:unfiledDocuments.select", { name })}
      />
      {/* Two dates as <time> elements rather than one interpolated sentence: the
          deletion date is the point of this block, and an ISO `dateTime` beside
          the formatted text is what lets a screen reader — and a test — read the
          date the user was actually promised. */}
      <span className="flex min-w-0 flex-1 flex-col" style={{ color: "var(--ts-text)" }}>
        <span className="truncate">{name}</span>
        <span className="t-caption">
          {document.kind ? `${t(`documents:kind.${document.kind}`)} · ` : ""}
          {formatBytes(document.sizeBytes)} · {t("dataQuality:unfiledDocuments.uploaded")}{" "}
          <time dateTime={document.createdAt}>{formatDate(document.createdAt)}</time>
          {/* Only when the server could date it. It abstains on a row it cannot
              date and so does the sweep, so an absent clause means nothing is
              going to be deleted either. */}
          {document.deletesAt && (
            <>
              {" · "}
              {t("dataQuality:unfiledDocuments.deletesOn")}{" "}
              <time dateTime={document.deletesAt}>{formatDate(document.deletesAt)}</time>
            </>
          )}
        </span>
      </span>
      <button
        type="button"
        onClick={onPreview}
        className={action}
        aria-label={t("dataQuality:unfiledDocuments.previewLabel", { name })}
      >
        {t("dataQuality:unfiledDocuments.open")}
      </button>
      <button
        type="button"
        onClick={onLink}
        className={action}
        aria-label={t("dataQuality:unfiledDocuments.actions.linkLabel", { name })}
      >
        {t("dataQuality:unfiledDocuments.actions.link")}
      </button>
      <OverflowMenu
        entries={entries}
        label={t("documents:rowMenuLabel", { name })}
        testId="unfiled-row-menu"
      />
    </li>
  );
}
