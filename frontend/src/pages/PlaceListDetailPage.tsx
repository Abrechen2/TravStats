import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import NavigationBar from "../components/NavigationBar";
import PageTransition from "../components/PageTransition";
import ConfirmModal from "../components/Training/ConfirmModal";
import { useTranslation } from "../hooks/useTranslation";
import { usePlacesAccess } from "../hooks/usePlacesVisible";
import { FlagImg } from "../lib/countryFlag";
import { logger } from "../lib/logger";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import { listPlaces } from "../lib/api/places";
import {
  addPlaceToList,
  deletePlaceList,
  getPlaceList,
  removePlaceFromList,
  reorderPlaceList,
  updatePlaceList,
} from "../lib/api/placeLists";
import { DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { PLACE_CATEGORY_ICONS } from "../shared/placeCategories";
import { DOMAINS } from "../shared/domains";
import { useToastStore } from "../store/toastStore";
import type { Place } from "../types/place";
import type { PlaceList } from "../types/placeList";

const LIST_COLOR_PRESETS = [
  DOMAINS.poi.color,
  "#e3b341",
  "#db6d5a",
  "#8957e5",
  "#3fb950",
  "#58a6ff",
] as const;

/**
 * One list: what is in it, and the two things a user does to it.
 *
 * A SUBSCRIBED checklist reaching this page is redirected to its progress
 * screen. The two are the same row in the database, but not the same screen:
 * this one lets you add and remove places, and a checklist's membership comes
 * from the catalog — the server refuses those edits, so offering the buttons
 * would be a UI that produces 409s.
 */
export default function PlaceListDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation(["places", "common"]);
  const navigate = useNavigate();
  const access = usePlacesAccess();
  const addToast = useToastStore((s) => s.addToast);

  const [list, setList] = useState<PlaceList | null>(null);
  const [allPlaces, setAllPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [addQuery, setAddQuery] = useState("");

  const load = useCallback(async (): Promise<void> => {
    if (!id) return;
    setLoading(true);
    setFailure(null);
    try {
      const [one, places] = await Promise.all([getPlaceList(id), listPlaces({})]);
      setList(one);
      setAllPlaces(places);
    } catch (err: unknown) {
      logger.error({ err }, "PlaceListDetailPage: failed to load list");
      setFailure(classifyLoadFailure(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (access !== "allowed") return;
    void load();
  }, [access, load]);

  // A checklist subscription belongs on the progress screen. Redirect rather
  // than render a page whose every mutation the server would reject.
  useEffect(() => {
    if (list?.curatedKey) navigate(`/places/checklists/${list.curatedKey}`, { replace: true });
  }, [list?.curatedKey, navigate]);

  const entries = useMemo(() => list?.entries ?? [], [list]);
  const memberIds = useMemo(() => new Set(entries.map((e) => e.placeId)), [entries]);

  const candidates = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    if (q.length === 0) return [];
    return allPlaces
      .filter((p) => !memberIds.has(p.id))
      .filter((p) => p.name.toLowerCase().includes(q) || (p.city ?? "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [allPlaces, memberIds, addQuery]);

  const handleAdd = useCallback(
    async (placeId: string): Promise<void> => {
      if (!list) return;
      try {
        setList(await addPlaceToList(list.id, placeId));
        setAddQuery("");
      } catch (err: unknown) {
        logger.error({ err }, "PlaceListDetailPage: failed to add place");
        addToast("error", t("places:lists.addFailed"));
      }
    },
    [list, addToast, t]
  );

  /**
   * Move one entry up or down. `PUT /place-lists/:id/entries/order` was built
   * and tested when the list feature landed, and nothing ever called it — the
   * list could only ever be in the order things were added.
   *
   * Up/down buttons rather than a drag handle: `CruiseStopsEditor` already
   * reorders this way, no drag-and-drop library is installed, and buttons work
   * with a keyboard without any extra work.
   *
   * The whole order is sent, not a pair of indices: the route takes the list of
   * place ids and rewrites the positions from it, so a half-applied swap cannot
   * happen.
   */
  const handleMove = useCallback(
    async (index: number, delta: number): Promise<void> => {
      if (!list) return;
      const target = index + delta;
      if (target < 0 || target >= entries.length) return;

      const ids = entries.map((e) => e.placeId);
      [ids[index], ids[target]] = [ids[target], ids[index]];
      try {
        setList(await reorderPlaceList(list.id, ids));
      } catch (err: unknown) {
        logger.error({ err }, "PlaceListDetailPage: failed to reorder");
        addToast("error", t("places:lists.reorderFailed"));
      }
    },
    [list, entries, addToast, t]
  );

  const handleRemove = useCallback(
    async (placeId: string): Promise<void> => {
      if (!list) return;
      try {
        setList(await removePlaceFromList(list.id, placeId));
      } catch (err: unknown) {
        logger.error({ err }, "PlaceListDetailPage: failed to remove place");
        addToast("error", t("places:lists.removeFailed"));
      }
    },
    [list, addToast, t]
  );

  const handleRename = useCallback(async (): Promise<void> => {
    if (!list) return;
    const name = draftName.trim();
    if (!name || name === list.name) {
      setRenaming(false);
      return;
    }
    try {
      setList(await updatePlaceList(list.id, { name }));
      setRenaming(false);
    } catch (err: unknown) {
      logger.error({ err }, "PlaceListDetailPage: failed to rename list");
      addToast("error", t("places:lists.saveFailed"));
    }
  }, [list, draftName, addToast, t]);

  const handleColor = useCallback(
    async (color: string): Promise<void> => {
      if (!list) return;
      try {
        setList(await updatePlaceList(list.id, { color }));
      } catch (err: unknown) {
        logger.error({ err }, "PlaceListDetailPage: failed to recolour list");
        addToast("error", t("places:lists.saveFailed"));
      }
    },
    [list, addToast, t]
  );

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!list) return;
    try {
      await deletePlaceList(list.id);
      addToast("success", t("places:lists.deleted", { name: list.name }));
      navigate("/places/lists");
    } catch (err: unknown) {
      logger.error({ err }, "PlaceListDetailPage: failed to delete list");
      addToast("error", t("places:lists.deleteFailed"));
    }
  }, [list, navigate, addToast, t]);

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

  if (failure !== null || !list) {
    const isLoadError = failure === "loadError";
    return (
      <PageTransition>
        <NavigationBar />
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <p role="alert" style={{ color: "var(--danger)" }}>
            {isLoadError ? t("places:lists.loadError") : t("places:lists.notFound")}
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

  return (
    <PageTransition>
      <NavigationBar />
      <div className="mx-auto max-w-[1000px] px-4 py-6 sm:px-6">
        <Link to="/places/lists" className="text-sm" style={{ color: "var(--text-muted)" }}>
          ← {t("places:lists.backToLists")}
        </Link>

        <div className="mt-3 mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {renaming ? (
              <div className="flex items-center gap-2">
                <input
                  value={draftName}
                  autoFocus
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleRename();
                    if (e.key === "Escape") setRenaming(false);
                  }}
                  className="rounded-lg px-3 py-1.5 text-lg"
                  style={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--color-border)",
                    color: "var(--text-primary)",
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handleRename()}
                  className="text-sm underline"
                  style={{ color: "var(--accent)" }}
                >
                  {t("common:buttons.save")}
                </button>
              </div>
            ) : (
              <h1 className="font-display flex items-center gap-3 text-2xl font-semibold tracking-tight">
                <span
                  aria-hidden
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: list.color,
                    flex: "none",
                  }}
                />
                {list.icon && <span aria-hidden>{list.icon}</span>}
                <span className="truncate">{list.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setDraftName(list.name);
                    setRenaming(true);
                  }}
                  className="text-sm font-normal underline"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t("common:buttons.edit")}
                </button>
              </h1>
            )}
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {t("places:lists.counts", {
                places: list.placeCount,
                visited: list.visitedCount,
                countries: list.countryCount,
              })}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="shrink-0 rounded-lg px-4 py-2 text-sm"
            style={{ border: "1px solid var(--color-border)", color: "var(--danger)" }}
          >
            {t("places:lists.deleteList")}
          </button>
        </div>

        <div className="mb-6 flex items-center gap-2">
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("places:lists.colorLabel")}
          </span>
          {LIST_COLOR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => void handleColor(c)}
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: c,
                border:
                  list.color.toLowerCase() === c.toLowerCase()
                    ? "2px solid var(--text-primary)"
                    : "1px solid var(--color-border)",
                cursor: "pointer",
              }}
            />
          ))}
        </div>

        {/* Add a place. Search-as-you-type over the places the user already has
            — a list groups the logbook, it does not create entries in it. */}
        <div
          className="mb-6 rounded-xl p-4"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <label className="mb-2 block text-sm" style={{ color: "var(--text-muted)" }}>
            {t("places:lists.addPlace")}
          </label>
          <input
            value={addQuery}
            onChange={(e) => setAddQuery(e.target.value)}
            placeholder={t("places:lists.addPlacePlaceholder")}
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--color-border)",
              color: "var(--text-primary)",
            }}
          />
          {addQuery.trim().length > 0 && (
            <ul className="mt-2" style={{ listStyle: "none", padding: 0 }}>
              {candidates.length === 0 ? (
                <li className="py-2 text-sm" style={{ color: "var(--text-muted)" }}>
                  {t("places:lists.addNoMatches")}
                </li>
              ) : (
                candidates.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => void handleAdd(p.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <span aria-hidden>{PLACE_CATEGORY_ICONS[p.category]}</span>
                      <span className="truncate">{p.name}</span>
                      <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
                        {p.city ?? ""}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        {entries.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            {t("places:lists.listEmpty")}
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }} className="grid gap-2">
            {entries.map((entry, index) => {
              const p = entry.place;
              return (
                <li
                  key={entry.id}
                  className="flex items-center gap-3 rounded-xl px-4 py-3"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <span aria-hidden>{PLACE_CATEGORY_ICONS[p.category]}</span>
                  <Link
                    to={`/places/${p.id}`}
                    className="min-w-0 flex-1 truncate text-sm"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {p.name}
                  </Link>
                  <span
                    className="hidden items-center gap-1 text-xs sm:flex"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {[p.city, p.country].filter(Boolean).join(", ")}
                    {p.country && <FlagImg country={p.country} />}
                  </span>
                  <span
                    className="rounded px-2 py-0.5 text-xs"
                    style={
                      p.visited
                        ? {
                            color: "var(--success)",
                            background: "rgba(63,185,80,0.08)",
                            border: "1px solid rgba(63,185,80,0.35)",
                          }
                        : { color: "var(--text-muted)", border: "1px dashed var(--color-border)" }
                    }
                  >
                    {p.visited
                      ? t("places:list.status.visited")
                      : t("places:list.status.wishlist")}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleMove(index, -1)}
                    disabled={index === 0}
                    aria-label={t("places:lists.moveUp", { name: p.name })}
                    title={t("places:lists.moveUp", { name: p.name })}
                    className="px-1 text-sm disabled:opacity-30"
                    style={{ color: "var(--text-muted)" }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleMove(index, 1)}
                    disabled={index === entries.length - 1}
                    aria-label={t("places:lists.moveDown", { name: p.name })}
                    title={t("places:lists.moveDown", { name: p.name })}
                    className="px-1 text-sm disabled:opacity-30"
                    style={{ color: "var(--text-muted)" }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRemove(p.id)}
                    aria-label={t("places:lists.removeFromList", { name: p.name })}
                    className="text-sm"
                    style={{ color: "var(--text-muted)" }}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* Removing a list removes the GROUPING, never the places. Said out loud
            here because "Liste löschen" reads like it might take them along. */}
        <ConfirmModal
          isOpen={confirmDelete}
          title={t("places:lists.deleteTitle")}
          message={t("places:lists.deleteMessage", { name: list.name, count: list.placeCount })}
          confirmText={t("common:buttons.delete")}
          cancelText={t("common:buttons.cancel")}
          confirmButtonClass={DELETE_BUTTON_CLASS}
          onConfirm={() => void handleDelete()}
          onClose={() => setConfirmDelete(false)}
        />
      </div>
    </PageTransition>
  );
}
