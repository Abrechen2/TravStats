import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import type { FlightBulkEditResult } from "../../../lib/api/flightBulkEdit";

/**
 * The outcome of a bulk edit, per flight (forgejo#217): how many changed, how
 * many were already as asked, and — by name — which failed and why. A failure
 * the database caused can be sent again, ONLY those flights; a flight that no
 * longer exists cannot, and says so.
 */
export default function BulkEditResults({
  results,
  labelOf,
}: {
  results: ReadonlyMap<string, FlightBulkEditResult>;
  labelOf: (flightId: string) => string;
}): JSX.Element {
  const { t } = useTranslation(["flights"]);
  const all = [...results.values()];
  const count = (status: FlightBulkEditResult["status"]) =>
    all.filter((r) => r.status === status).length;
  const failed = all.filter((r) => r.status === "failed");
  return (
    <section data-testid="bulk-results" className="flex flex-col text-sm" style={{ gap: 8 }}>
      <p role="status" className="font-semibold">
        {t("flights:bulk.result.summary", {
          updated: count("updated"),
          unchanged: count("unchanged"),
          failed: failed.length,
        })}
      </p>
      {failed.length > 0 ? (
        <div role="alert" style={{ color: "var(--danger)" }}>
          <p>{t("flights:bulk.result.failedTitle", { count: failed.length })}</p>
          <ul className="list-disc pl-5">
            {failed.map((r) => (
              <li key={r.flightId} data-testid={`bulk-failed-${r.flightId}`}>
                {labelOf(r.flightId)}: {t(`flights:bulk.result.code.${r.code ?? "UPDATE_FAILED"}`)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {count("unchanged") > 0 ? (
        <p style={{ color: "var(--text-muted)" }}>
          {t("flights:bulk.result.unchangedHint", { count: count("unchanged") })}
        </p>
      ) : null}
    </section>
  );
}
