import { useCallback, useEffect, useState, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useInRouterContext } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/format";
import { useZoomPan } from "./photoViewer/useZoomPan";
import type { ViewerPhoto } from "./photoViewer/viewerPhoto";
import InlineError from "../ui/InlineError";
import { Icon } from "../ui/Icon";

/** The viewer is a photo on black in both themes, so its chrome is fixed light-on-dark. */
const LIGHT = "rgba(255, 255, 255, 0.9)";
const NAV_STYLE = { background: "rgba(0, 0, 0, 0.6)", color: LIGHT } as const;

interface Props {
  items: ViewerPhoto[];
  startIndex: number;
  onClose: () => void;
  /** Extra controls under the caption, e.g. the trip gallery's "set as cover". */
  actions?: (item: ViewerPhoto) => ReactNode;
  /** Called whenever the shown photo changes. */
  onStep?: (item: ViewerPhoto) => void;
  /** True while something on top of the viewer (a crop editor) owns the keyboard. */
  suspendKeys?: boolean;
}

/**
 * The one full-screen photo viewer of the app: arrows / swipe to step, Escape or × to close,
 * pinch / wheel / double-click to zoom, a caption with date, place, source and a link to the
 * entry the photo belongs to. A picture that fails to load says so instead of showing nothing.
 */
export default function PhotoViewer({
  items,
  startIndex,
  onClose,
  actions,
  onStep,
  suspendKeys = false,
}: Props): JSX.Element | null {
  const { t } = useTranslation(["common"]);
  const display = useDisplayFormat();
  const inRouter = useInRouterContext();
  const [index, setIndex] = useState(startIndex);
  const [failed, setFailed] = useState<string | null>(null);

  const count = items.length;
  const safeIndex = Math.min(index, Math.max(count - 1, 0));
  const item: ViewerPhoto | undefined = items[safeIndex];

  const step = useCallback(
    (delta: number): void => {
      setIndex((prev) => (prev + delta + count) % count);
    },
    [count]
  );
  const { view, reset, handlers } = useZoomPan((d) => {
    if (count > 1) step(d);
  });

  useEffect(() => {
    reset();
    if (item) onStep?.(item);
    // `item.id` is the identity; the callback is allowed to change without re-firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, reset]);

  useEffect(() => {
    if (suspendKeys) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
      if (count > 1 && event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      }
      if (count > 1 && event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step, count, suspendKeys]);

  if (!item) return null;

  const meta: string[] = [];
  if (item.takenAt) meta.push(display.dateTime(item.takenAt));
  if (item.place) meta.push(item.place);
  if (item.source) meta.push(t(`common:photoViewer.source.${item.source}`));
  const linkClass = "underline";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: "rgba(0, 0, 0, 0.9)" }}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("common:photoViewer.title")}
      data-testid="photo-viewer"
      tabIndex={-1}
    >
      <div
        className="relative flex max-h-[80vh] max-w-[95vw] items-center justify-center overflow-hidden"
        style={{ touchAction: "none" }}
        onClick={(e) => e.stopPropagation()}
        {...handlers}
      >
        {failed === item.id ? (
          <div className="rounded-md px-4 py-3" style={{ background: "var(--bg-elevated)" }}>
            <InlineError testId="photo-viewer-error">
              {t("common:photoViewer.loadFailed")}
            </InlineError>
          </div>
        ) : (
          <img
            key={item.id}
            data-testid="lightbox-image"
            src={item.url}
            alt={item.caption ?? t("common:photoViewer.alt")}
            draggable={false}
            onError={() => setFailed(item.id)}
            className="max-h-[80vh] max-w-[95vw] select-none object-contain"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transition: view.scale === 1 ? "transform 120ms" : undefined,
            }}
          />
        )}

        {count > 1 && (
          <>
            <button
              type="button"
              aria-label={t("common:photoViewer.previous")}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full p-3"
              style={NAV_STYLE}
              onClick={() => step(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label={t("common:photoViewer.next")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-3"
              style={NAV_STYLE}
              onClick={() => step(1)}
            >
              ›
            </button>
          </>
        )}
      </div>

      <div
        className="mt-3 flex max-w-[95vw] flex-wrap items-center justify-center gap-3 px-3 text-sm"
        style={{ color: LIGHT }}
        onClick={(e) => e.stopPropagation()}
        data-testid="photo-viewer-caption"
      >
        {item.caption && <span>{item.caption}</span>}
        {meta.length > 0 && <span style={{ opacity: 0.8 }}>{meta.join(" · ")}</span>}
        {count > 1 && (
          <span className="tabular-nums" style={{ opacity: 0.6 }}>
            {safeIndex + 1} / {count}
          </span>
        )}
        {item.entry &&
          (inRouter ? (
            <Link to={item.entry.href} className={linkClass} onClick={onClose}>
              {item.entry.label}
            </Link>
          ) : (
            <a href={item.entry.href} className={linkClass}>
              {item.entry.label}
            </a>
          ))}
        {actions?.(item)}
        <button
          type="button"
          aria-label={t("common:photoViewer.close")}
          className="rounded-sm px-3 py-1"
          style={{ border: `1px solid ${LIGHT}`, color: LIGHT }}
          onClick={onClose}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>,
    document.body
  );
}
