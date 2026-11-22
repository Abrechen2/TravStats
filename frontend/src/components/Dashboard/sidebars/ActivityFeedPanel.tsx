import { useEffect, useRef } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useActivityFeed } from "../../../hooks/useActivityFeed";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useDomainColors } from "../../../hooks/useDomainColors";
import { useDisplayFormat } from "../../../lib/displayFormat";
import type { ActivityFeedDomain, ActivityFeedItem } from "../../../lib/api/activityFeed";
import { DOMAINS } from "../../../shared/domains";
import { Icon } from "../../ui/Icon";
import Toggletip from "../../ui/Toggletip";
import { MAP_CHROME } from "../../map/mapChrome";

interface ActivityFeedPanelProps {
  isOpen: boolean;
  onClose(): void;
  /** Row click — bring the entry into view on the map. Never navigates. */
  onSelect(item: ActivityFeedItem): void;
  /** The row's arrow — opens the entry's own page. */
  onDetails(item: ActivityFeedItem): void;
  /** Starts the list over (an entry was saved). */
  reloadKey?: number;
  /** Pins the list to these domains (a single-domain tab); omitted = every visible domain. */
  domains?: readonly ActivityFeedDomain[];
  /** Heading; a domain tab passes its own. */
  title?: string;
}

/**
 * The dashboard's "Aktivität" card on the overview map: every entry of every
 * domain, planned ones on top, then newest to oldest — a page at a time from
 * the server's merged feed (`GET /activity/feed`), so a long history costs one
 * page, not one fetch per domain.
 *
 * The single-domain tabs use it too, pinned to their domain with `domains`, so
 * order, the planned label and click-to-focus are the same everywhere.
 */
export function ActivityFeedPanel({
  isOpen,
  onClose,
  onSelect,
  onDetails,
  reloadKey = 0,
  domains,
  title,
}: ActivityFeedPanelProps): JSX.Element | null {
  const { t } = useTranslation(["dashboard", "common"]);
  const { colorOf } = useDomainColors();
  const fmt = useDisplayFormat();
  const coarse = useCoarsePointer();
  const feed = useActivityFeed(isOpen, reloadKey, domains);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const { loadMore, hasMore, loading, loadingMore, error } = feed;

  // Escape closes it, as every other panel on the page does — unless a dialog
  // on top owns the key (useDialogChrome).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".ts-dialog-scrim")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // The next page loads as the end of the list scrolls into view; the button
  // below is the same action for a browser without IntersectionObserver and
  // for a keyboard.
  useEffect(() => {
    const node = sentinel.current;
    if (!isOpen || !node || !hasMore || loading || loadingMore || error) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [isOpen, hasMore, loading, loadingMore, error, loadMore, feed.items.length]);

  if (!isOpen) return null;

  const rowPadding = coarse ? "14px 16px" : "10px 16px";
  const touchMin = coarse ? 44 : undefined;

  return (
    <div
      {...MAP_CHROME}
      className="ts-activity-panel"
      role="region"
      aria-label={title ?? t("dashboard:sidebar.activity")}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        bottom: 0,
        background: "var(--ts-surface)",
        borderRight: "1px solid var(--ts-border)",
        zIndex: 40,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <strong>{title ?? t("dashboard:sidebar.activity")}</strong>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common:accessibility.close")}
          className="flex items-center justify-center rounded-md"
          style={{
            width: 44,
            height: 44,
            marginRight: -10,
            background: "none",
            border: "none",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          <Icon name="x" size={20} />
        </button>
      </div>

      {feed.failed.length > 0 && (
        <p
          role="alert"
          data-testid="activity-feed-partial"
          style={{ padding: "10px 16px", margin: 0, color: "var(--text-primary)", fontSize: 12 }}
        >
          {t("dashboard:sidebar.feedPartial", {
            domains: feed.failed.map((d) => t(`common:domain.${d}`)).join(", "),
          })}
        </p>
      )}

      {loading && feed.items.length === 0 && (
        <p role="status" style={{ padding: 16, color: "var(--text-muted)" }}>
          {t("dashboard:sidebar.feedLoading")}
        </p>
      )}

      {!loading && !error && feed.items.length === 0 && (
        <p style={{ padding: 16, color: "var(--text-muted)" }}>
          {t("dashboard:sidebar.emptyActivity")}
        </p>
      )}

      {feed.items.map((item) => {
        const onMap = item.point !== null || item.bbox !== null;
        return (
          <div
            key={item.key}
            role="button"
            tabIndex={0}
            data-testid="activity-feed-row"
            data-domain={item.domain}
            onClick={() => onSelect(item)}
            title={onMap ? undefined : t("dashboard:sidebar.notOnMap")}
            onKeyDown={(e) => {
              // Enter on the details arrow inside the row belongs to the arrow.
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(item);
              }
            }}
            className="activity-row hover:bg-white/4"
            style={{
              padding: rowPadding,
              minHeight: touchMin,
              borderBottom: "1px solid var(--color-border)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                aria-label={t(`common:domain.${item.domain}`)}
                role="img"
                style={{ color: colorOf(item.domain) }}
              >
                {DOMAINS[item.domain].icon}
              </span>
              <strong style={{ flex: 1, minWidth: 0 }}>{item.title}</strong>
              {item.planned && (
                <span
                  data-testid="activity-feed-planned"
                  style={{
                    fontSize: 10,
                    padding: "1px 6px",
                    borderRadius: 999,
                    border: `1px solid ${colorOf(item.domain)}`,
                    color: "var(--text-primary)",
                  }}
                >
                  {t("dashboard:sidebar.planned")}
                </span>
              )}
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                {item.date ? fmt.localDateValue(item.date) : "—"}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDetails(item);
                }}
                aria-label={t("common:buttons.details", { defaultValue: "Details" })}
                title={t("common:buttons.details", { defaultValue: "Details" })}
                className="flex shrink-0 items-center justify-center"
                style={{
                  width: 44,
                  height: 44,
                  margin: "-12px -10px -12px 0",
                  background: "none",
                  border: "none",
                  color: "var(--ts-muted)",
                  cursor: "pointer",
                }}
              >
                <span
                  className="flex items-center justify-center"
                  style={{
                    width: 26,
                    height: 22,
                    border: "1px solid var(--ts-border)",
                    borderRadius: 6,
                  }}
                >
                  <Icon name="chevron-right" size={14} />
                </span>
              </button>
            </div>
            {(item.subtitle !== null || item.place !== null || !onMap) && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  color: "var(--text-muted)",
                  fontSize: 11,
                  marginTop: 2,
                  marginLeft: 20,
                }}
              >
                <span style={{ flex: 1 }}>
                  {[item.subtitle, item.place]
                    .filter((p): p is string => p !== null && p !== "")
                    .join(" · ")}
                </span>
                {!onMap && (
                  <Toggletip
                    content={t("dashboard:sidebar.notOnMap")}
                    label={t("dashboard:sidebar.notOnMap")}
                  >
                    ⌀
                  </Toggletip>
                )}
              </div>
            )}
          </div>
        );
      })}

      {error && (
        <div role="alert" data-testid="activity-feed-error" style={{ padding: 16 }}>
          <p style={{ margin: "0 0 8px", color: "var(--text-primary)" }}>
            {t("dashboard:sidebar.feedError")}
          </p>
          <button
            type="button"
            onClick={feed.retry}
            style={{
              minHeight: 44,
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid var(--color-border)",
              background: "transparent",
              color: "var(--text-primary)",
              cursor: "pointer",
            }}
          >
            {t("dashboard:sidebar.feedRetry")}
          </button>
        </div>
      )}

      {hasMore && !error && feed.items.length > 0 && (
        <div ref={sentinel}>
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="activity-show-more"
            style={{
              display: "block",
              width: "100%",
              minHeight: 44,
              padding: "10px 16px",
              background: "none",
              border: "none",
              borderBottom: "1px solid var(--color-border)",
              color: "var(--text-primary)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {loadingMore ? t("dashboard:sidebar.feedLoading") : t("dashboard:sidebar.feedLoadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
