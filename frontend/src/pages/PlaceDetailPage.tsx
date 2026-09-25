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
import { VisitDateChips } from "../components/places/VisitDateChips";
import DocumentsSection from "../components/documents/DocumentsSection";
import { RowActionButton, RowActions } from "../components/table/RowActionButton";
import { useDocumentCount } from "../hooks/useDocumentCount";
import { useTranslation } from "../hooks/useTranslation";
import { usePlacesAccess } from "../hooks/usePlacesVisible";
import { FlagImg } from "../lib/countryFlag";
import { placeCountryLabel, placeCountryCode } from "../lib/placeCountry";
import { logger } from "../lib/logger";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import { DELETE_BUTTON_CLASS, withDocumentNote } from "../lib/deleteConfirm";
import { createVisit, deletePlace, deleteVisit, getPlace } from "../lib/api/places";
import { tripsApi } from "../lib/api/trips";
import type { Trip } from "../types";
import { useToastStore } from "../store/toastStore";
import { PLACE_CATEGORY_ICONS } from "../shared/placeCategories";
import { classifyVisit } from "../shared/placeCounting";
import { splitDateTimeInput } from "../lib/tripTimeline";
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
  const [confirmDelete, setConfirmDelete] = useState(false);
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
  const [addingVisit, setAddingVisit] = useState(false);
  const [visitDate, setVisitDate] = useState("");
  const [visitTime, setVisitTime] = useState("");
  const [visitNotes, setVisitNotes] = useState("");
  /* Which trip this visit belongs to. `PlaceVisit.tripId` has been accepted by
   * the API since the visit routes were written — create and update both take
   * it and `assertTripOwned` even checks the ownership — but no component ever
   * SET it, so a place could never be attached to a trip from the interface.
   * Lodging offers the same choice on a stay. */
  const [visitTripId, setVisitTripId] = useState("");
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

  const submitVisit = useCallback(async (): Promise<void> => {
    if (!place) return;
    try {
      // A date with no time is stored at midnight UTC — the timezone-naive
      // wall-clock convention lib/tripTimeline.ts documents. An empty date is
      // sent as null, which is a valid visit ("I was here, no idea when").
      const visitedAt = visitDate ? `${visitDate}T${visitTime || "00:00"}:00.000Z` : null;
      await createVisit(place.id, {
        visitedAt,
        notes: visitNotes.trim() || null,
        tripId: visitTripId || null,
      });
      addToast("success", t("places:detail.visitAdded"));
      setAddingVisit(false);
      setVisitDate("");
      setVisitTime("");
      setVisitNotes("");
      setVisitTripId("");
      await load();
    } catch (err: unknown) {
      logger.error({ err }, "PlaceDetailPage: add visit failed");
      addToast("error", t("places:detail.visitFailed"));
    }
  }, [place, visitDate, visitTime, visitNotes, visitTripId, addToast, t, load]);

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

  const removeVisit = useCallback(
    async (visitId: string): Promise<void> => {
      try {
        await deleteVisit(visitId);
        await load();
      } catch (err: unknown) {
        logger.error({ err }, "PlaceDetailPage: delete visit failed");
        addToast("error", t("places:detail.visitDeleteFailed"));
      } finally {
        setConfirmVisitDelete(null);
      }
    },
    [addToast, t, load]
  );

  const removePlace = useCallback(async (): Promise<void> => {
    if (!place) return;
    try {
      await deletePlace(place.id);
      addToast("success", t("places:list.deleted", { name: place.name }));
      navigate("/places");
    } catch (err: unknown) {
      logger.error({ err }, "PlaceDetailPage: delete failed");
      addToast("error", t("places:list.deleteFailed"));
      setConfirmDelete(false);
    }
  }, [place, addToast, t, navigate]);

  // ISO date in the visit list, as every table row in round 4 (E7).
  const formatVisit = useCallback(
    (v: PlaceVisit): string => {
      if (!v.visitedAt) return t("places:detail.undated");
      const { date, time } = splitDateTimeInput(v.visitedAt);
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
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              {t("places:detail.deletePlace")}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <PlaceGallery key={place.id} place={place} />
          <WikipediaCard kind="place" id={place.id} />
          <section className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="t-label-mono">
                {t("places:detail.visits")} · {visitCount}
              </h2>
              <Button variant="primary" onClick={() => setAddingVisit((v) => !v)}>
                + {t("places:detail.addVisit")}
              </Button>
            </div>

            {addingVisit && (
              <div className="rounded-[var(--ts-radius-card)] p-4" style={PANEL}>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="t-caption">{t("places:detail.date")}</span>
                    <input
                      type="date"
                      className={INPUT}
                      value={visitDate}
                      onChange={(e) => setVisitDate(e.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="t-caption">{t("places:detail.time")}</span>
                    <input
                      type="time"
                      className={INPUT}
                      value={visitTime}
                      onChange={(e) => setVisitTime(e.target.value)}
                    />
                  </label>
                </div>
                <VisitDateChips
                  placeId={place.id}
                  tripId={visitTripId}
                  value={visitDate}
                  onPick={setVisitDate}
                />
                <label className="mt-3 flex flex-col gap-1">
                  <span className="t-caption">{t("places:detail.visitNotes")}</span>
                  <input
                    className={INPUT}
                    value={visitNotes}
                    onChange={(e) => setVisitNotes(e.target.value)}
                  />
                </label>
                <label className="mt-3 flex flex-col gap-1">
                  <span className="t-caption">{t("places:detail.visitTrip")}</span>
                  <select
                    className={INPUT}
                    value={visitTripId}
                    onChange={(e) => setVisitTripId(e.target.value)}
                  >
                    <option value="">{t("places:detail.visitNoTrip")}</option>
                    {trips.map((trip) => (
                      <option key={trip.id} value={trip.id}>
                        {trip.name}
                      </option>
                    ))}
                  </select>
                </label>
                {/* Both halves of the rule, said plainly, because both surprise
                    people: a date is optional, and a future one does not count. */}
                <p className="t-caption mt-2">{t("places:detail.dateHint")}</p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button onClick={() => setAddingVisit(false)}>
                    {t("common:buttons.cancel")}
                  </Button>
                  <Button variant="primary" onClick={() => void submitVisit()}>
                    {t("common:buttons.save")}
                  </Button>
                </div>
              </div>
            )}

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

      {confirmVisitDelete !== null && (
        <ConfirmModal
          isOpen
          title={t("places:detail.visitDeleteTitle")}
          message={withDocumentNote(
            t("places:detail.visitDeleteMessage", {
              visit: formatVisit(confirmVisitDelete),
            }),
            t,
            visitDocumentCount
          )}
          confirmText={t("common:buttons.delete")}
          cancelText={t("common:buttons.cancel")}
          onConfirm={() => void removeVisit(confirmVisitDelete.id)}
          onClose={() => setConfirmVisitDelete(null)}
          confirmButtonClass={DELETE_BUTTON_CLASS}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          isOpen
          title={t("places:list.deleteTitle")}
          message={t("places:list.deleteMessage", { name: place.name })}
          confirmText={t("common:buttons.delete")}
          cancelText={t("common:buttons.cancel")}
          onConfirm={() => void removePlace()}
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

const INPUT =
  "rounded-md border border-[var(--color-border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)]";
