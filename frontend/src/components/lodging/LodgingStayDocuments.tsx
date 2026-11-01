import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { formatStayPeriod } from "../../lib/lodgingDateDisplay";
import type { LodgingStay } from "../../types/lodging";
import DocumentsSection from "../documents/DocumentsSection";
import DetailSection from "../ui/DetailSection";
import { Icon } from "../ui/Icon";

/**
 * The kept originals of a house's stays, on the house's detail page
 * (forgejo#405): the documents hang off the STAY (`/lodging/stays/:id/documents`),
 * and the web used to show them only inside the stay editor, so a booking
 * confirmation was invisible unless the user opened a form to edit.
 *
 * One collapsed row per stay; a stay's list is fetched only when its row is
 * opened, so a house with thirty stays does not send thirty requests on load.
 * A house with a single stay opens it at once.
 */
export function LodgingStayDocuments({
  stays,
}: {
  stays: readonly LodgingStay[];
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["lodging", "documents"]);
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(stays.length === 1 ? [stays[0].id] : [])
  );
  if (stays.length === 0) return null;
  const toggle = (id: string): void =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <DetailSection title={t("documents:title")}>
      <ul className="flex flex-col gap-2">
        {stays.map((stay) => {
          const isOpen = open.has(stay.id);
          return (
            <li key={stay.id} className="flex flex-col gap-2">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggle(stay.id)}
                className="t-body flex w-fit items-center gap-1"
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
              >
                <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={14} />
                {t("lodging:detail.stayDocuments", {
                  period: formatStayPeriod(stay, i18n.language, t),
                })}
              </button>
              {isOpen && (
                <DocumentsSection layout="inline" entry={{ type: "lodgingStay", id: stay.id }} />
              )}
            </li>
          );
        })}
      </ul>
    </DetailSection>
  );
}
