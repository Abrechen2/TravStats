import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import NavigationBar from "../components/NavigationBar";
import PageTransition from "../components/PageTransition";
import { useTranslation } from "../hooks/useTranslation";
import { usePlacesAccess } from "../hooks/usePlacesVisible";
import { FlagImg } from "../lib/countryFlag";
import { curatedText } from "../lib/curatedCopy";
import { logger } from "../lib/logger";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import {
  getCuratedProgress,
  subscribeChecklist,
  tickCuratedItem,
  unsubscribeChecklist,
  untickCuratedItem,
} from "../lib/api/placeLists";
import { DOMAINS } from "../shared/domains";
import { useToastStore } from "../store/toastStore";
import type { CuratedProgress, CuratedProgressItem } from "../types/placeList";

/**
 * The progress screen — the ONE screen in the app that renders two kinds of row.
 *
 * That is the acknowledged cost of lazy materialisation, and it is the point:
 * an unticked target is a GHOST, drawn hollow and dashed, because it is not in
 * the logbook. If it looked like a ticked one the checklist would mean nothing.
 * A ticked row is an ordinary place — it links into the logbook like any other,
 * because from the moment it is ticked that is exactly what it is.
 */
export default function CuratedChecklistPage(): JSX.Element {
  const { key } = useParams<{ key: string }>();
  const { t, i18n } = useTranslation(["places", "common"]);
  const navigate = useNavigate();
  const access = usePlacesAccess();
  const addToast = useToastStore((s) => s.addToast);

  const [progress, setProgress] = useState<CuratedProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!key) return;
    setLoading(true);
    setFailure(null);
    try {
      setProgress(await getCuratedProgress(key));
    } catch (err: unknown) {
      logger.error({ err }, "CuratedChecklistPage: failed to load progress");
      setFailure(classifyLoadFailure(err));
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    if (access !== "allowed") return;
    void load();
  }, [access, load]);

  const handleToggle = useCallback(
    async (item: CuratedProgressItem): Promise<void> => {
      setBusyItem(item.itemId);
      try {
        if (item.ticked) {
          await untickCuratedItem(item.itemId);
        } else {
          await tickCuratedItem(item.itemId);
        }
        // Re-fetch rather than patch locally: ticking also creates a place and
        // files it in the subscription, so the row, the counter AND the
        // subscribed flag can all change from one click.
        await load();
      } catch (err: unknown) {
        logger.error({ err }, "CuratedChecklistPage: failed to toggle item");
        addToast("error", t("places:checklist.tickFailed"));
      } finally {
        setBusyItem(null);
      }
    },
    [load, addToast, t]
  );

  const handleSubscription = useCallback(async (): Promise<void> => {
    if (!progress || !key) return;
    try {
      if (progress.subscribed) {
        await unsubscribeChecklist(key);
      } else {
        await subscribeChecklist(key);
      }
      await load();
    } catch (err: unknown) {
      logger.error({ err }, "CuratedChecklistPage: failed to change subscription");
      addToast("error", t("places:checklist.subscribeFailed"));
    }
  }, [progress, key, load, addToast, t]);

  if (access === "pending" || loading) {
    return (
      <PageTransition>
        <NavigationBar />
        <div className="mx-auto max-w-3xl px-4 py-16 text-center text-[var(--text-muted)]">
          {t("common:loading.default")}
        </div>
      </PageTransition>
    );
  }

  if (access === "denied") {
    return (
      <PageTransition>
        <NavigationBar />
        <div className="mx-auto max-w-3xl px-4 py-16 text-center text-[var(--text-muted)]">
          {t("places:list.domainDisabled")}
        </div>
      </PageTransition>
    );
  }

  if (failure !== null || !progress) {
    const isLoadError = failure === "loadError";
    return (
      <PageTransition>
        <NavigationBar />
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <p role="alert" style={{ color: "var(--danger)" }}>
            {isLoadError ? t("places:lists.loadError") : t("places:checklist.notFound")}
          </p>
          <Link
            to="/places/lists"
            className="mt-3 inline-block text-sm underline"
            style={{ color: "var(--accent)" }}
          >
            {t("places:lists.backToLists")}
          </Link>
        </div>
      </PageTransition>
    );
  }

  const accent = progress.color ?? DOMAINS.poi.color;
  const pct =
    progress.itemCount > 0 ? Math.round((progress.tickedCount / progress.itemCount) * 100) : 0;
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });

  return (
    <PageTransition>
      <NavigationBar />
      <div className="mx-auto max-w-[900px] px-4 py-6 sm:px-6">
        <Link to="/places/lists" className="text-sm" style={{ color: "var(--text-muted)" }}>
          ← {t("places:lists.backToLists")}
        </Link>

        <div className="mt-3 mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display flex items-center gap-3 text-2xl font-semibold tracking-tight">
              {progress.icon && <span aria-hidden>{progress.icon}</span>}
              {curatedText(progress.name, progress.nameEn, i18n.language)}
            </h1>
            {progress.description && (
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                {curatedText(progress.description, progress.descriptionEn, i18n.language)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleSubscription()}
            className="shrink-0 rounded-lg px-4 py-2 text-sm"
            style={
              progress.subscribed
                ? { border: "1px solid var(--color-border)", color: "var(--text-secondary)" }
                : { background: "var(--accent)", color: "#0d1117", fontWeight: 500 }
            }
          >
            {progress.subscribed
              ? t("places:checklist.unsubscribe")
              : t("places:lists.subscribe")}
          </button>
        </div>

        <div className="mb-6">
          <div
            role="progressbar"
            aria-valuenow={progress.tickedCount}
            aria-valuemin={0}
            aria-valuemax={progress.itemCount}
            aria-label={curatedText(progress.name, progress.nameEn, i18n.language)}
            style={{ height: 8, borderRadius: 4, background: "var(--bg-elevated)", overflow: "hidden" }}
          >
            <div style={{ width: `${pct}%`, height: "100%", background: accent }} />
          </div>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("places:lists.progress", {
              done: progress.tickedCount,
              total: progress.itemCount,
            })}
          </p>
        </div>

        {/* Unsubscribing keeps every ticked place — said out loud, because
            "Nicht mehr folgen" reads like it might take them along. */}
        {progress.subscribed && (
          <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
            {t("places:checklist.unsubscribeHint")}
          </p>
        )}

        <ul style={{ listStyle: "none", padding: 0 }} className="grid gap-2">
          {progress.items.map((item) => {
            const busy = busyItem === item.itemId;
            return (
              <li
                key={item.itemId}
                className="flex items-start gap-3 rounded-xl px-4 py-3"
                style={
                  item.ticked
                    ? { background: "var(--bg-surface)", border: "1px solid var(--color-border)" }
                    : {
                        // The ghost: no fill, a dashed edge. Shape carries it,
                        // not colour — the same measurement the pin layer
                        // makes for hollow wishlist pins.
                        background: "transparent",
                        border: "1px dashed var(--color-border)",
                      }
                }
              >
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleToggle(item)}
                  aria-pressed={item.ticked}
                  aria-label={
                    item.ticked
                      ? t("places:checklist.untickItem", { name: item.name })
                      : t("places:checklist.tickItem", { name: item.name })
                  }
                  style={{
                    width: 22,
                    height: 22,
                    flex: "none",
                    marginTop: 2,
                    borderRadius: 6,
                    cursor: busy ? "wait" : "pointer",
                    background: item.ticked ? accent : "transparent",
                    border: item.ticked ? "none" : "1.5px dashed var(--color-border)",
                    color: "#0d1117",
                    fontSize: 13,
                    lineHeight: "22px",
                  }}
                >
                  {item.ticked ? "✓" : ""}
                </button>

                <div className="min-w-0 flex-1">
                  <p
                    className="flex items-center gap-2 text-sm"
                    style={{ color: item.ticked ? "var(--text-primary)" : "var(--text-muted)" }}
                  >
                    {item.ticked && item.placeId ? (
                      <Link to={`/places/${item.placeId}`} style={{ color: "inherit" }}>
                        {curatedText(item.name, item.nameEn, i18n.language)}
                      </Link>
                    ) : (
                      curatedText(item.name, item.nameEn, i18n.language)
                    )}
                    {item.country && <FlagImg country={item.country} />}
                  </p>
                  {item.blurb && (
                    <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                      {curatedText(item.blurb, item.blurbEn, i18n.language)}
                    </p>
                  )}
                </div>

                <span className="shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
                  {item.ticked
                    ? item.lastVisitAt
                      ? dateFormat.format(new Date(item.lastVisitAt))
                      : t("places:detail.undated")
                    : t("places:checklist.notYet")}
                </span>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={() => navigate("/places")}
          className="mt-6 text-sm underline"
          style={{ color: "var(--text-muted)" }}
        >
          {t("places:detail.backToList")}
        </button>
      </div>
    </PageTransition>
  );
}
