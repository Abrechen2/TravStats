import type { ReactNode } from "react";
import type { JSX } from "react";
import type { Lodging } from "../../types/lodging";
import type { LodgingSortKey } from "./sortLodgingRows";
import { StarRating } from "./StarRating";
import { ChainNameLink } from "./ChainNameLink";
import { LodgingStatusTag } from "./LodgingStatusTag";
import { StayStatusPill } from "./StayStatusPill";
import { lodgingLifecycleStatus } from "./lodgingLifecycle";
import { hasOtherBaseCurrencySpend, LodgingSpendCell } from "./LodgingSpendCell";
import { lodgingTypeIcon } from "../../lib/lodgingFormat";
import { FlagImg, resolveCountryCode } from "../../lib/countryFlag";
import { formatDateInTimezone } from "../../lib/dateUtils";
import { latestStayDayOf } from "../../lib/lodgingLatestStay";
import { RowActionButton, RowActions } from "../table/RowActionButton";
import { TableRow, type TableColumn } from "../ui/Table";
import type { NarrowPlace } from "../table/narrowColumns";
import { useTranslation } from "../../hooks/useTranslation";

/** Every column, sortable or not. `actions` carries no value to sort by. */
export type LodgingColumnId = LodgingSortKey | "actions";

export const LODGING_COLUMN_IDS: readonly LodgingColumnId[] = [
  "name",
  "chain",
  "location",
  "status",
  "lastStay",
  "stays",
  "nights",
  "rating",
  "spend",
  "actions",
];

/**
 * Where each column goes once the table becomes a row below 640px.
 *
 * The house is the destination, the newest stay says when, the lifecycle pill
 * says what state it is in. Chain, city, counts, rating and spend are read in
 * the house itself — a phone that kept them got a horizontal scrollbar, and a
 * horizontal scrollbar is how the right-hand half of a row becomes invisible.
 */
export const LODGING_COLUMN_LAYOUT: Record<
  LodgingColumnId,
  { width: string; align?: "end"; mono?: boolean; onNarrow?: NarrowPlace }
> = {
  name: { width: "minmax(0,1.6fr)", onNarrow: "title" },
  chain: { width: "minmax(0,1fr)" },
  location: { width: "minmax(0,1fr)" },
  status: { width: "190px", onNarrow: "trailing" },
  lastStay: { width: "130px", mono: true, onNarrow: "subtitle" },
  stays: { width: "84px", align: "end", mono: true },
  nights: { width: "84px", align: "end", mono: true },
  rating: { width: "112px" },
  spend: { width: "132px", align: "end", mono: true },
  actions: { width: "96px", align: "end" },
};

interface Props {
  lodging: Lodging;
  baseCurrency: string;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** The visible columns, in order — the row renders exactly one cell each. */
  columns: readonly TableColumn[];
}

export function LodgingRow({
  lodging: l,
  baseCurrency,
  onOpen,
  onEdit,
  onDelete,
  columns,
}: Props): JSX.Element {
  const { t } = useTranslation(["lodging", "common"]);
  // The hotel's own date: newest stay, planned ones included — the same helper
  // the activity sidebar uses, so the two cannot drift apart.
  const day = latestStayDayOf(l);
  const lifecycle = lodgingLifecycleStatus(l.stays);

  const cell: Record<LodgingColumnId, ReactNode> = {
    name: (
      <>
        <span aria-hidden className="mr-2">
          {lodgingTypeIcon(l.type)}
        </span>
        <span className="font-medium text-[var(--text-primary)]">{l.name}</span>
        {/* A saved-places import can bring in hundreds of houses the user has
            never slept in. Without a mark they are indistinguishable from the
            maintained ones. */}
        {!l.visited && (
          <span
            data-testid={`lodging-bookmarked-${l.id}`}
            title={t("lodging:list.bookmarkedHint")}
            className="ml-2 rounded border border-[var(--color-border)] px-1 py-px text-[10px] text-[var(--text-muted)]"
          >
            {t("lodging:list.bookmarked")}
          </span>
        )}
      </>
    ),
    chain: l.chain ? (
      <ChainNameLink chainId={l.chain.id} name={l.chain.name} />
    ) : (
      t("lodging:field.independent")
    ),
    location:
      l.city || l.country ? (
        <span className="inline-flex items-center gap-1.5">
          <span>{l.city || l.country}</span>
          <FlagImg country={resolveCountryCode(l.country)} height={12} />
        </span>
      ) : (
        "—"
      ),
    // Lifecycle first (like the flights status pill: running / booked / past /
    // cancelled), the data-quality tag beside it.
    status: (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {lifecycle ? (
          <StayStatusPill status={lifecycle} testId={`lodging-lifecycle-${l.id}`} />
        ) : null}
        <LodgingStatusTag lodging={l} />
      </span>
    ),
    lastStay: day ? formatDateInTimezone(day, "UTC") : "—",
    stays: l.stayCount,
    nights: l.nights,
    rating: <StarRating value={l.overallRating} />,
    spend: (
      <>
        <LodgingSpendCell lodging={l} baseCurrency={baseCurrency} />
        {hasOtherBaseCurrencySpend(l.totalSpendBaseByCurrency, baseCurrency) && (
          <span
            className="ml-1 align-super text-[10px] text-[var(--text-muted)]"
            title={t("lodging:list.otherCurrencyHint")}
          >
            *
          </span>
        )}
      </>
    ),
    actions: (
      <RowActions>
        <RowActionButton
          icon="edit"
          label={t("common:buttons.edit")}
          testId={`lodging-edit-${l.id}`}
          onClick={onEdit}
        />
        <RowActionButton
          icon="delete"
          label={t("common:buttons.delete")}
          testId={`lodging-delete-${l.id}`}
          onClick={onDelete}
        />
      </RowActions>
    ),
  };

  return (
    <TableRow
      columns={columns}
      onClick={onOpen}
      cells={columns.map((column) => cell[column.key as LodgingColumnId])}
    />
  );
}
