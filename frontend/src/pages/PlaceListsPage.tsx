import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import { useTranslation } from "../hooks/useTranslation";
import { usePlacesAccess } from "../hooks/usePlacesVisible";
import { curatedText } from "../lib/curatedCopy";
import { logger } from "../lib/logger";
import { PlaceListCreateDialog } from "../components/places/PlaceListCreateDialog";
import ListLoadFailed, { loadFailureLog } from "../components/table/ListLoadFailed";
import { FormErrorBanner, navigateAfterSave } from "../components/form";
import { saveErrorKey } from "../lib/saveErrorMessage";
import { listCuratedChecklists, listPlaceLists, subscribeChecklist } from "../lib/api/placeLists";
import { DOMAINS } from "../shared/domains";
import type { CuratedListSummary, PlaceList } from "../types/placeList";

/**
 * Lists and checklists, one screen.
 *
 * Both are `PlaceList` rows — a subscribed checklist is simply one with a
 * `curatedKey` — but they are shown in two sections because they answer
 * different questions: "what did I group?" and "what is there to complete?".
 * A subscribed checklist therefore appears under checklists, never twice.
 *
 * Route note: `/places/lists` sits beside `/places/:id`. React Router ranks the
 * static segment higher, so this page wins and no place can ever be shadowed by
 * being called "lists" — but the two live next to each other in App.tsx so the
 * relationship is visible rather than inferred.
 */
export default function PlaceListsPage(): JSX.Element {
  const { t, i18n } = useTranslation(["places", "common"]);
  const navigate = useNavigate();
  const access = usePlacesAccess();

  const [lists, setLists] = useState<PlaceList[]>([]);
  const [curated, setCurated] = useState<CuratedListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  /** A refused subscription, kept on the page — it was a toast that vanished. */
  const [subscribeFailure, setSubscribeFailure] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(false);
    try {
      const [own, catalog] = await Promise.all([listPlaceLists(), listCuratedChecklists()]);
      setLists(own);
      setCurated(catalog);
    } catch (err: unknown) {
      logger.error({ err }, "PlaceListsPage: failed to load lists");
      setLoadError(true);
      setLoadFailure(loadFailureLog(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (access !== "allowed") return;
    void load();
  }, [access, load]);

  // A subscribed checklist is shown under checklists, with its progress — so it
  // is filtered out of the own-lists section rather than rendered twice.
  const ownLists = useMemo(() => lists.filter((l) => l.curatedKey === null), [lists]);

  const handleSubscribe = useCallback(
    async (key: string): Promise<void> => {
      setSubscribeFailure(null);
      try {
        await subscribeChecklist(key);
        navigate(`/places/checklists/${key}`);
      } catch (err: unknown) {
        logger.error({ err }, "PlaceListsPage: failed to subscribe");
        setSubscribeFailure(saveErrorKey(err, "places:lists.subscribeFailed"));
      }
    },
    [navigate]
  );

  if (access === "pending") {
    return (
      <AppShell width="reading">
        <p className="py-16 text-center text-[var(--text-muted)]">{t("common:loading.default")}</p>
      </AppShell>
    );
  }

  if (access === "denied") {
    return (
      <AppShell width="reading">
        <p className="py-16 text-center text-[var(--text-muted)]">
          {t("places:list.domainDisabled")}
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell width="list">
      <div>
        <Link to="/places" className="text-sm" style={{ color: "var(--text-muted)" }}>
          ← {t("places:detail.backToList")}
        </Link>

        <div className="mt-3 mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="t-screen-title">{t("places:lists.title")}</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {t("places:lists.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-lg px-4 py-2 text-sm font-medium pointer-coarse:min-h-(--ts-size-touch-min)"
            style={{ background: "var(--accent)", color: "#0d1117" }}
          >
            + {t("places:lists.newList")}
          </button>
        </div>

        {creating && (
          <PlaceListCreateDialog
            onClose={() => setCreating(false)}
            onCreated={async (created) => {
              setCreating(false);
              await navigateAfterSave(navigate, `/places/lists/${created.id}`);
            }}
          />
        )}

        <div className="mb-4">
          <FormErrorBanner message={subscribeFailure !== null ? t(subscribeFailure) : null} />
        </div>

        {loading && (
          <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            {t("common:loading.default")}
          </p>
        )}

        {loadError && (
          <ListLoadFailed
            title={t("places:lists.loadError")}
            onRetry={() => void load()}
            log={loadFailure}
          />
        )}

        {!loading && !loadError && (
          <>
            <section className="mb-10">
              <h2
                className="mb-3 text-sm font-semibold uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                {t("places:lists.ownSection")}
              </h2>
              {ownLists.length === 0 ? (
                // forgejo#250: the empty section names its next step.
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {t("places:lists.ownEmpty")}
                  </p>
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="rounded-lg px-3 py-1.5 text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
                    style={{ border: "1px solid var(--color-border)" }}
                  >
                    {t("places:lists.createFirst")}
                  </button>
                </div>
              ) : (
                <ul
                  className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                  style={{ listStyle: "none", padding: 0 }}
                >
                  {ownLists.map((list) => (
                    <li key={list.id}>
                      <Link
                        to={`/places/lists/${list.id}`}
                        className="block rounded-xl p-4 transition-colors"
                        style={{
                          background: "var(--bg-surface)",
                          border: "1px solid var(--color-border)",
                          color: "var(--text-primary)",
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              background: list.color,
                              flex: "none",
                            }}
                          />
                          {list.icon && <span aria-hidden>{list.icon}</span>}
                          <span className="font-medium">{list.name}</span>
                        </span>
                        <span className="mt-2 block text-xs" style={{ color: "var(--text-muted)" }}>
                          {t("places:lists.counts", {
                            places: list.placeCount,
                            visited: list.visitedCount,
                            countries: list.countryCount,
                          })}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2
                className="mb-3 text-sm font-semibold uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                {t("places:lists.curatedSection")}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2" style={{ listStyle: "none", padding: 0 }}>
                {curated.map((c) => {
                  const pct = c.itemCount > 0 ? Math.round((c.tickedCount / c.itemCount) * 100) : 0;
                  return (
                    <li
                      key={c.key}
                      className="rounded-xl p-4"
                      style={{
                        background: "var(--bg-surface)",
                        border: "1px solid var(--color-border)",
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="flex items-center gap-2 font-medium">
                            {c.icon && <span aria-hidden>{c.icon}</span>}
                            {curatedText(c.name, c.nameEn, i18n.language)}
                          </p>
                          {c.description && (
                            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                              {curatedText(c.description, c.descriptionEn, i18n.language)}
                            </p>
                          )}
                        </div>
                        {c.subscribed ? (
                          <Link
                            to={`/places/checklists/${c.key}`}
                            className="shrink-0 rounded-lg px-3 py-1.5 text-xs"
                            style={{
                              border: "1px solid var(--color-border)",
                              color: "var(--accent)",
                            }}
                          >
                            {t("places:lists.open")}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleSubscribe(c.key)}
                            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium"
                            style={{ background: "var(--accent)", color: "#0d1117" }}
                          >
                            {t("places:lists.subscribe")}
                          </button>
                        )}
                      </div>

                      {/* Progress is shown whether or not the user subscribed:
                          ticking works from a search result too, so a checklist
                          can be part-done before it is ever followed. */}
                      <div className="mt-3">
                        <div
                          role="progressbar"
                          aria-valuenow={c.tickedCount}
                          aria-valuemin={0}
                          aria-valuemax={c.itemCount}
                          aria-label={curatedText(c.name, c.nameEn, i18n.language)}
                          style={{
                            height: 6,
                            borderRadius: 3,
                            background: "var(--bg-elevated)",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${pct}%`,
                              height: "100%",
                              background: c.color ?? DOMAINS.poi.color,
                            }}
                          />
                        </div>
                        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                          {t("places:lists.progress", { done: c.tickedCount, total: c.itemCount })}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
