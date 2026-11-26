import { LIST_PALETTE_HEX } from "../lib/listPalette";
import GeoExportButtons from "../components/export/GeoExportButtons";
import { geoExportPaths } from "../lib/api/geoExport";
import { PlaceListLabelFields, hasSymbol } from "../components/places/PlaceListLabelFields";
import type { PlaceLabelMode } from "../lib/placeLabel";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import ConfirmModal from "../components/ui/ConfirmModal";
import { useTranslation } from "../hooks/useTranslation";
import { usePlacesAccess } from "../hooks/usePlacesVisible";
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
import { isTransientSaveError, saveErrorKey } from "../lib/saveErrorMessage";
import { FieldError, FormErrorBanner, fieldErrorProps } from "../components/form";
import { placeCategoryIcon } from "../lib/placeCategoryDisplay";
import { usePlaceCategories } from "../hooks/usePlaceCategories";
import { PlaceFormModal } from "../components/places/PlaceFormModal";
import SmartListPanel from "../components/places/smartList/SmartListPanel";
import PurposeSegment from "../components/purpose/PurposeSegment";
import PlaceListTable from "../components/places/listTable/PlaceListTable";
import OverflowMenu from "../components/ui/OverflowMenu";
import { PlaceListAddPanel, type UnassignedPlace } from "../components/places/PlaceListAddPanel";
import { useToastStore } from "../store/toastStore";
import type { Place } from "../types/place";
import type { PlaceList } from "../types/placeList";

// The shared ten from `listColor.palette`. The six that used to stand here
// included the green and blue the system reserves for `good` and `info`, and a
// map reads colour as meaning — a list painted in "planned blue" breaks the
// legend for whoever picked it.
const LIST_COLOR_PRESETS = LIST_PALETTE_HEX;

/** Touch sizing follows the pointer (forgejo#249): 44 px targets on an iPad only. */
const COARSE_BOX =
  "pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:min-w-(--ts-size-touch-min)";
const RENAME_ID = "place-list-rename";

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
  const { customs } = usePlaceCategories();
  const navigate = useNavigate();
  const access = usePlacesAccess();
  const addToast = useToastStore((s) => s.addToast);

  const [list, setList] = useState<PlaceList | null>(null);
  const [allPlaces, setAllPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  /** The smart-list rule dialog (list ⋯ → "Kette verknüpfen"). */
  const [ruleOpen, setRuleOpen] = useState(false);
  const [hasRule, setHasRule] = useState(false);
  const [draftName, setDraftName] = useState("");
  /** Why the rename was refused — said at the field, not in a toast (forgejo#246). */
  const [renameError, setRenameError] = useState<string | null>(null);
  /**
   * The last change to the list the server refused, kept on the page until the
   * next change succeeds — a toast that vanished was the only trace before —
   * with a way to ask again when asking again can help (forgejo#246/#247).
   */
  const [actionFailure, setActionFailure] = useState<{
    key: string;
    /** The refused change itself, sent again by "Erneut versuchen". */
    change?: () => Promise<PlaceList>;
    fallbackKey?: string;
  } | null>(null);
  const [addQuery, setAddQuery] = useState("");
  /** The name a new place starts with while the form is open over the list. */
  const [creatingName, setCreatingName] = useState<string | null>(null);
  /** Places created from here that the list did not take (yet). */
  const [unassigned, setUnassigned] = useState<UnassignedPlace[]>([]);
  /** Filings on their way, by place — a second tap must not send a second one. */
  const assigning = useRef(new Set<string>());

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

  /**
   * What the add search finds — over ALL the user's places, by name, the name
   * on the sign and city (review I3). Places already in the list are said as
   * such instead of vanishing: before, typing a member's name read as "not in
   * your logbook" and offered to create it a second time.
   */
  const { candidates, members } = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    if (q.length === 0) return { candidates: [], members: [] };
    const hits = allPlaces.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.localName ?? "").toLowerCase().includes(q) ||
        (p.city ?? "").toLowerCase().includes(q)
    );
    return {
      candidates: hits.filter((p) => !memberIds.has(p.id)).slice(0, 8),
      members: hits.filter((p) => memberIds.has(p.id)).slice(0, 8),
    };
  }, [allPlaces, memberIds, addQuery]);

  /** Send one change; a refusal stays on the page with a way to send it again. */
  const runChange = useCallback(
    async (change: () => Promise<PlaceList>, fallbackKey: string): Promise<boolean> => {
      try {
        setList(await change());
        setActionFailure(null);
        return true;
      } catch (err: unknown) {
        logger.error({ err }, "PlaceListDetailPage: a list change was refused");
        setActionFailure({ key: saveErrorKey(err, fallbackKey), change, fallbackKey });
        return false;
      }
    },
    []
  );

  const handleAdd = useCallback(
    async (placeId: string): Promise<void> => {
      if (!list) return;
      const done = await runChange(
        () => addPlaceToList(list.id, placeId),
        "places:lists.addFailed"
      );
      if (done) setAddQuery("");
    },
    [list, runChange]
  );

  /**
   * File a place created from this list into it — once. The place exists
   * already, so a refusal leaves it in the logbook and puts a row in the add
   * panel that says so and offers "Erneut zuordnen" for this place alone.
   */
  const assignCreated = useCallback(
    async (placeId: string, created?: Place): Promise<void> => {
      if (!list || assigning.current.has(placeId)) return;
      assigning.current.add(placeId);
      setUnassigned((rows) =>
        rows.map((row) => (row.place.id === placeId ? { ...row, retrying: true } : row))
      );
      try {
        setList(await addPlaceToList(list.id, placeId));
        setUnassigned((rows) => rows.filter((row) => row.place.id !== placeId));
      } catch (err: unknown) {
        logger.error({ err, placeId }, "PlaceListDetailPage: the list did not take a new place");
        const reasonKey = saveErrorKey(err, "places:lists.addFailed");
        setUnassigned((rows) => {
          const known = rows.find((row) => row.place.id === placeId)?.place ?? created;
          if (!known) return rows;
          const rest = rows.filter((row) => row.place.id !== placeId);
          return [...rest, { place: known, reasonKey, retrying: false }];
        });
      } finally {
        assigning.current.delete(placeId);
      }
    },
    [list]
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
   * happen — and a retry sends the very order that was refused.
   */
  /** One step in the list's own order ("Eigene Reihenfolge"). */
  const handleMove = useCallback(
    async (placeId: string, delta: -1 | 1): Promise<void> => {
      if (!list) return;
      const ids = entries.map((e) => e.placeId);
      const index = ids.indexOf(placeId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      await runChange(() => reorderPlaceList(list.id, ids), "places:lists.reorderFailed");
    },
    [list, entries, runChange]
  );

  const handleRemove = useCallback(
    async (placeId: string): Promise<void> => {
      if (!list) return;
      await runChange(() => removePlaceFromList(list.id, placeId), "places:lists.removeFailed");
    },
    [list, runChange]
  );

  const handleRename = useCallback(async (): Promise<void> => {
    if (!list) return;
    const name = draftName.trim();
    // An empty name is refused at the field instead of being dropped without a
    // word — the old handler simply closed the editor and kept the old name.
    if (!name) {
      setRenameError("places:lists.nameRequired");
      return;
    }
    if (name === list.name) {
      setRenaming(false);
      return;
    }
    try {
      setList(await updatePlaceList(list.id, { name }));
      setRenaming(false);
      setRenameError(null);
    } catch (err: unknown) {
      logger.error({ err }, "PlaceListDetailPage: failed to rename list");
      setRenameError(saveErrorKey(err, "places:lists.saveFailed"));
    }
  }, [list, draftName]);

  /**
   * Symbol and label mode save together.
   *
   * They are one decision to the user and one guarded pair in the form -- the
   * mode falls back when the symbol is cleared -- so sending them as two
   * requests would let the pair land half-applied if the second one failed.
   */
  // The symbol is a text field on a page that saves as you go, so it is edited
  // as a draft and committed on blur. Seeded from the list once it loads, and
  // re-seeded if the list itself is replaced.
  const [draftIcon, setDraftIcon] = useState("");
  useEffect(() => {
    setDraftIcon(list?.icon ?? "");
  }, [list?.id, list?.icon]);

  const handleLabel = useCallback(
    async (icon: string, labelMode: PlaceLabelMode): Promise<void> => {
      if (!list) return;
      await runChange(
        () =>
          updatePlaceList(list.id, {
            icon: hasSymbol(icon) ? icon.trim() : null,
            labelMode,
          }),
        "places:lists.saveFailed"
      );
    },
    [list, runChange]
  );

  const handleColor = useCallback(
    async (color: string): Promise<void> => {
      if (!list) return;
      await runChange(() => updatePlaceList(list.id, { color }), "places:lists.saveFailed");
    },
    [list, runChange]
  );

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!list) return;
    try {
      await deletePlaceList(list.id);
      addToast("success", t("places:lists.deleted", { name: list.name }));
      navigate("/places/lists");
    } catch (err: unknown) {
      logger.error({ err }, "PlaceListDetailPage: failed to delete list");
      setConfirmDelete(false);
      // No retry from the banner: deleting is asked for again through the
      // same confirmation, which still names what goes.
      setActionFailure({ key: saveErrorKey(err, "places:lists.deleteFailed") });
    }
  }, [list, navigate, addToast, t]);

  if (access === "pending" || loading) {
    return (
      <AppShell>
        <p className="py-16 text-center text-[var(--text-muted)]">{t("common:loading.default")}</p>
      </AppShell>
    );
  }

  if (access === "denied") {
    return (
      <AppShell>
        <p className="py-16 text-center text-[var(--text-muted)]">
          {t("places:list.domainDisabled")}
        </p>
      </AppShell>
    );
  }

  if (failure !== null || !list) {
    const isLoadError = failure === "loadError";
    return (
      <AppShell>
        <div className="py-16 text-center">
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
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div>
        <Link to="/places/lists" className="text-sm" style={{ color: "var(--text-muted)" }}>
          ← {t("places:lists.backToLists")}
        </Link>

        <div className="mt-3 mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {renaming ? (
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Named for a screen reader; the heading it replaces is the
                      visible context. Cancel is a button, not only Escape —
                      an iPad has no Escape key. */}
                  <input
                    id={RENAME_ID}
                    aria-label={t("places:lists.nameLabel")}
                    value={draftName}
                    autoFocus
                    maxLength={120}
                    onChange={(e) => {
                      setDraftName(e.target.value);
                      setRenameError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleRename();
                      if (e.key === "Escape") setRenaming(false);
                    }}
                    {...fieldErrorProps(RENAME_ID, renameError ? t(renameError) : null)}
                    className={`rounded-lg px-3 py-1.5 text-lg ${COARSE_BOX}`}
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--color-border)",
                      color: "var(--text-primary)",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void handleRename()}
                    className={`text-sm underline ${COARSE_BOX}`}
                    style={{ color: "var(--accent)" }}
                  >
                    {t("common:buttons.save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRenaming(false);
                      setRenameError(null);
                    }}
                    className={`text-sm ${COARSE_BOX}`}
                    style={{ color: "var(--text-muted)" }}
                  >
                    {t("common:buttons.cancel")}
                  </button>
                </div>
                <FieldError id={RENAME_ID} error={renameError ? t(renameError) : null} />
              </div>
            ) : (
              <h1 className="t-screen-title flex items-center gap-3">
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
                    setRenameError(null);
                    setRenaming(true);
                  }}
                  className={`text-sm font-normal underline ${COARSE_BOX}`}
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
            <GeoExportButtons
              path={geoExportPaths.places}
              params={{ listId: list.id }}
              testId="place-list-export"
              className="mt-2 flex flex-wrap items-center gap-2"
            />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <OverflowMenu
              label={t("common:buttons.moreActions")}
              triggerLabel={t("common:buttons.more")}
              testId="place-list-more"
              entries={[
                {
                  key: "smart-rule",
                  label: hasRule ? t("places:smartList.editRule") : t("places:smartList.menuEntry"),
                  hint: hasRule ? undefined : t("places:smartList.menuHint"),
                  onSelect: () => setRuleOpen(true),
                },
                // Destructive actions live last in the ⋯ menu, in red, behind the page's own
                // confirmation (the rc.43 rule; UAT rc.45 retest D24) — not as a red button.
                {
                  key: "delete-list",
                  label: t("places:lists.deleteList"),
                  danger: true,
                  onSelect: () => setConfirmDelete(true),
                },
              ]}
            />
          </div>
        </div>

        <PurposeSegment />

        <SmartListPanel
          listId={list.id}
          ruleOpen={ruleOpen}
          onRuleClose={() => setRuleOpen(false)}
          onChanged={() => void load()}
          onRuleLoaded={setHasRule}
          onEditRule={() => setRuleOpen(true)}
        />

        {/* A refused change, kept until the next one succeeds (forgejo#246). */}
        <div className="mb-4">
          <FormErrorBanner
            message={actionFailure !== null ? t(actionFailure.key) : null}
            onRetry={
              actionFailure?.change !== undefined &&
              actionFailure.fallbackKey !== undefined &&
              isTransientSaveError(actionFailure.key)
                ? () => {
                    const { change, fallbackKey } = actionFailure;
                    if (change && fallbackKey) void runChange(change, fallbackKey);
                  }
                : undefined
            }
          />
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("places:lists.colorLabel")}
          </span>
          {LIST_COLOR_PRESETS.map((c) => (
            // The swatch stays 22 px; on a coarse pointer the button around it
            // grows to the touch minimum (forgejo#249). `aria-pressed` says
            // which colour is the list's — the ring alone was visual only.
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={list.color.toLowerCase() === c.toLowerCase()}
              onClick={() => void handleColor(c)}
              className={`inline-flex items-center justify-center ${COARSE_BOX}`}
            >
              <span
                aria-hidden
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
            </button>
          ))}
        </div>

        <div className="mb-6">
          <PlaceListLabelFields
            icon={draftIcon}
            onIconChange={setDraftIcon}
            onIconCommit={(icon) => void handleLabel(icon, list.labelMode)}
            labelMode={list.labelMode}
            onLabelModeChange={(mode) => void handleLabel(draftIcon, mode)}
          />
        </div>

        {/* Add a place: search the logbook, or create the place right here
            when the search finds nothing (forgejo#230). */}
        <PlaceListAddPanel
          query={addQuery}
          onQueryChange={setAddQuery}
          candidates={candidates}
          members={members}
          onAdd={(placeId) => void handleAdd(placeId)}
          onCreate={() => setCreatingName(addQuery.trim())}
          unassigned={unassigned}
          onRetry={(placeId) => void assignCreated(placeId)}
          onDismiss={(placeId) =>
            setUnassigned((rows) => rows.filter((row) => row.place.id !== placeId))
          }
        />

        <PlaceListTable
          listId={list.id}
          refreshKey={list}
          iconOf={(category) => placeCategoryIcon(category, customs)}
          onRemove={(placeId) => void handleRemove(placeId)}
          onMove={handleMove}
        />

        {creatingName !== null && (
          <PlaceFormModal
            place={null}
            initialName={creatingName}
            forList={list.name}
            onClose={() => setCreatingName(null)}
            onSaved={(created) => {
              // Back on the list at once; the filing follows, and only it can
              // fail from here on — the place itself is stored.
              setCreatingName(null);
              setAddQuery("");
              // A deduped create answers a place already here (same reference):
              // replace by id, never list it twice (review M2).
              setAllPlaces((rows) => [...rows.filter((p) => p.id !== created.id), created]);
              void assignCreated(created.id, created);
            }}
          />
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
    </AppShell>
  );
}
