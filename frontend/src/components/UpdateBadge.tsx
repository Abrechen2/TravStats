import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { versionApi, type VersionInfo } from "../lib/api";
import { useTranslation } from "../hooks/useTranslation";
import { useClickOutside } from "../hooks/useClickOutside";
import { logger } from "../lib/logger";

const POLL_INTERVAL_MS = 30 * 60 * 1000;
const DISMISS_KEY = "travstats.updateBadge.dismissedVersion";
const NOTES_PREVIEW_LIMIT = 600;

function readDismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function writeDismissedVersion(version: string): void {
  try {
    localStorage.setItem(DISMISS_KEY, version);
  } catch {
    /* localStorage disabled — dismissal won't persist, accept it */
  }
}

function truncateNotes(notes: string): string {
  if (notes.length <= NOTES_PREVIEW_LIMIT) return notes;
  const cut = notes.slice(0, NOTES_PREVIEW_LIMIT);
  const lastBreak = Math.max(cut.lastIndexOf("\n\n"), cut.lastIndexOf(". "));
  return (lastBreak > NOTES_PREVIEW_LIMIT / 2 ? cut.slice(0, lastBreak) : cut) + "…";
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function UpdateBadge(): JSX.Element | null {
  const { t, i18n } = useTranslation("common");
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(readDismissedVersion);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useClickOutside(popoverRef, () => setPopoverOpen(false));

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const data = await versionApi.get();
        if (!cancelled) setInfo(data);
      } catch (err) {
        logger.warn("Failed to load version info", err);
      }
    };
    void load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!popoverOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const popoverWidth = Math.min(380, viewportWidth - 16);
    const left = Math.max(8, Math.min(rect.left, viewportWidth - popoverWidth - 8));
    setPopoverStyle({
      top: rect.bottom + 8,
      left,
      width: popoverWidth,
    });
  }, [popoverOpen]);

  if (!info?.updateAvailable || !info.latestAvailable) return null;
  if (dismissedVersion === info.latestAvailable) return null;

  const handleDismiss = (): void => {
    if (!info.latestAvailable) return;
    writeDismissedVersion(info.latestAvailable);
    setDismissedVersion(info.latestAvailable);
    setPopoverOpen(false);
  };

  const previewNotes = info.releaseNotes ? truncateNotes(info.releaseNotes) : null;
  const showFullNotesLink =
    info.releaseUrl && (!info.releaseNotes || info.releaseNotes.length > NOTES_PREVIEW_LIMIT);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setPopoverOpen((v) => !v)}
        className="update-badge-blink ml-2 inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide"
        style={{
          color: "#1f1300",
          background: "var(--warning, #f5c542)",
          letterSpacing: "0.06em",
        }}
        aria-label={t("update.headline", { version: info.latestAvailable })}
      >
        {t("update.available")}
      </button>

      {popoverOpen &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-10000 rounded-lg shadow-xl"
            style={{
              ...popoverStyle,
              background: "var(--bg-surface)",
              border: "1px solid var(--color-border)",
              color: "var(--text-primary)",
            }}
            role="dialog"
            aria-label={t("update.headline", { version: info.latestAvailable })}
          >
            <div className="p-4 space-y-3">
              <div>
                <div className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
                  {t("update.headline", { version: info.latestAvailable })}
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("update.currentVersion", { version: info.version })}
                </div>
                {info.publishedAt && (
                  <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {t("update.publishedAt", {
                      date: formatDate(info.publishedAt, i18n.language),
                    })}
                  </div>
                )}
              </div>

              <div
                className="text-xs whitespace-pre-wrap wrap-break-word rounded-sm p-2 max-h-56 overflow-y-auto"
                style={{
                  background: "var(--bg-base)",
                  border: "1px solid var(--color-border)",
                  color: "var(--text-primary)",
                }}
              >
                {previewNotes || t("update.noNotes")}
              </div>

              <div className="flex flex-col gap-2">
                {showFullNotesLink && info.releaseUrl && (
                  <a
                    href={info.releaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium underline"
                    style={{ color: "var(--accent)" }}
                  >
                    {t("update.viewFullNotes")} ↗
                  </a>
                )}
                <div className="flex justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleDismiss}
                    className="text-xs underline"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {t("update.dismiss")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPopoverOpen(false)}
                    className="text-xs px-2 py-1 rounded-sm"
                    style={{
                      border: "1px solid var(--color-border)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {t("update.close")}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
