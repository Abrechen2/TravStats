import { useCallback, useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import NavigationBar from "../components/NavigationBar";
import PageTransition from "../components/PageTransition";
import RouteCell from "../components/flightsTable/RouteCell";
import TimeCell from "../components/flightsTable/TimeCell";
import SpecialTypeBadge from "../components/specialFlights/SpecialTypeBadge";
import type { SpecialType } from "../components/specialFlights/specialTypeMeta";
import FlightEditModal from "../components/FlightEditModal";
import SpecialFlightModal from "../components/SpecialFlightModal";
import ConfirmModal from "../components/Training/ConfirmModal";
import FlightStatusCell from "../components/flightsTable/FlightStatusCell";
import { useTranslation } from "../hooks/useTranslation";
import { flightsApi, tripsApi } from "../lib/api";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import { DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { getFlightDuration } from "../lib/flightDuration";
import { convertDistance, formatAmount, getDistanceLabel } from "../lib/units";
import { useSettingsStore } from "../store/settingsStore";
import { formatDurationWithEstimate } from "../lib/formatters";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import type { Flight, FlightInput, Trip } from "../types";

/**
 * Reading a flight without editing it.
 *
 * A flight carries around 58 fields. The table shows nine columns, and until
 * now the only way to see the rest — seat, gate, terminal, boarding group,
 * booking reference, ticket number, companions, baggage allowance, frequent
 * flyer number, overflown countries, route distance, notes, receipt, taxes and
 * fees — was to open the edit form. Reading required putting the record into
 * an editable state, which is a strange thing to have to do to look something
 * up, and it made flights the only domain without a page of its own: a cruise
 * row and a lodging row open a page, a flight row opened a form.
 *
 * Deliberately the same shape as CruiseDetailPage and LodgingDetailPage — back
 * link, header strip with the identity and the actions, then a body of small
 * labelled cards. Editing still happens in the modal; it is opened from here
 * rather than instead of here.
 */

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0">{label}</dt>
      <dd className="text-right text-[var(--text-primary)]">{children}</dd>
    </div>
  );
}

/** A card renders only when it has something to say. */
function Card({
  title,
  fields,
}: {
  title: string;
  fields: ReadonlyArray<{ label: string; value: string | null | undefined }>;
}): JSX.Element | null {
  const filled = fields.filter((f) => f.value !== null && f.value !== undefined && f.value !== "");
  if (filled.length === 0) return null;
  return (
    <div
      className="rounded-md p-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </h3>
      <dl className="mt-2 space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
        {filled.map((f) => (
          <Field key={f.label} label={f.label}>
            {f.value}
          </Field>
        ))}
      </dl>
    </div>
  );
}

export default function FlightDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(["flights", "common", "trips", "specialFlights"]);
  const addToast = useToastStore((s) => s.addToast);
  const distanceUnit = useSettingsStore((state) => state.units.distanceUnit);

  const [flight, setFlight] = useState<Flight | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [editing, setEditing] = useState<boolean>(false);
  const [editingSpecial, setEditingSpecial] = useState<boolean>(false);
  const [confirmingDelete, setConfirmingDelete] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setFailure(null);
      try {
        const data = await flightsApi.getById(id);
        if (!cancelled) setFlight(data);
      } catch (err: unknown) {
        logger.error("FlightDetailPage: failed to load flight", err);
        if (!cancelled) setFailure(classifyLoadFailure(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  // The trip is a separate fetch and a nice-to-have: failing to resolve its
  // name must never turn into a failure to show the flight.
  useEffect(() => {
    const tripId = flight?.tripId;
    if (!tripId) {
      setTrip(null);
      return;
    }
    let cancelled = false;
    void tripsApi
      .getAll()
      .then((trips) => {
        if (!cancelled) setTrip(trips.find((tr) => tr.id === tripId) ?? null);
      })
      .catch((err: unknown) => logger.warn({ err }, "FlightDetailPage: trip lookup failed"));
    return () => {
      cancelled = true;
    };
  }, [flight?.tripId]);

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!flight) return;
    setDeleting(true);
    try {
      await flightsApi.delete(flight.id);
      addToast("success", t("flights:table.toast.deleted"));
      navigate("/flights");
    } catch (err: unknown) {
      logger.error("FlightDetailPage: delete failed", err);
      addToast("error", t("dashboard:errors.deleteFlight"));
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }, [flight, addToast, navigate, t]);

  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />
        <div className="p-6 text-[var(--text-muted)]">{t("flights:table.loading")}</div>
      </div>
    );
  }

  if (failure !== null || !flight) {
    const isLoadError = failure === "loadError";
    return (
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />
        <div className="mx-auto max-w-3xl p-6">
          <button
            onClick={() => navigate("/flights")}
            className="text-sm text-[var(--accent)] hover:underline"
          >
            ← {t("flights:table.title")}
          </button>
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 p-4 text-sm text-[var(--danger)]"
          >
            {isLoadError ? t("flights:detail.loadError") : t("flights:detail.notFound")}
          </div>
          {isLoadError && (
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="mt-3 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {t("common:buttons.retry")}
            </button>
          )}
        </div>
      </div>
    );
  }

  const duration = getFlightDuration(flight);
  const money = (value: number | null | undefined): string | null =>
    value === null || value === undefined
      ? null
      : formatAmount(value, flight.currency, { language: i18n.language });
  const people = [...(flight.companions ?? []), ...(flight.coPassengers ?? [])];

  return (
    <PageTransition>
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />
        <div className="mx-auto max-w-6xl px-4 py-6">
          <button
            onClick={() => navigate("/flights")}
            className="mb-3 text-sm text-[var(--accent)] hover:underline"
          >
            ← {t("flights:table.title")}
          </button>

          {/* Header strip — same shape as the cruise and lodging pages. */}
          <div
            className="mb-6 flex flex-col gap-3 rounded-lg p-4 md:flex-row md:items-center md:justify-between"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
          >
            <div className="flex items-center gap-3">
              <div
                aria-hidden
                className="flex h-12 w-12 items-center justify-center rounded-lg text-2xl"
                style={{
                  backgroundColor: "var(--domain-flight-soft)",
                  color: "var(--domain-flight)",
                }}
              >
                ✈
              </div>
              <div>
                <h1 className="t-screen-title">
                  {[flight.airline, flight.flightNumber].filter(Boolean).join(" ") ||
                    t("common:labels.unknown")}
                </h1>
                <div className="text-sm text-[var(--text-muted)]">
                  <RouteCell flight={flight} />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {flight.specialType && <SpecialTypeBadge type={flight.specialType as SpecialType} />}
              <FlightStatusCell flight={flight} />
              <button
                type="button"
                onClick={() => (flight.specialType ? setEditingSpecial(true) : setEditing(true))}
                className="rounded-md bg-[var(--accent)] px-3 py-1 text-sm font-medium text-neutral-900 hover:bg-[var(--accent-dim)]"
              >
                {t("common:buttons.edit")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="rounded-md border border-[var(--danger)]/50 px-3 py-1 text-sm font-medium text-[var(--danger)] hover:bg-[var(--danger)]/10"
              >
                {t("common:buttons.delete")}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            <div className="space-y-3 md:col-span-3">
              <div
                className="rounded-md p-4"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  {t("flights:detail.times")}
                </h3>
                <div className="mt-3 text-sm">
                  <TimeCell flight={flight} />
                </div>
                <dl className="mt-3 space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  <Field label={t("flights:table.flightTime")}>
                    {formatDurationWithEstimate(
                      duration?.minutes ?? null,
                      duration?.estimated ?? false
                    )}
                  </Field>
                </dl>
              </div>

              <Card
                title={t("flights:detail.booking")}
                fields={[
                  { label: t("flights:form.bookingReference"), value: flight.bookingReference },
                  { label: t("flights:form.ticketNumber"), value: flight.ticketNumber },
                  { label: t("flights:form.seat"), value: flight.seatNumber },
                  {
                    label: t("flights:form.seatClass"),
                    value: flight.seatClass
                      ? t(`flights:seatClass.${flight.seatClass}`, {
                          defaultValue: flight.seatClass,
                        })
                      : null,
                  },
                  { label: t("flights:form.bookingClassLetter"), value: flight.bookingClassLetter },
                  { label: t("flights:form.boardingGroup"), value: flight.boardingGroup },
                  { label: t("flights:form.terminal"), value: flight.terminal },
                  { label: t("flights:form.gate"), value: flight.gate },
                  { label: t("flights:form.baggageAllowance"), value: flight.baggageAllowance },
                  {
                    label: t("flights:form.frequentFlyerNumber"),
                    value: flight.frequentFlyerNumber,
                  },
                ]}
              />

              <Card
                title={t("flights:detail.costs")}
                fields={[
                  { label: t("flights:form.price"), value: money(flight.price) },
                  { label: t("flights:form.taxes"), value: money(flight.taxes) },
                  { label: t("flights:form.fees"), value: money(flight.fees) },
                  {
                    label: t("flights:form.category"),
                    value: flight.category
                      ? t(`flights:category.${flight.category}`, {
                          defaultValue: flight.category,
                        })
                      : null,
                  },
                ]}
              />
            </div>

            <aside className="space-y-3 md:col-span-2">
              <Card
                title={t("flights:form.aircraft")}
                fields={[
                  { label: t("flights:form.aircraft"), value: flight.aircraft },
                  {
                    label: t("flights:detail.registration"),
                    value: flight.aircraftRegistration,
                  },
                  { label: t("flights:form.operatingAirline"), value: flight.operatingAirline },
                ]}
              />

              <Card
                title={t("flights:detail.route")}
                fields={[
                  {
                    label: t("flights:detail.distance"),
                    value:
                      flight.routeDistance != null
                        ? `${Math.round(
                            convertDistance(flight.routeDistance, distanceUnit)
                          ).toLocaleString()} ${getDistanceLabel(distanceUnit, t)}`
                        : null,
                  },
                  {
                    label: t("flights:detail.overflownCountries"),
                    value:
                      flight.overflownCountries && flight.overflownCountries.length > 0
                        ? flight.overflownCountries.join(", ")
                        : null,
                  },
                ]}
              />

              {flight.tripId && (
                <div
                  className="rounded-md p-4"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    {t("trips:tab")}
                  </h3>
                  <Link
                    to={`/trips/${flight.tripId}`}
                    className="mt-2 inline-block text-sm text-[var(--accent)] hover:underline"
                  >
                    {trip?.name ?? t("flights:detail.openTrip")}
                  </Link>
                </div>
              )}

              <Card
                title={t("flights:form.companions")}
                fields={[
                  {
                    label: t("flights:form.companions"),
                    value: people.length > 0 ? people.join(", ") : null,
                  },
                ]}
              />

              {flight.notes && (
                <div
                  className="rounded-md p-4"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    {t("common:labels.notes")}
                  </h3>
                  <p className="mt-2 whitespace-pre-line text-xs text-[var(--text-muted)]">
                    {flight.notes}
                  </p>
                </div>
              )}
            </aside>
          </div>
        </div>

        {editing && (
          <FlightEditModal
            flight={flight}
            isOpen
            onClose={() => setEditing(false)}
            onSave={async (flightId: string, updates: Partial<FlightInput>) => {
              await flightsApi.update(flightId, updates);
              addToast("success", t("flights:table.toast.updated"));
              setEditing(false);
              setReloadKey((k) => k + 1);
            }}
          />
        )}

        <SpecialFlightModal
          isOpen={editingSpecial}
          flight={flight}
          onClose={() => setEditingSpecial(false)}
          onSaved={() => {
            setEditingSpecial(false);
            setReloadKey((k) => k + 1);
          }}
        />

        <ConfirmModal
          isOpen={confirmingDelete}
          onClose={() => setConfirmingDelete(false)}
          onConfirm={() => void handleDelete()}
          isLoading={deleting}
          title={t("flights:table.deleteConfirm.title")}
          message={t("flights:table.deleteConfirm.message", {
            name:
              [flight.flightNumber, [flight.depIata, flight.arrIata].filter(Boolean).join(" → ")]
                .filter(Boolean)
                .join(" ") || t("common:labels.unknown"),
          })}
          confirmText={t("flights:table.deleteConfirm.confirm")}
          cancelText={t("flights:table.deleteConfirm.cancel")}
          confirmButtonClass={DELETE_BUTTON_CLASS}
        />
      </div>
    </PageTransition>
  );
}
