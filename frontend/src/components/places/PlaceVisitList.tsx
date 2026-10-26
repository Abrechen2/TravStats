import { useMemo, useState } from "react";
import type { JSX } from "react";

import Button from "../ui/Button";
import { statusPillStyle } from "../table/statusPillStyle";
import { useTranslation } from "../../hooks/useTranslation";
import { useTodayZone } from "../../hooks/useTodayZone";
import { useDisplayFormat } from "../../lib/displayFormat";
import { now as clockNow } from "../../shared/time";
import type { PlaceVisit } from "../../types/place";
import {
  PAST_PAGE_SIZE,
  buildVisitList,
  type VisitEntry,
  type VisitFilter,
  type VisitGroup,
} from "./placeVisitListModel";
import { PlaceVisitRow } from "./PlaceVisitRow";

interface Props {
  visits: readonly PlaceVisit[];
  /** The place is in the logbook — decides which zero-visit sentence is true. */
  placeVisited: boolean;
  /** Trip names by id, for the row's trip pill. */
  tripNames: ReadonlyMap<string, string>;
  onAdd: () => void;
  onEdit: (visit: PlaceVisit) => void;
  onDelete: (visit: PlaceVisit) => void;
}

const PANEL = {
  background: "var(--ts-surface)",
  border: "1px solid var(--ts-border)",
} as const;

const FILTERS: readonly VisitFilter[] = ["all", "visited", "planned"];

/**
 * The visits of one place (tester feedback, Discord 2026-10): planned ones on
 * top with the next first, the past by year and newest first, undated at the
 * end — every date in the user's format. A row is a summary; its photos,
 * documents and full note open in place, one row at a time.
 */
export function PlaceVisitList({
  visits,
  placeVisited,
  tripNames,
  onAdd,
  onEdit,
  onDelete,
}: Props): JSX.Element {
  const { t } = useTranslation(["places", "common"]);
  const fmt = useDisplayFormat();
  const fallbackZone = useTodayZone();
  const [filter, setFilter] = useState<VisitFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [pastLimit, setPastLimit] = useState(PAST_PAGE_SIZE);

  const model = useMemo(
    () => buildVisitList(visits, { now: clockNow(), fallbackZone, filter, pastLimit }),
    [visits, fallbackZone, filter, pastLimit]
  );

  const dayText = (e: VisitEntry | null): string | null => (e?.day ? fmt.localDate(e.day) : null);

  const summary = [
    t("places:visitList.summaryVisited", { count: model.summary.visited }),
    model.summary.last && t("places:visitList.summaryLast", { date: dayText(model.summary.last) }),
    model.summary.firstDated &&
      t("places:visitList.summaryFirst", { date: dayText(model.summary.firstDated) }),
    model.summary.next &&
      t("places:visitList.summaryNext", {
        date: [
          dayText(model.summary.next),
          model.summary.next.clock ? fmt.localClock(model.summary.next.clock) : null,
        ]
          .filter(Boolean)
          .join(", "),
      }),
  ]
    .filter(Boolean)
    .join(" · ");

  const filterLabel = (f: VisitFilter): string =>
    f === "all"
      ? t("places:visitList.filterAll")
      : f === "visited"
        ? t("places:visitList.filterVisited", { count: model.counts.visited })
        : t("places:visitList.filterPlanned", { count: model.counts.planned });

  const lastYearIndex = model.groups.map((g) => g.kind).lastIndexOf("year");

  return (
    <section className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="t-label-mono">
          {t("places:detail.visits")} · {model.counts.total}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {model.counts.total > 0 && (
            <div
              role="group"
              aria-label={t("places:visitList.filterLabel")}
              className="flex flex-wrap gap-1.5"
            >
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className="rounded-full px-3.5 text-sm"
                  style={{
                    minHeight: "var(--ts-size-touch-min)",
                    border: `1px solid ${filter === f ? "var(--ts-accent)" : "var(--ts-border-button)"}`,
                    background:
                      filter === f
                        ? "color-mix(in srgb, var(--ts-accent) 14%, transparent)"
                        : "transparent",
                    color: filter === f ? "var(--ts-accent)" : "var(--ts-muted)",
                  }}
                >
                  {filterLabel(f)}
                </button>
              ))}
            </div>
          )}
          <Button variant="primary" onClick={onAdd}>
            + {t("places:detail.addVisit")}
          </Button>
        </div>
      </div>

      {model.counts.total > 0 && (
        <p className="t-caption m-0" data-testid="visit-summary">
          {summary}
        </p>
      )}

      <div className="rounded-[var(--ts-radius-card)] px-2.5 pb-2.5 pt-1" style={PANEL}>
        {model.counts.total === 0 ? (
          /* A place ticked off a curated checklist carries `visited` and no
           * visit row — deliberate, since a checklist tick says "I have been
           * here" without claiming a date. "No visit recorded" under a
           * "Visited" badge would read as a contradiction, so say which of the
           * two states this actually is. */
          <p className="t-caption px-2.5 py-3">
            {placeVisited ? t("places:detail.visitedWithoutVisit") : t("places:detail.noVisits")}
          </p>
        ) : model.groups.length === 0 ? (
          <p className="t-caption px-2 py-4">{t("places:visitList.emptyFilter")}</p>
        ) : (
          model.groups.map((group, i) => (
            <VisitGroupSection
              key={group.kind === "year" ? `y${group.year}` : group.kind}
              group={group}
              renderRow={(entry) => (
                <PlaceVisitRow
                  key={entry.visit.id}
                  entry={entry}
                  open={openId === entry.visit.id}
                  onToggle={() =>
                    setOpenId((cur) => (cur === entry.visit.id ? null : entry.visit.id))
                  }
                  tripName={entry.visit.tripId ? (tripNames.get(entry.visit.tripId) ?? null) : null}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              )}
              more={
                i === lastYearIndex && model.hiddenPast > 0 ? (
                  <Button block onClick={() => setPastLimit((n) => n + PAST_PAGE_SIZE)}>
                    {t("places:visitList.showOlder")}
                  </Button>
                ) : null
              }
            />
          ))
        )}
      </div>
    </section>
  );
}

function VisitGroupSection({
  group,
  renderRow,
  more,
}: {
  group: VisitGroup;
  renderRow: (entry: VisitEntry) => JSX.Element;
  more: JSX.Element | null;
}): JSX.Element {
  const { t } = useTranslation(["places"]);
  const headingId = `visit-group-${group.kind === "year" ? group.year : group.kind}`;
  const label =
    group.kind === "planned"
      ? t("places:visitList.groupPlanned")
      : group.kind === "undated"
        ? t("places:visitList.groupUndated")
        : group.year;
  const hint =
    group.kind === "planned"
      ? t("places:visitList.groupPlannedHint")
      : group.kind === "undated"
        ? t("places:visitList.groupUndatedHint")
        : t("places:visitList.groupYearCount", { count: group.entries.length });
  return (
    <section aria-labelledby={headingId} data-testid={headingId}>
      <h3
        id={headingId}
        className="t-label-mono m-0 flex items-center gap-2.5 px-2 pb-1.5 pt-3.5"
        style={{
          color: group.kind === "planned" ? statusPillStyle("scheduled").color : "var(--ts-muted)",
        }}
      >
        {label}
        <span className="t-caption normal-case tracking-normal">{hint}</span>
        <span
          aria-hidden="true"
          className="h-px flex-1"
          style={{ background: "var(--ts-border)" }}
        />
      </h3>
      <ul className="m-0 list-none p-0">{group.entries.map(renderRow)}</ul>
      {more && <div className="px-2 pb-0.5 pt-2">{more}</div>}
    </section>
  );
}
