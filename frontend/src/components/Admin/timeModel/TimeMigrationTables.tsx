import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import type { TimeMigrationTableReport } from "../../../types/timeMigration";
import { reasonLabel, tableLabel } from "./timeModelCopy";

/**
 * The report's counts, per table, per reason and per rule (ADR 0002, plan
 * Phase 3b). Every table is listed, zeros included: after a completed run a
 * zero is a measured answer, and a table missing from the list would read as
 * "not looked at". Rules are the backfill's own identifiers — shown as codes,
 * in a mono face, because they name code paths rather than say anything a
 * sentence could.
 */

const CELL = "py-1 pr-3";
const NUM = { fontFamily: "var(--ts-font-mono)" } as const;
const ROW = { borderTop: "1px solid var(--ts-border)" } as const;

export function TimeMigrationTables({
  tables,
}: {
  tables: TimeMigrationTableReport[];
}): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const reasons = tables.flatMap((tbl) => tbl.reasons.map((r) => ({ table: tbl.table, ...r })));
  const rules = tables.flatMap((tbl) => tbl.rules.map((r) => ({ table: tbl.table, ...r })));

  return (
    <div className="flex flex-col gap-4 overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="t-label-mono mb-2 text-left">
          {t("admin:timeModel.report.tables.caption")}
        </caption>
        <thead>
          <tr style={{ color: "var(--ts-muted)" }}>
            <th className={`${CELL} text-left`}>{t("admin:timeModel.report.tables.table")}</th>
            <th className={`${CELL} text-right`}>
              {t("admin:timeModel.report.outcomes.converted")}
            </th>
            <th className={`${CELL} text-right`}>
              {t("admin:timeModel.report.outcomes.alreadyFilled")}
            </th>
            <th className="py-1 text-right">{t("admin:timeModel.report.outcomes.open")}</th>
          </tr>
        </thead>
        <tbody>
          {tables.map((row) => (
            <tr key={row.table} style={ROW}>
              <td className={CELL}>{tableLabel(t, row.table)}</td>
              <td className={`${CELL} text-right`} style={NUM}>
                {row.converted}
              </td>
              <td className={`${CELL} text-right`} style={NUM}>
                {row.alreadyFilled}
              </td>
              <td className="py-1 text-right" style={NUM}>
                {row.open}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {reasons.length > 0 && (
        <table className="w-full text-sm">
          <caption className="t-label-mono mb-2 text-left">
            {t("admin:timeModel.report.tables.reasonsCaption")}
          </caption>
          <tbody>
            {reasons.map((r) => (
              <tr key={`${r.table}|${r.reason}`} style={ROW}>
                <td className={CELL}>{tableLabel(t, r.table)}</td>
                <td className={CELL}>{reasonLabel(t, r.reason)}</td>
                <td className="py-1 text-right" style={NUM}>
                  {r.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rules.length > 0 && (
        <details>
          <summary className="t-label-mono cursor-pointer">
            {t("admin:timeModel.report.tables.rulesCaption")}
          </summary>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {rules.map((r) => (
                <tr key={`${r.table}|${r.rule}|${r.status}`} style={ROW}>
                  <td className={CELL}>{tableLabel(t, r.table)}</td>
                  <td className={CELL} style={NUM}>
                    {r.rule}
                  </td>
                  <td className={CELL}>{t(`admin:timeModel.report.ruleStatus.${r.status}`)}</td>
                  <td className="py-1 text-right" style={NUM}>
                    {r.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
