import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import { dataQualityFlagsApi } from "../../../lib/api/dataQualityFlags";
import Button from "../../ui/Button";
import {
  buildInboxItems,
  filterInbox,
  orderByJourney,
  W,
  type InboxSource,
  type InboxView,
} from "./model";
import { useInboxData } from "./useInboxData";
import InboxCard from "./InboxCard";
import TripContext from "./TripContext";
import "./workspace.css";

const SOURCES: InboxSource[] = ["review", "trips", "updates", "photos", "dawarich"];

export default function InboxWorkspace({
  photosVisible,
  active = true,
}: {
  photosVisible: boolean;
  active?: boolean;
}) {
  const { t, i18n } = useTranslation(["dataQuality", "common"]);
  const format = useDisplayFormat();
  const data = useInboxData(photosVisible, active);
  const [params, setParams] = useSearchParams();
  const requestedView = params.get("view");
  const view: InboxView =
    requestedView === "list" || requestedView === "journey" ? requestedView : "cards";
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<InboxSource | "all">("all");
  const [deferred, setDeferred] = useState<ReadonlySet<string>>(new Set());
  const [showDeferred, setShowDeferred] = useState(false);
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
  const visible = filterInbox(items, query, source, deferred, showDeferred);
  const visibleKeys = new Set(visible.map((item) => item.key));
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

  return (
    <section aria-label={t(`${W}.title`)} className="inbox-workspace space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t(`${W}.heading`)}</h2>
          <p className="t-caption mt-1">{t(`${W}.intro`)}</p>
        </div>
        <div role="group" aria-label={t(`${W}.viewLabel`)} className="flex flex-wrap gap-2">
          {(["cards", "list", "journey"] as const).map((mode) => (
            <Button
              key={mode}
              variant={view === mode ? "primary" : "secondary"}
              aria-pressed={view === mode}
              onClick={() => setParam("view", mode)}
            >
              {t(`${W}.views.${mode}`)}
            </Button>
          ))}
        </div>
      </div>
      <div className={view === "list" && mobileDetail ? "hidden lg:block space-y-4" : "space-y-4"}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 w-full text-sm sm:w-auto sm:flex-1">
            {t(`${W}.search`)}
            <input
              type="search"
              className="input mt-1 w-full"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(`${W}.searchHint`)}
            />
          </label>
          <Button disabled={data.loading} onClick={() => void data.reload()}>
            {t(`${W}.refresh`)}
          </Button>
          <Button disabled={checking} onClick={() => void recheck()}>
            {t(`${W}.recheckAll`)}
          </Button>
        </div>
        <div
          role="group"
          aria-label={t(`${W}.filterLabel`)}
          className="inbox-filters flex gap-2 overflow-x-auto pb-1 md:flex-wrap"
        >
          {(["all", ...SOURCES.filter((s) => s !== "photos" || photosVisible)] as const).map(
            (kind) => (
              <Button
                key={kind}
                aria-pressed={source === kind}
                variant={source === kind ? "primary" : "secondary"}
                onClick={() => setSource(kind)}
              >
                {t(`${W}.sources.${kind}`)}{" "}
                {data.loaded
                  ? `(${items.filter((item) => (kind === "all" || item.source === kind) && deferred.has(item.key) === showDeferred).length}${data.failed.some((s) => kind === "all" || s === kind) ? "+?" : ""})`
                  : "…"}
              </Button>
            )
          )}
          <Button aria-pressed={showDeferred} onClick={() => setShowDeferred(!showDeferred)}>
            {t(`${W}.later`)} ({items.filter((item) => deferred.has(item.key)).length})
          </Button>
        </div>
        {showDeferred && <p className="t-caption">{t(`${W}.laterHint`)}</p>}
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
      {data.proposalInfo?.home === "missing" && (
        <p className="t-caption">
          {t("dataQuality:inbox.tripSuggestions.home.missing")}{" "}
          <Link className="underline" to="/settings?section=homeAirport">
            {t("dataQuality:inbox.tripSuggestions.home.link")}
          </Link>
        </p>
      )}
      {data.proposalInfo && data.proposalInfo.total > data.proposalInfo.suggestions.length && (
        <p className="t-caption">
          {t("dataQuality:inbox.tripSuggestions.capped", {
            shown: data.proposalInfo.suggestions.length,
            total: data.proposalInfo.total,
          })}
        </p>
      )}
      {data.proposalInfo?.truncated && (
        <p className="t-caption">{t("dataQuality:inbox.tripSuggestions.truncated")}</p>
      )}
      <p role="status" className="t-caption">
        {data.loading ? t(`${W}.loading`) : t(`${W}.shown`, { count: visible.length })}
      </p>
      {data.loaded && visible.length === 0 && (
        <div className="rounded-xl border border-(--ts-border) p-8 text-center">
          <h3 className="font-semibold">
            {t(
              `${W}.${data.failed.length ? "incomplete" : query || source !== "all" || showDeferred ? "noMatches" : "empty"}`
            )}
          </h3>
        </div>
      )}

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
