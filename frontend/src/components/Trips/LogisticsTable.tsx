import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useSort } from "../../hooks/useSort";
import { useTranslation } from "../../hooks/useTranslation";
import { Table, TableRow, type TableColumn } from "../ui/Table";
import { PanelHeader } from "./TripDetailPanels";
import type { JSX, ReactNode } from "react";

export interface LogisticsRow {
  id: string;
  /** What the date column sorts by (an ISO instant or day); null sorts last. */
  sortWhen: string | null;
  /** The date as it is shown, on the place's own clock. */
  when: ReactNode;
  sortWhat: string;
  what: ReactNode;
  /** The entry's own page. */
  to: string;
}

type Key = "when" | "what";

/**
 * One panel of the trip's logistics tab: flights, cruises, train, bus, ferry
 * all draw the same list — date, what, a way to the entry — and sort the same
 * way (the choice is remembered per panel).
 */
export function LogisticsTable({
  title,
  tableKey,
  testId,
  whatLabel,
  rows,
  monoWhat = false,
}: {
  title: string;
  tableKey: string;
  testId?: string;
  whatLabel: string;
  rows: readonly LogisticsRow[];
  monoWhat?: boolean;
}): JSX.Element {
  const { t, i18n } = useTranslation(["trips", "common"]);
  const accessors = useMemo(
    () => ({ when: (r: LogisticsRow) => r.sortWhen, what: (r: LogisticsRow) => r.sortWhat }),
    []
  );
  const sort = useSort<LogisticsRow, Key>({
    tableKey,
    rows,
    accessors,
    defaultBy: "when",
    locale: i18n.language,
  });
  const dateLabel = t("trips:detail.logistics.date");
  const columns: TableColumn[] = [
    {
      key: "when",
      min: 120,
      onNarrow: "subtitle",
      label: dateLabel,
      sort: sort.columnSort("when", t("common:ui.sortBy", { column: dateLabel })),
    },
    {
      key: "what",
      min: 160,
      grow: 1,
      mono: monoWhat,
      onNarrow: "title",
      label: whatLabel,
      sort: sort.columnSort("what", t("common:ui.sortBy", { column: whatLabel })),
    },
    { key: "open", min: 70, align: "end", onNarrow: "trailing", label: "↗" },
  ];
  return (
    <div
      className="rounded-xl"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      data-testid={testId}
    >
      <PanelHeader>
        {title} ({rows.length})
      </PanelHeader>
      <Table columns={columns} label={title}>
        {sort.rows.map((row) => (
          <TableRow
            key={row.id}
            columns={columns}
            dense
            cells={[
              <span key="w" style={{ color: "var(--text-muted)" }}>
                {row.when}
              </span>,
              row.what,
              <Link key="o" to={row.to} className="text-xs" style={{ color: "var(--accent)" }}>
                {t("trips:detail.logistics.open")}
              </Link>,
            ]}
          />
        ))}
      </Table>
    </div>
  );
}
