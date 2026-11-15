import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { DomainBulkEditResult } from "../../lib/api/domainBulkEdit";

/**
 * The outcome of a bulk edit, per row (forgejo#405 A4): how many changed, how
 * many were already as asked, and — by name — which failed and why. Only a
 * failure the database caused is sent again; a row that is gone or that moved
 * on elsewhere says so, and a reload of the list shows the truth.
 */
export default function BulkEditResults({
  results,
  labelOf,
}: {
  results: ReadonlyMap<string, DomainBulkEditResult>;
  labelOf: (id: string) => string;
}): JSX.Element {
  const { t } = useTranslation(["bulkEdit"]);
  const all = [...results.values()];
  const count = (status: DomainBulkEditResult["status"]) =>
    all.filter((r) => r.status === status).length;
  const failed = all.filter((r) => r.status === "failed");
  return (
    <section data-testid="bulk-results" className="flex flex-col text-sm" style={{ gap: 8 }}>
      <p role="status" className="font-semibold">
        {t("bulkEdit:result.summary", {
          updated: count("updated"),
          unchanged: count("unchanged"),
          failed: failed.length,
        })}
      </p>
      {failed.length > 0 ? (
        <div role="alert" style={{ color: "var(--danger)" }}>
          <p>{t("bulkEdit:result.failedTitle", { count: failed.length })}</p>
          <ul className="list-disc pl-5">
            {failed.map((r) => (
              <li key={r.id} data-testid={`bulk-failed-${r.id}`}>
                {labelOf(r.id)}: {t(`bulkEdit:result.code.${r.code ?? "UPDATE_FAILED"}`)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
