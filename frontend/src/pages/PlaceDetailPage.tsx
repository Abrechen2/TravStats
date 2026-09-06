import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import NavigationBar from "../components/NavigationBar";
import PageTransition from "../components/PageTransition";
import ConfirmModal from "../components/Training/ConfirmModal";
import { LocationMiniMap } from "../components/location/LocationMiniMap";
import { PlaceFormModal } from "../components/places/PlaceFormModal";
import { VisitPhotoStrip } from "../components/places/VisitPhotoStrip";
import { RowActionButton, RowActions } from "../components/table/RowActionButton";
import { useTranslation } from "../hooks/useTranslation";
import { usePlacesAccess } from "../hooks/usePlacesVisible";
import { FlagImg } from "../lib/countryFlag";
import { placeCountryLabel, placeCountryCode } from "../lib/placeCountry";
import { logger } from "../lib/logger";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
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

  const formatVisit = useCallback(
    (v: PlaceVisit): string => {
      if (!v.visitedAt) return t("places:detail.undated");
      const { date, time } = splitDateTimeInput(v.visitedAt);
      const d = new Date(`${date}T00:00:00.000Z`).toLocaleDateString(i18n.language, {
        timeZone: "UTC",
      });
      return time ? `${d}, ${time}` : d;
    },
    [i18n.language, t]
  );

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

  if (loading) {
    return (
      <PageTransition>
        <NavigationBar />
        <div className="mx-auto max-w-3xl px-4 py-16 text-center text-[var(--text-muted)]">
          {t("common:loading.default")}
        </div>
      </PageTransition>
    );
  }

  if (failure !== null || !place) {
    const isLoadError = failure === "loadError";
    return (
      <PageTransition>
        <NavigationBar />
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <p role="alert" style={{ color: "var(--danger)" }}>
            {isLoadError ? t("places:detail.loadError") : t("places:detail.notFound")}
          </p>
          {isLoadError && (
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 block w-full text-sm underline"
              style={{ color: "var(--accent)" }}
            >
              {t("common:buttons.retry")}
            </button>
          )}
          <Link
            to="/places"
            className="mt-3 inline-block text-sm underline"
            style={{ color: "var(--accent)" }}
          >
            {t("places:detail.backToList")}
          </Link>
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
            <h1 className="t-screen-title flex items-center gap-3">
              <span aria-hidden>{PLACE_CATEGORY_ICONS[place.category]}</span>
              {place.name}
            </h1>
            <div
              className="mt-1 flex items-center gap-2 text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              {[place.city, placeCountryLabel(place, i18n.language)].filter(Boolean).join(", ") ||
                "—"}
              {placeCountryCode(place) && <FlagImg country={placeCountryCode(place)} />}
              <span>·</span>
              <span>{t(`places:categories.${place.category}`)}</span>
              <span
                className="rounded px-2 py-0.5 text-xs"
                style={
                  place.visited
                    ? {
                        color: "var(--success)",
                        background: "rgba(63,185,80,0.08)",
                        border: "1px solid rgba(63,185,80,0.35)",
                      }
                    : { color: "var(--text-muted)", border: "1px dashed var(--color-border)" }
                }
              >
                {place.visited ? t("places:list.status.visited") : t("places:list.status.wishlist")}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-lg px-4 py-2 text-sm"
              style={{ border: "1px solid var(--color-border)", color: "var(--text-secondary)" }}
            >
              {t("common:buttons.edit")}
            </button>
            <button
              type="button"
              onClick={() => setAddingVisit((v) => !v)}
              className="rounded-lg px-4 py-2 text-sm font-semibold"
              style={{ background: "var(--domain-poi)", color: "#08221e" }}
            >
              + {t("places:detail.addVisit")}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            {addingVisit && (
              <section className="rounded-lg p-4" style={PANEL}>
                <h2
                  className="mb-3 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t("places:detail.addVisit")}
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {t("places:detail.date")}
                    </span>
                    <input
                      type="date"
                      className={INPUT}
                      value={visitDate}
                      onChange={(e) => setVisitDate(e.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {t("places:detail.time")}
                    </span>
                    <input
                      type="time"
                      className={INPUT}
                      value={visitTime}
                      onChange={(e) => setVisitTime(e.target.value)}
                    />
                  </label>
                </div>
                <label className="mt-3 flex flex-col gap-1">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {t("places:detail.visitNotes")}
                  </span>
                  <input
                    className={INPUT}
                    value={visitNotes}
                    onChange={(e) => setVisitNotes(e.target.value)}
                  />
                </label>
                <label className="mt-3 flex flex-col gap-1">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {t("places:detail.visitTrip")}
                  </span>
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
                <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("places:detail.dateHint")}
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setAddingVisit(false)}
                    className="rounded-lg px-3 py-1.5 text-sm"
                    style={{
                      border: "1px solid var(--color-border)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {t("common:buttons.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitVisit()}
                    className="rounded-lg px-3 py-1.5 text-sm font-semibold"
                    style={{ background: "var(--domain-poi)", color: "#08221e" }}
                  >
                    {t("common:buttons.save")}
                  </button>
                </div>
              </section>
            )}

            <section className="rounded-lg p-4" style={PANEL}>
              <h2
                className="mb-3 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                {t("places:detail.visits")} · {completed.length}
              </h2>
              {completed.length === 0 && planned.length === 0 ? (
                /* A place ticked off a curated checklist carries `visited` and
                 * no visit row — that is deliberate, since a checklist tick
                 * says "I have been here" without claiming a date. But "no
                 * visit recorded" sitting under a "Visited" badge reads as a
                 * contradiction, and it hides that photo proof hangs off a
                 * visit. Say which of the two states this actually is. */
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {place.visited
                    ? t("places:detail.visitedWithoutVisit")
                    : t("places:detail.noVisits")}
                </p>
              ) : (
                <ul className="space-y-2">
                  {completed.map((v) => (
                    <li key={v.id} className="rounded-md px-3 py-2" style={ROW}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-sm">{formatVisit(v)}</span>
                        <span
                          className="flex-1 truncate text-xs"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {v.notes ?? ""}
                        </span>
                        <RowActions>
                          <RowActionButton
                            icon="delete"
                            label={t("common:buttons.delete")}
                            onClick={() => void removeVisit(v.id)}
                          />
                        </RowActions>
                      </div>
                      {/* Proof hangs off the VISIT, not the place: "I was here
                          in 2019" and "I was here last week" are two different
                          sets of pictures. */}
                      <VisitPhotoStrip visitId={v.id} photos={v.photos ?? []} />
                    </li>
                  ))}
                  {planned.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-center justify-between gap-3 rounded-md px-3 py-2"
                      style={ROW}
                    >
                      <span className="font-mono text-sm" style={{ color: "var(--warning)" }}>
                        {formatVisit(v)}
                      </span>
                      <span
                        className="flex-1 truncate text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {v.notes ?? ""}
                      </span>
                      <span
                        className="rounded px-2 py-1 font-mono text-[10px]"
                        style={{
                          color: "var(--warning)",
                          border: "1px solid rgba(210,153,34,0.35)",
                          background: "rgba(210,153,34,0.08)",
                        }}
                      >
                        {t("places:detail.notCountedYet")}
                      </span>
                      <RowActions>
                        <RowActionButton
                          icon="delete"
                          label={t("common:buttons.delete")}
                          onClick={() => void removeVisit(v.id)}
                        />
                      </RowActions>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {place.notes && (
              <section className="rounded-lg p-4" style={PANEL}>
                <h2
                  className="mb-2 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t("places:detail.notes")}
                </h2>
                <p
                  className="whitespace-pre-wrap text-sm"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {place.notes}
                </p>
              </section>
            )}
          </div>

          <div className="space-y-4">
            <section className="overflow-hidden rounded-lg" style={PANEL}>
              {/* Read-only: the place is edited through the form, which has the
                  full picker. Omitting the handlers is what makes it read-only —
                  no-ops used to stand here, and they left the pin draggable, so
                  it could be nudged and stay nudged while the coordinates below
                  went on showing the stored value. */}
              <LocationMiniMap
                value={{ lat: place.lat, lon: place.lon }}
                initialViewState={{ longitude: place.lon, latitude: place.lat, zoom: 12 }}
                focusNonce={0}
                compact
                ariaLabel={t("places:detail.mapLabel", { name: place.name })}
                attributionLabel=""
              />
            </section>

            <section className="rounded-lg p-4" style={PANEL}>
              <h2
                className="mb-3 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                {t("places:detail.masterData")}
              </h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt style={{ color: "var(--text-muted)" }}>{t("places:form.address")}</dt>
                <dd>{place.address ?? "—"}</dd>
                <dt style={{ color: "var(--text-muted)" }}>{t("places:form.country")}</dt>
                <dd>
                  {placeCountryLabel(place, i18n.language) || "—"}
                  {place.isoCountryCode && (
                    <code className="ml-2 text-xs">{place.isoCountryCode}</code>
                  )}
                </dd>
                <dt style={{ color: "var(--text-muted)" }}>{t("places:detail.position")}</dt>
                <dd className="font-mono text-xs">
                  {place.lat.toFixed(4)}, {place.lon.toFixed(4)}
                </dd>
                {place.externalRef && (
                  <>
                    <dt style={{ color: "var(--text-muted)" }}>{t("places:detail.source")}</dt>
                    <dd className="font-mono text-xs">{place.externalRef}</dd>
                  </>
                )}
              </dl>
            </section>

            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="w-full rounded-lg px-4 py-2 text-sm"
              style={{ border: "1px solid var(--color-border)", color: "var(--danger)" }}
            >
              {t("places:detail.deletePlace")}
            </button>
          </div>
        </div>
      </div>

      {editing && (
        <PlaceFormModal
          place={place}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setPlace(saved);
            setEditing(false);
          }}
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
    </PageTransition>
  );
}

const PANEL = {
  background: "var(--bg-surface)",
  border: "1px solid var(--color-border)",
} as const;

const ROW = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--color-border)",
} as const;

const INPUT =
  "rounded-md border border-[var(--color-border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)]";
