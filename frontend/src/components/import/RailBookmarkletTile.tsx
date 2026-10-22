import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { bahnBookmarkletHref } from "../../lib/rail/bahnBookmarklet";
import { ImportTileShell } from "./ImportTileShell";

type CopyState = "idle" | "copied" | "failed";

/**
 * Offers the „In TravStats übernehmen“ bookmarklet (forgejo#204): a link to
 * drag into the bookmarks bar on a desktop, and its code to copy into a
 * bookmark on an iPad or a phone, where nothing can be dragged.
 *
 * The bookmark carries THIS instance's address as the browser reaches it, so
 * it hands over to the server the user is signed in to. React 19 refuses a
 * `javascript:` href it renders itself, so the address is set on the element
 * directly — it is built entirely here, from the origin and our own copy.
 */
export function RailBookmarkletTile(): JSX.Element {
  const { t } = useTranslation(["rail"]);
  const link = useRef<HTMLAnchorElement>(null);
  const [copy, setCopy] = useState<CopyState>("idle");
  const [clickedHere, setClickedHere] = useState(false);
  const href = useMemo(
    () => bahnBookmarkletHref(window.location.origin, t("rail:bookmarklet.prompt")),
    [t]
  );

  useEffect(() => {
    link.current?.setAttribute("href", href);
  }, [href]);

  const copyCode = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(href);
      setCopy("copied");
    } catch (err: unknown) {
      logger.warn("RailBookmarkletTile: copying the bookmarklet failed", err);
      setCopy("failed");
    }
  };

  return (
    <ImportTileShell
      title={t("rail:bookmarklet.title")}
      description={t("rail:bookmarklet.description")}
      picker={
        <a
          ref={link}
          className="btn-secondary inline-flex cursor-grab items-center gap-2"
          data-testid="rail-bookmarklet-link"
          draggable
          onClick={(e) => {
            // Clicked on TravStats it would only report "not a bahn.de page".
            e.preventDefault();
            setClickedHere(true);
          }}
        >
          {t("rail:bookmarklet.linkLabel")}
        </a>
      }
      statusBlock={
        clickedHere ? (
          <p className="t-caption" role="status">
            {t("rail:bookmarklet.dragHint")}
          </p>
        ) : undefined
      }
    >
      <ol className="t-caption list-decimal pl-5">
        <li>{t("rail:bookmarklet.step1")}</li>
        <li>{t("rail:bookmarklet.step2")}</li>
        <li>{t("rail:bookmarklet.step3")}</li>
      </ol>
      <p className="t-caption">{t("rail:bookmarklet.touchHint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={() => void copyCode()}>
          {t("rail:bookmarklet.copy")}
        </button>
        {copy !== "idle" && (
          <span className="t-caption" role="status">
            {t(copy === "copied" ? "rail:bookmarklet.copied" : "rail:bookmarklet.copyFailed")}
          </span>
        )}
      </div>
      {copy === "failed" && (
        // The clipboard refused (permission, an old browser): the code to select by hand.
        <textarea
          readOnly
          rows={3}
          value={href}
          aria-label={t("rail:bookmarklet.codeLabel")}
          className="w-full rounded-md border border-border bg-(--bg-surface) p-2 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      <p className="t-caption">{t("rail:bookmarklet.privacy")}</p>
    </ImportTileShell>
  );
}
