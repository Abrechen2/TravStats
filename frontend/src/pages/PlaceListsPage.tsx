import { LIST_PALETTE_HEX } from "../lib/listPalette";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate } from "react-router-dom";
import NavigationBar from "../components/NavigationBar";
import PageTransition from "../components/PageTransition";
import { useTranslation } from "../hooks/useTranslation";
import { usePlacesAccess } from "../hooks/usePlacesVisible";
import { curatedText } from "../lib/curatedCopy";
import { logger } from "../lib/logger";
import { PlaceListLabelFields, hasSymbol } from "../components/places/PlaceListLabelFields";
import type { PlaceLabelMode } from "../lib/placeLabel";
import {
  createPlaceList,
  listCuratedChecklists,
  listPlaceLists,
  subscribeChecklist,
} from "../lib/api/placeLists";
import { DOMAINS } from "../shared/domains";
import { useToastStore } from "../store/toastStore";
import type { CuratedListSummary, PlaceList } from "../types/placeList";

/** Quick-pick list colours. Deliberately far apart — two lists in near-identical
 *  hues make `list` colour mode say nothing on a map. */
// The shared ten from `listColor.palette`. The six that used to stand here
// included the green and blue the system reserves for `good` and `info`, and a
// map reads colour as meaning — a list painted in "planned blue" breaks the
// legend for whoever picked it.
const LIST_COLOR_PRESETS = LIST_PALETTE_HEX;

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
  const addToast = useToastStore((s) => s.addToast);

  const [lists, setLists] = useState<PlaceList[]>([]);
  const [curated, setCurated] = useState<CuratedListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(LIST_COLOR_PRESETS[0]);
  const [newIcon, setNewIcon] = useState("");
  const [newLabelMode, setNewLabelMode] = useState<PlaceLabelMode>("name");
  const [saving, setSaving] = useState(false);

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

  const handleCreate = useCallback(async (): Promise<void> => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const created = await createPlaceList({
        name,
        color: newColor,
        // An empty input means "no symbol", which the column stores as null
        // rather than as an empty string nothing can tell apart from a space.
        icon: hasSymbol(newIcon) ? newIcon.trim() : null,
        labelMode: newLabelMode,
      });
      setCreating(false);
      setNewName("");
      navigate(`/places/lists/${created.id}`);
    } catch (err: unknown) {
      logger.error({ err }, "PlaceListsPage: failed to create list");
      addToast("error", t("places:lists.createFailed"));
    } finally {
      setSaving(false);
    }
  }, [newName, newColor, newIcon, newLabelMode, navigate, addToast, t]);

  const handleSubscribe = useCallback(
    async (key: string): Promise<void> => {
      try {
        await subscribeChecklist(key);
        navigate(`/places/checklists/${key}`);
      } catch (err: unknown) {
        logger.error({ err }, "PlaceListsPage: failed to subscribe");
        addToast("error", t("places:lists.subscribeFailed"));
      }
    },
    [navigate, addToast, t]
  );

  if (access === "pending") {
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

  return (
    <PageTransition>
      <NavigationBar />
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
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
            onClick={() => setCreating((v) => !v)}
            className="rounded-lg px-4 py-2 text-sm font-medium"
            style={{ background: "var(--accent)", color: "#0d1117" }}
          >
            + {t("places:lists.newList")}
          </button>
        </div>

        {creating && (
          <div
            className="mb-6 rounded-xl p-4"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
          >
            <label className="mb-2 block text-sm" style={{ color: "var(--text-muted)" }}>
              {t("places:lists.nameLabel")}
            </label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("places:lists.namePlaceholder")}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--color-border)",
                color: "var(--text-primary)",
              }}
            />
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                {t("places:lists.colorLabel")}
              </span>
              {LIST_COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setNewColor(c)}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: c,
                    border:
                      newColor === c
                        ? "2px solid var(--text-primary)"
                        : "1px solid var(--color-border)",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
            <PlaceListLabelFields
              icon={newIcon}
              onIconChange={setNewIcon}
              labelMode={newLabelMode}
              onLabelModeChange={setNewLabelMode}
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={saving || newName.trim().length === 0}
                onClick={() => void handleCreate()}
                className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#0d1117" }}
              >
                {t("common:buttons.save")}
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-lg px-4 py-2 text-sm"
                style={{ border: "1px solid var(--color-border)", color: "var(--text-secondary)" }}
              >
                {t("common:buttons.cancel")}
              </button>
            </div>
          </div>
        )}

        {loading && (
          <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            {t("common:loading.default")}
          </p>
        )}

        {loadError && (
          <div className="py-10 text-center">
            <p role="alert" style={{ color: "var(--danger)" }}>
              {t("places:lists.loadError")}
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 text-sm underline"
              style={{ color: "var(--accent)" }}
            >
              {t("common:buttons.retry")}
            </button>
          </div>
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
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {t("places:lists.ownEmpty")}
                </p>
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
    </PageTransition>
  );
}
