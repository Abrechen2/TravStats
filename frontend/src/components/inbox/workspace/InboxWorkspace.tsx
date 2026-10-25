import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import { dataQualityFlagsApi } from "../../../lib/api/dataQualityFlags";
import type { PhotoJourney } from "../../../types/photoJourney";
import Button from "../../ui/Button";
import { Card } from "../../ui/Card";
import EmptyState from "../../ui/EmptyState";
import { Segmented } from "../../ui/Segmented";
import { GlobeLoader } from "../../GlobeLoader";
import { useVisitReview } from "../visitReview/useVisitReview";
import VisitBatchBar from "../visitReview/VisitBatchBar";
import {
  buildInboxItems,
  filterInbox,
  orderByJourney,
  W,
  type InboxSource,
  type InboxView,
} from "./model";
import { useInboxData } from "./useInboxData";
import { useSuggestionSwitchesStore } from "../../../store/suggestionSwitchesStore";
import { useBetaFeatures } from "../../../hooks/useBetaFeatures";
import InboxCard from "./InboxCard";
import InboxHistory, { HISTORY_SOURCES, type HistorySource } from "./InboxHistory";
import SourcePanel from "./SourcePanel";
import TripContext from "./TripContext";
import WorkspaceToolbar from "./WorkspaceToolbar";
import "./workspace.css";

export const INBOX_SOURCES: readonly InboxSource[] = [
  "review",
  "trips",
  "updates",
  "photos",
  "dawarich",
  "location",
];
const VIEWS: readonly InboxView[] = ["cards", "list", "journey"];

/** What the page's tab label carries: a measured number, and whether every kind answered. */
export interface InboxCount {
  count: number;
  complete: boolean;
}

/**
 * The inbox: every open question and proposal, one card per item, whatever
 * kind it is. `?tab=<kind>` narrows it to one kind (the old per-kind tabs'
 * links keep working), `?view=` picks cards, list or journey, `?item=` a card.
 */
export default function InboxWorkspace({
  photosVisible,
  active = true,
  onCount,
}: {
  photosVisible: boolean;
  active?: boolean;
  onCount?: (count: InboxCount | null) => void;
}) {
  const { t, i18n } = useTranslation(["dataQuality", "common"]);
  const format = useDisplayFormat();
  // The account's suggestion switches (forgejo#306): an off kind has no tab and is not loaded.
  const tripsVisible = useSuggestionSwitchesStore((s) => s.trips);
  const staysVisible = useSuggestionSwitchesStore((s) => s.stays);
  // TravTrack's questions (plan E6) exist only behind its beta key.
  const locationVisible = useBetaFeatures().isFeatureVisible("travTrack");
  const visibility = useMemo(
    () => ({
      photos: photosVisible,
      trips: tripsVisible,
      stays: staysVisible,
      location: locationVisible,
    }),
    [photosVisible, tripsVisible, staysVisible, locationVisible]
  );
  const data = useInboxData(visibility, active);
  const [params, setParams] = useSearchParams();
  const requestedView = params.get("view");
  const view: InboxView =
    requestedView === "list" || requestedView === "journey" ? requestedView : "cards";
  const sources = INBOX_SOURCES.filter(
    (s) =>
      (s !== "photos" || photosVisible) &&
      (s !== "trips" || tripsVisible) &&
      (s !== "dawarich" || staysVisible) &&
      (s !== "location" || locationVisible)
  );
  const requestedSource = params.get("tab");
  const source: InboxSource | "all" = sources.find((s) => s === requestedSource) ?? "all";
  const [query, setQuery] = useState("");
  const [deferred, setDeferred] = useState<ReadonlySet<string>>(new Set());
  const [showDeferred, setShowDeferred] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(params.has("item"));
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const heading = useRef<HTMLDivElement>(null);
  const id = useId();
  const previousSelectionIndex = useRef(0);
  const items = useMemo(
    () => buildInboxItems(data.records, data.trips, t, i18n.language),
    [data.records, data.trips, t, i18n.language]
  );
  const visitJourneys = useMemo(
    () =>
      items.flatMap((item): PhotoJourney[] =>
        item.source === "photos" && item.data.kind === "visit" ? [item.data] : []
      ),
    [items]
  );
  const visitReview = useVisitReview(visitJourneys, data.reload);
  const visible = filterInbox(items, query, source, deferred, showDeferred);
  const visibleKeys = new Set(visible.map((item) => item.key));
  const visibleVisits = visitJourneys.filter((j) => visibleKeys.has(`photos:${j.id}`));
  const selected =
    visible.find((item) => item.key === params.get("item")) ??
    visible[Math.min(previousSelectionIndex.current, visible.length - 1)];
  const ordered = view === "journey" ? orderByJourney(items) : items;
  const visibleOrdered = ordered.filter((item) => visibleKeys.has(item.key));
  const firstInGroup = new Set(
    visibleOrdered
      .filter((item, index) => index === 0 || item.groupKey !== visibleOrdered[index - 1].groupKey)
      .map((item) => item.key)
  );
  const failedSources = data.failed.filter((s): s is InboxSource =>
    INBOX_SOURCES.includes(s as InboxSource)
  );
  const countOf = (kind: InboxSource | "all"): string | null => {
    if (!data.loaded) return null;
    const n = items.filter(
      (item) => (kind === "all" || item.source === kind) && deferred.has(item.key) === showDeferred
    ).length;
    return failedSources.some((s) => kind === "all" || s === kind) ? `${n}+?` : String(n);
  };
  const counts = Object.fromEntries(
    (["all", ...INBOX_SOURCES] as const).map((kind) => [kind, countOf(kind)])
  ) as Record<InboxSource | "all", string | null>;
  const sourceEmpty =
    data.loaded &&
    source !== "all" &&
    !failedSources.includes(source) &&
    !items.some((item) => item.source === source);

  // The page's tab label: null until measured, never a 0 nobody counted.
  const total = data.loaded ? items.length : null;
  const complete = failedSources.length === 0;
  useEffect(() => {
    onCount?.(total === null ? null : { count: total, complete });
  }, [onCount, total, complete]);

  const setParam = (name: string, value: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === null) next.delete(name);
        else next.set(name, value);
        return next;
      },
      { replace: true }
    );
  const select = (key: string) => {
    setParam("item", key);
    setMobileDetail(true);
  };
  const selectedIndex = visible.findIndex((item) => item.key === selected?.key);
  useEffect(() => {
    if (selectedIndex >= 0) previousSelectionIndex.current = selectedIndex;
  }, [selectedIndex]);
  useEffect(() => {
    if (view === "list" && mobileDetail) heading.current?.focus({ preventScroll: true });
  }, [selected?.key, view, mobileDetail]);
  const postpone = (key: string) =>
    setDeferred((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const recheck = async () => {
    if (checking) return;
    setChecking(true);
    setCheckFailed(false);
    try {
      await dataQualityFlagsApi.run();
      await data.reload();
    } catch {
      setCheckFailed(true);
    } finally {
      setChecking(false);
    }
  };
  const day = (value: string | null) =>
    value ? format.date(`${value}T00:00:00Z`, { timeZone: "UTC" }) : t(`${W}.unknownDay`);
  const historySource = HISTORY_SOURCES.find((s) => s === source) as HistorySource | undefined;

  return (
    <section aria-label={t(`${W}.title`)} className="inbox-workspace space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t(`${W}.heading`)}</h2>
          <p className="t-caption mt-1">{t(`${W}.intro`)}</p>
        </div>
        <Segmented
          label={t(`${W}.viewLabel`)}
          value={view}
          options={VIEWS.map((mode) => ({ value: mode, label: t(`${W}.views.${mode}`) }))}
          onChange={(mode) => setParam("view", mode)}
        />
      </div>
      <div className={view === "list" && mobileDetail ? "hidden lg:block" : undefined}>
        <WorkspaceToolbar
          query={query}
          onQuery={setQuery}
          sources={sources}
          source={source}
          onSource={(kind) => setParam("tab", kind === "all" ? null : kind)}
          counts={counts}
          laterCount={items.filter((item) => deferred.has(item.key)).length}
          showDeferred={showDeferred}
          onShowDeferred={setShowDeferred}
          loading={data.loading}
          checking={checking}
          onReload={() => void data.reload()}
          onRecheck={() => void recheck()}
        />
      </div>
      {data.failed.length > 0 && (
        <div role="alert" className="rounded-lg border border-(--ts-warn) p-4 text-sm">
          {t(`${W}.loadFailed`)} {data.failed.map((s) => t(`${W}.sources.${s}`)).join(", ")}.{" "}
          <Button disabled={data.loading} onClick={() => void data.reload()}>
            {t(`${W}.retry`)}
          </Button>
        </div>
      )}
      {checkFailed && <p role="alert">{t(`${W}.checkFailed`)}</p>}
      <SourcePanel
        source={source}
        empty={sourceEmpty}
        proposalInfo={data.proposalInfo}
        reload={data.reload}
      />
      {historySource && (
        <div className="space-y-3">
          <Button aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
            {t(`${W}.history.${showHistory ? "hide" : "show"}`)}
          </Button>
          {showHistory && <InboxHistory source={historySource} />}
        </div>
      )}
      <p role="status" className="t-caption">
        {data.loading ? t(`${W}.loading`) : t(`${W}.shown`, { count: visible.length })}
      </p>
      {!data.loaded && (
        <div className="flex justify-center py-8">
          <GlobeLoader size={120} label={t(`${W}.loading`)} />
        </div>
      )}
      {data.loaded && visible.length === 0 && !sourceEmpty && (
        <Card flush>
          <EmptyState
            kind={failedSources.length ? "degraded" : "pending"}
            title={t(
              `${W}.${failedSources.length ? "incomplete" : query || source !== "all" || showDeferred ? "noMatches" : "empty"}`
            )}
          />
        </Card>
      )}
      {/* Also for a single visit: the bar is where a failed answer is named. */}
      {visibleVisits.length > 0 && <VisitBatchBar journeys={visibleVisits} review={visitReview} />}

      <div
        className={
          view === "list"
            ? "grid items-start gap-5 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]"
            : ""
        }
      >
        {view === "list" && (
          <nav
            aria-label={t(`${W}.itemList`)}
            className={`${mobileDetail ? "hidden lg:block" : ""} space-y-2 lg:sticky lg:top-4 lg:max-h-[75vh] lg:overflow-y-auto`}
          >
            {visible.map((item) => (
              <button
                type="button"
                key={item.key}
                onClick={() => select(item.key)}
                aria-current={item.key === selected?.key ? "true" : undefined}
                aria-controls={`${id}-detail`}
                className="w-full rounded-lg border p-4 text-left"
                style={{
                  borderColor: item.key === selected?.key ? "var(--ts-accent)" : "var(--ts-border)",
                  background: "var(--ts-surface)",
                }}
              >
                <span className="t-caption">
                  {t(`${W}.sources.${item.source}`)} · {day(item.day)}
                </span>
                <span className="mt-1 block font-semibold">{item.title}</span>
                <span className="mt-1 block text-sm">{item.subject}</span>
              </button>
            ))}
          </nav>
        )}
        <div
          id={`${id}-detail`}
          className={
            view === "cards"
              ? "grid items-start gap-5 xl:grid-cols-2"
              : view === "list" && !mobileDetail
                ? "hidden lg:block"
                : "space-y-5"
          }
        >
          {view === "list" && selected && (
            <div ref={heading} tabIndex={-1} className="flex flex-wrap items-center gap-2">
              <span className="lg:hidden">
                <Button onClick={() => setMobileDetail(false)}>{t(`${W}.back`)}</Button>
              </span>
              <span className="t-caption">
                {selectedIndex + 1} / {visible.length}
              </span>
              <Button
                disabled={selectedIndex <= 0}
                onClick={() => select(visible[selectedIndex - 1].key)}
              >
                {t(`${W}.previous`)}
              </Button>
              <Button
                disabled={selectedIndex >= visible.length - 1}
                onClick={() => select(visible[selectedIndex + 1].key)}
              >
                {t(`${W}.next`)}
              </Button>
            </div>
          )}
          {/* Stable parents/keys preserve drafts across all three layouts, filters and selection. */}
          {ordered.map((item) => (
            <div
              key={item.key}
              hidden={!visibleKeys.has(item.key) || (view === "list" && selected?.key !== item.key)}
              className="min-w-0"
            >
              {view === "journey" && firstInGroup.has(item.key) && (
                <div className="mb-4 mt-5">
                  <h3 className="text-lg font-semibold">{item.groupName}</h3>
                  <p className="t-caption">
                    {t(`${W}.groupCount`, {
                      count: visible.filter((other) => other.groupKey === item.groupKey).length,
                    })}
                  </p>
                  {item.tripId && <TripContext tripId={item.tripId} />}
                </div>
              )}
              <article
                className={`rounded-xl border border-(--ts-border) bg-(--ts-surface) p-5 ${view === "journey" ? "border-l-4 border-l-(--ts-accent)" : ""}`}
              >
                <header className="mb-4 border-b border-(--ts-border) pb-3">
                  <p className="t-caption">
                    {t(`${W}.sources.${item.source}`)} · {day(item.day)}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold">{item.title}</h3>
                  <p className="mt-1 text-sm">{item.subject}</p>
                  {view !== "journey" && item.tripId && item.groupName !== item.subject && (
                    <p className="t-caption mt-1">
                      <Link className="underline" to={`/trips/${item.tripId}`}>
                        {item.groupName}
                      </Link>
                    </p>
                  )}
                </header>
                <InboxCard
                  item={item}
                  disabled={data.failed.includes(item.source)}
                  reload={data.reload}
                  stayChoices={data.stayChoices}
                  visitReview={visitReview}
                />
                <div className="mt-4 border-t border-(--ts-border) pt-3">
                  <Button onClick={() => postpone(item.key)}>
                    {t(`${W}.${deferred.has(item.key) ? "restore" : "postpone"}`)}
                  </Button>
                </div>
              </article>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
