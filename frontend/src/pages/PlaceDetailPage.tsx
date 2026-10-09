import { useCallback, useEffect, useMemo, useState } from "react";
import WikipediaCard from "../components/common/WikipediaCard";
import type { JSX } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import DetailHeader from "../components/ui/DetailHeader";
import DetailSection from "../components/ui/DetailSection";
import Button from "../components/ui/Button";
import { statusPillStyle } from "../components/table/statusPillStyle";
import ConfirmModal from "../components/Training/ConfirmModal";
import { LocationMiniMap } from "../components/location/LocationMiniMap";
import { PlaceFormModal } from "../components/places/PlaceFormModal";
import { VisitPhotoStrip } from "../components/places/VisitPhotoStrip";
import { PlaceGallery } from "../components/places/PlaceGallery";
import { VisitDialog } from "../components/places/VisitDialog";
import { PlaceMergeDialog } from "../components/places/PlaceMergeDialog";
import { FormErrorBanner } from "../components/form";
import { isTransientSaveError, saveErrorKey } from "../lib/saveErrorMessage";
import DocumentsSection from "../components/documents/DocumentsSection";
import { RowActionButton, RowActions } from "../components/table/RowActionButton";
import { useDocumentCount } from "../hooks/useDocumentCount";
import { useTranslation } from "../hooks/useTranslation";
import { usePlacesAccess } from "../hooks/usePlacesVisible";
import { FlagImg } from "../lib/countryFlag";
import { placeCountryLabel, placeCountryCode } from "../lib/placeCountry";
import { logger } from "../lib/logger";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import { DELETE_BUTTON_CLASS, survivorsNote, withDocumentNote } from "../lib/deleteConfirm";
import { placeDeleteMessage } from "../lib/placeDeleteMessage";
import { usePlaceRelations } from "../hooks/usePlaceRelations";
import { deletePlace, deleteVisit, getPlace } from "../lib/api/places";
import { EDIT_PARAM, useEditDeepLink } from "../lib/editDeepLink";
import { tripsApi } from "../lib/api/trips";
import type { Trip } from "../types";
import { useToastStore } from "../store/toastStore";
import { PLACE_CATEGORY_ICONS } from "../shared/placeCategories";
import { classifyVisit } from "../shared/placeCounting";
import { splitTimeValue } from "../lib/tripTimeline";
import { visitTime as visitTimeOf } from "../lib/entityTimes";
import type { Place, PlaceVisit } from "../types/place";

export default function PlaceDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation(["places", "common"]);
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const access = usePlacesAccess();

  const [place, setPlace] = useState<Place | null>(null);
  const [loading, setLoading] = useState(true);
  // Two states, not one: a 404 means the place is gone, anything else means
  // we could not ask. Same distinction the flight, cruise and lodging detail
  // pages make — collapsing them told a user with a dropped connection that
  // their place had been deleted.
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [editing, setEditing] = useState(false);
  /** The duplicate merge (forgejo#232) — only ever on the user's say-so. */
  const [merging, setMerging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** A refused delete, kept on the page with its retry (forgejo#246) — it was a toast. */
  const [actionFailure, setActionFailure] = useState<{
    key: string;
    /** What "Erneut versuchen" sends again — only offered for a transient failure. */
    redo?: { kind: "visit"; id: string } | { kind: "place" };
  } | null>(null);
  const deleteRelations = usePlaceRelations(confirmDelete && id ? id : null);
  /**
   * Which visit the reader is being asked about, if any.
   *
   * There was no question at all before: the row's delete icon called the API
   * on the first click. Finding 3 of the write-path audit (2026-09-19) is why
   * that mattered — `Document.placeVisitId` cascades (`onDelete: Cascade`,
   * proven live by
   * `backend/src/__tests__/integrity/cascades.integrity.test.ts`) and the
   * route deletes the visit's photograph FILES from disk as well. One
   * mis-aimed click took a ticket and a day's pictures with it.
   */
  const [confirmVisitDelete, setConfirmVisitDelete] = useState<PlaceVisit | null>(null);
  const visitDocumentCount = useDocumentCount(
    confirmVisitDelete ? { type: "placeVisit", id: confirmVisitDelete.id } : null
  );
  /**
   * The visit dialog: `{ visit: null }` records a new one, `{ visit }` edits
   * that one (forgejo#231). It replaced the inline panel, whose errors were
   * toasts and whose second tap could store a second visit.
   */
  const [visitDialog, setVisitDialog] = useState<{ visit: PlaceVisit | null } | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);

  const load = useCallback(async (): Promise<void> => {
    if (!id) return;
    setLoading(true);
    setFailure(null);
    try {
      setPlace(await getPlace(id));
    } catch (err: unknown) {
      logger.error({ err }, "PlaceDetailPage: failed to load place");
      setFailure(classifyLoadFailure(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Visits newest first, with the PLANNED ones kept separate rather than
   * folded in. The split is the future-date rule made visible: a visit dated
   * next month belongs on the page, and belongs in no count
   * (shared/placeCounting.ts).
   */
  const { completed, planned } = useMemo(() => {
    const all = place?.visits ?? [];
    const now = new Date();
    const byDateDesc = (a: PlaceVisit, b: PlaceVisit): number => {
      const av = a.visitedAt ? Date.parse(a.visitedAt) : Number.NEGATIVE_INFINITY;
      const bv = b.visitedAt ? Date.parse(b.visitedAt) : Number.NEGATIVE_INFINITY;
      return bv - av;
    };
    return {
      completed: all.filter((v) => classifyVisit(v, now) === "visited").sort(byDateDesc),
      planned: all.filter((v) => classifyVisit(v, now) === "planned").sort(byDateDesc),
    };
  }, [place]);

  /**
   * Re-read the place after a visit was stored, WITHOUT the page's loading
   * state: `load` swaps the whole page for "Laden …", which would unmount the
   * dialog in the middle of its save. A failure is thrown to the dialog, which
   * says "gespeichert, Ansicht nicht aktualisiert" instead of "nicht
   * gespeichert" (forgejo#247).
   */
  const refresh = useCallback(async (): Promise<void> => {
    if (!id) return;
    setPlace(await getPlace(id));
  }, [id]);

  // For a new visit whose answer was lost: the page re-reads in place (no
  // loading screen), so the dialog and its draft stay while the user looks.
  const refreshQuietly = useCallback(async (): Promise<void> => {
    try {
      await refresh();
    } catch (err: unknown) {
      logger.error({ err }, "PlaceDetailPage: reload from the visit dialog failed");
      addToast("error", t("places:detail.loadError"));
    }
  }, [refresh, addToast, t]);

  const openVisitEditor = useCallback((visit: PlaceVisit): void => {
    setVisitDialog({ visit });
  }, []);

  // `?edit=1` opens the place form (a missing zone comes from the place's
  // coordinates), `?editVisit=<id>` that visit's form — the inbox's two links
  // for a time the time-model migration could not resolve (timeFlagLinks.ts).
  useEditDeepLink(EDIT_PARAM.edit, place !== null, () => setEditing(true));
  useEditDeepLink(EDIT_PARAM.editVisit, place !== null, (visitId) => {
    const visit = place?.visits?.find((v) => v.id === visitId);
    if (visit) openVisitEditor(visit);
    else addToast("error", t("places:detail.visitNotFound"));
  });

  // The trip list for the selector above. Loaded once, not per open: the
  // choice is offered on every visit form and re-fetching on each toggle
  // would flash an empty dropdown.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await tripsApi.getAll();
        if (!cancelled) setTrips(rows);
      } catch (err: unknown) {
        logger.error({ err }, "PlaceDetailPage: failed to load trips");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Delete a visit. The delete and the re-read after it are two steps: a
   * re-read that fails said "konnte nicht gelöscht werden" about a visit that
   * WAS deleted (forgejo#247). Each failure now stays on the page, named.
   */
  const removeVisit = useCallback(
    async (visitId: string): Promise<void> => {
      setDeleting(true);
      setActionFailure(null);
      try {
        await deleteVisit(visitId);
      } catch (err: unknown) {
        logger.error({ err }, "PlaceDetailPage: delete visit failed");
        const key = saveErrorKey(err, "places:detail.visitDeleteFailed");
        setActionFailure({ key, redo: { kind: "visit", id: visitId } });
        return;
      } finally {
        setDeleting(false);
        setConfirmVisitDelete(null);
      }
      try {
        await refresh();
      } catch (err: unknown) {
        logger.error({ err }, "PlaceDetailPage: re-read after deleting a visit failed");
        setActionFailure({ key: "places:detail.deletedViewStale" });
      }
    },
    [refresh]
  );

  const removePlace = useCallback(async (): Promise<void> => {
    if (!place) return;
    setDeleting(true);
    setActionFailure(null);
    try {
      await deletePlace(place.id);
    } catch (err: unknown) {
      logger.error({ err }, "PlaceDetailPage: delete failed");
      const key = saveErrorKey(err, "places:list.deleteFailed");
      setActionFailure({ key, redo: { kind: "place" } });
      setConfirmDelete(false);
      setDeleting(false);
      return;
    }
    setDeleting(false);
    addToast("success", t("places:list.deleted", { name: place.name }));
    navigate("/places");
  }, [place, addToast, t, navigate]);

  // ISO date in the visit list, as every table row in round 4 (E7).
  const formatVisit = useCallback(
    (v: PlaceVisit): string => {
      const shown = visitTimeOf(v);
      if (!shown) return t("places:detail.undated");
      const { date, time } = splitTimeValue(shown);
      return time ? `${date} ${time}` : date;
    },
    [t]
  );

  if (access === "denied") {
    return (
      <AppShell width="reading">
        <p className="py-16 text-center text-[var(--text-muted)]">
          {t("places:list.domainDisabled")}
        </p>
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell width="reading">
        <p className="py-16 text-center text-[var(--text-muted)]">{t("common:loading.default")}</p>
      </AppShell>
    );
  }

  if (failure !== null || !place) {
    const isLoadError = failure === "loadError";
    return (
      <AppShell width="reading">
        <div className="py-16 text-center">
          <p role="alert" style={{ color: "var(--danger)" }}>
            {isLoadError ? t("places:detail.loadError") : t("places:detail.notFound")}
          </p>
          {isLoadError && (
            <div className="mt-3 flex justify-center">
              <Button onClick={() => void load()}>{t("common:buttons.retry")}</Button>
            </div>
          )}
          <Link to="/places" className="ts-back-link mt-3 inline-block text-sm">
            ← {t("places:detail.backToList")}
          </Link>
        </div>
      </AppShell>
    );
  }

  const countryLabel = placeCountryLabel(place, i18n.language);
  const countryCode = placeCountryCode(place);
  const visitCount = completed.length + planned.length;

  const visitRow = (v: PlaceVisit, isPlanned: boolean, first: boolean): JSX.Element => (
    <li
      key={v.id}
      className="flex flex-col gap-2 py-3"
      style={first ? undefined : { borderTop: "1px solid var(--ts-border)" }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span
          className="shrink-0 whitespace-nowrap text-sm"
          style={{
            fontFamily: "var(--ts-font-mono)",
            minWidth: 96,
            color: v.visitedAt ? "var(--ts-text-bright)" : "var(--ts-muted)",
          }}
        >
          {formatVisit(v)}
        </span>
        <span
          className="order-last min-w-0 basis-full truncate text-sm sm:order-none sm:basis-0 sm:flex-1"
          style={{ color: "var(--ts-text)" }}
        >
          {v.notes ?? ""}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0">
          {isPlanned && (
            <span
              className="ts-status-pill shrink-0"
              style={{
                color: "var(--ts-warn)",
                borderColor: "color-mix(in srgb, var(--ts-warn) 35%, transparent)",
                background: "color-mix(in srgb, var(--ts-warn) 8%, transparent)",
              }}
            >
              {t("places:detail.notCountedYet")}
            </span>
          )}
          <RowActions>
            <RowActionButton
              icon="edit"
              label={t("places:detail.editVisit")}
              onClick={() => openVisitEditor(v)}
            />
            <RowActionButton
              icon="delete"
              label={t("common:buttons.delete")}
              onClick={() => setConfirmVisitDelete(v)}
            />
          </RowActions>
        </span>
      </div>
      {/* Proof hangs off the VISIT, not the place: "I was here in 2019" and
          "I was here last week" are two different sets of pictures. */}
      {!isPlanned && <VisitPhotoStrip visitId={v.id} photos={v.photos ?? []} />}
      {/* Same reasoning, same place: the API files documents against the VISIT
          (`/places/visits/:id/documents`), so a ticket belongs to the day it
          was used rather than to the place that is always there.
          NOT guarded by `isPlanned`, unlike the photographs above: a ticket
          exists BEFORE the day it is used, and that is the commonest reason
          to keep one at all. The photo strip is guarded because a picture of
          a visit that has not happened is not a thing. */}
      <DocumentsSection entry={{ type: "placeVisit", id: v.id }} layout="inline" />
    </li>
  );

  return (
    <AppShell width="list">
      <DetailHeader
        backTo="/places"
        backLabel={t("places:detail.backToLogbook")}
        domain="poi"
        icon={PLACE_CATEGORY_ICONS[place.category]}
        title={place.name}
        // The name on the sign, under the readable one (forgejo#199).
        subtitle={
          place.localName ? (
            <span data-testid="place-local-name">{place.localName}</span>
          ) : undefined
        }
        meta={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {[place.address ?? place.city, countryLabel].filter(Boolean).join(" · ") || "—"}
            {countryCode && <FlagImg country={countryCode} />}
          </span>
        }
        status={
          <>
            <span className="ts-status-pill" style={statusPillStyle("scheduled")}>
              {t(`places:categories.${place.category}`)}
            </span>
            <span
              className="ts-status-pill"
              style={statusPillStyle(place.visited ? "flown" : "historical")}
            >
              {place.visited ? t("places:list.status.visited") : t("places:list.status.wishlist")}
            </span>
          </>
        }
        actions={
          <>
            <Button onClick={() => setEditing(true)}>{t("common:buttons.edit")}</Button>
            <Button onClick={() => setMerging(true)}>{t("places:merge.action")}</Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              {t("places:detail.deletePlace")}
            </Button>
          </>
        }
      />

      {actionFailure !== null && (
        <div className="mb-4">
          <FormErrorBanner
            message={t(actionFailure.key)}
            onRetry={
              actionFailure.redo && isTransientSaveError(actionFailure.key)
                ? () => {
                    const redo = actionFailure.redo;
                    if (redo?.kind === "visit") void removeVisit(redo.id);
                    else if (redo?.kind === "place") void removePlace();
                  }
                : undefined
            }
            retryDisabled={deleting}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <PlaceGallery key={place.id} place={place} />
          <WikipediaCard kind="place" id={place.id} />
          <section className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="t-label-mono">
                {t("places:detail.visits")} · {visitCount}
              </h2>
              <Button variant="primary" onClick={() => setVisitDialog({ visit: null })}>
                + {t("places:detail.addVisit")}
              </Button>
            </div>

            <div className="rounded-[var(--ts-radius-card)] px-5 py-1" style={PANEL}>
              {visitCount === 0 ? (
                /* A place ticked off a curated checklist carries `visited` and
                 * no visit row — deliberate, since a checklist tick says "I
                 * have been here" without claiming a date. "No visit recorded"
                 * under a "Visited" badge would read as a contradiction, so
                 * say which of the two states this actually is. */
                <p className="t-caption py-3">
                  {place.visited
                    ? t("places:detail.visitedWithoutVisit")
                    : t("places:detail.noVisits")}
                </p>
              ) : (
                <ul>
                  {completed.map((v, i) => visitRow(v, false, i === 0))}
                  {planned.map((v, i) => visitRow(v, true, completed.length === 0 && i === 0))}
                </ul>
              )}
            </div>
          </section>

          {place.notes && (
            <DetailSection title={t("places:detail.notes")}>
              <p className="whitespace-pre-wrap text-sm" style={{ color: "var(--ts-text)" }}>
                {place.notes}
              </p>
            </DetailSection>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <DetailSection
            title={t("places:detail.position")}
            columns={2}
            lead={
              <>
                {/* Read-only: the place is edited through the form, which has the
                full picker. Omitting the handlers is what makes it read-only —
                no-ops used to stand here, and they left the pin draggable. */}
                <div className="overflow-hidden rounded-md">
                  <LocationMiniMap
                    value={{ lat: place.lat, lon: place.lon }}
                    initialViewState={{ longitude: place.lon, latitude: place.lat, zoom: 12 }}
                    focusNonce={0}
                    compact
                    ariaLabel={t("places:detail.mapLabel", { name: place.name })}
                    attributionLabel=""
                  />
                </div>
              </>
            }
            facts={[
              {
                label: t("places:detail.coordinates"),
                value: `${place.lat.toFixed(4)} · ${place.lon.toFixed(4)}`,
                mono: true,
              },
              { label: t("places:form.address"), value: place.address },
              {
                label: t("places:form.country"),
                value: countryLabel
                  ? [countryLabel, place.isoCountryCode].filter(Boolean).join(" · ")
                  : null,
              },
            ]}
          />

          <DetailSection
            title={t("places:detail.masterData")}
            facts={[
              { label: t("places:form.category"), value: t(`places:categories.${place.category}`) },
              { label: t("places:detail.source"), value: place.externalRef, mono: true },
            ]}
          />
        </div>
      </div>

      {editing && (
        <PlaceFormModal
          place={place}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            // The update answers without photos; the visits did not change.
            setPlace({ ...saved, visits: place.visits });
            setEditing(false);
          }}
        />
      )}

      {merging && (
        <PlaceMergeDialog
          place={place}
          onClose={() => setMerging(false)}
          onMerged={async () => {
            // The merge answers without photos; the page re-reads in full.
            await refresh();
            addToast("success", t("places:merge.merged", { name: place.name }));
            setMerging(false);
          }}
        />
      )}

      {visitDialog !== null && (
        <VisitDialog
          place={place}
          visit={visitDialog.visit}
          onClose={() => setVisitDialog(null)}
          onReload={visitDialog.visit ? undefined : () => void refreshQuietly()}
          afterSaveFailedKey="common:form.savedButViewRefreshFailed"
          onSaved={async () => {
            await refresh();
            addToast(
              "success",
              t(visitDialog.visit ? "places:detail.visitUpdated" : "places:detail.visitAdded")
            );
            setVisitDialog(null);
          }}
        />
      )}

      {confirmVisitDelete !== null && (
        <ConfirmModal
          isOpen
          title={t("places:detail.visitDeleteTitle")}
          // Counted, and with what stays named (forgejo#250): its proof photos
          // go with it, the place and the trip it was filed under stay.
          message={[
            withDocumentNote(
              (confirmVisitDelete.photos?.length ?? 0) > 0
                ? t("places:detail.visitDeleteMessagePhotos", {
                    visit: formatVisit(confirmVisitDelete),
                    count: confirmVisitDelete.photos?.length ?? 0,
                  })
                : t("places:detail.visitDeleteMessageNoPhotos", {
                    visit: formatVisit(confirmVisitDelete),
                  }),
              t,
              visitDocumentCount
            ),
            survivorsNote(
              t,
              trips.filter((trip) => trip.id === confirmVisitDelete.tripId).map((trip) => trip.name)
            ),
          ]
            .filter((line): line is string => line !== null)
            .join("\n")}
          confirmText={t("common:buttons.delete")}
          cancelText={t("common:buttons.cancel")}
          onConfirm={() => void removeVisit(confirmVisitDelete.id)}
          isLoading={deleting}
          onClose={() => setConfirmVisitDelete(null)}
          confirmButtonClass={DELETE_BUTTON_CLASS}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          isOpen
          title={t("places:list.deleteTitle")}
          // The same sentence as the list page, from the same helper: this call
          // once passed no count and showed "mit {{count}} Besuchen" raw
          // (browser acceptance 2026-09-26). Every visit goes with the place,
          // planned ones included.
          message={placeDeleteMessage(t, place.name, place.visits?.length ?? 0, deleteRelations)}
          confirmButtonClass={DELETE_BUTTON_CLASS}
          confirmText={t("common:buttons.delete")}
          cancelText={t("common:buttons.cancel")}
          onConfirm={() => void removePlace()}
          isLoading={deleting}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </AppShell>
  );
}

const PANEL = {
  background: "var(--ts-surface)",
  border: "1px solid var(--ts-border)",
} as const;
