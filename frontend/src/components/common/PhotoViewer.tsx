import { useCallback, useEffect, useState, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useInRouterContext } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { useZoomPan } from "./photoViewer/useZoomPan";
import type { ViewerPhoto } from "./photoViewer/viewerPhoto";

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
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90"
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
          <p
            role="alert"
            data-testid="photo-viewer-error"
            className="rounded-md px-4 py-3 text-sm"
            style={{ background: "var(--bg-elevated)", color: "var(--color-danger, #f87171)" }}
          >
            {t("common:photoViewer.loadFailed")}
          </p>
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
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-3 text-white"
              onClick={() => step(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label={t("common:photoViewer.next")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-3 text-white"
              onClick={() => step(1)}
            >
              ›
            </button>
          </>
        )}
      </div>

      <div
        className="mt-3 flex max-w-[95vw] flex-wrap items-center justify-center gap-3 px-3 text-sm text-slate-200"
        onClick={(e) => e.stopPropagation()}
        data-testid="photo-viewer-caption"
      >
        {item.caption && <span>{item.caption}</span>}
        {meta.length > 0 && <span className="text-slate-300">{meta.join(" · ")}</span>}
        {count > 1 && (
          <span className="tabular-nums text-slate-400">
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
          className="rounded-sm border border-slate-500 px-3 py-1 text-white"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
    </div>,
    document.body
  );
}
