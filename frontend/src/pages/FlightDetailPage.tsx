import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import DetailHeader from "../components/ui/DetailHeader";
import DetailSection from "../components/ui/DetailSection";
import PeopleList from "../components/ui/PeopleList";
import FlightRouteHero from "../components/flightsTable/FlightRouteHero";
import { resolveAirlineIata } from "../lib/airlineUtils";
import { formatDateInTimezone, formatDateTimeInTimezone } from "../lib/dateUtils";
import Button from "../components/ui/Button";
import SpecialTypeBadge from "../components/specialFlights/SpecialTypeBadge";
import type { SpecialType } from "../components/specialFlights/specialTypeMeta";
import FlightEditModal from "../components/FlightEditModal";
import SpecialFlightModal from "../components/SpecialFlightModal";
import ConfirmModal from "../components/Training/ConfirmModal";
import DocumentsSection from "../components/documents/DocumentsSection";
import FlightStatusCell from "../components/flightsTable/FlightStatusCell";
import { useDocumentCount } from "../hooks/useDocumentCount";
import { useTranslation } from "../hooks/useTranslation";
import { flightsApi, tripsApi } from "../lib/api";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import { DELETE_BUTTON_CLASS, withDocumentNote } from "../lib/deleteConfirm";
import { getFlightDuration } from "../lib/flightDuration";
import { flightExtractTarget } from "../lib/extractTargets";
import { convertDistance, formatAmount, getDistanceLabel } from "../lib/units";
import { useSettingsStore } from "../store/settingsStore";
import { formatDurationWithEstimate } from "../lib/formatters";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import type { Flight, FlightInput, Trip } from "../types";
import TripPhotoWindowStrip from "../components/common/TripPhotoWindowStrip";

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
  /**
   * Asked only while the confirmation is opening — `null` keeps the hook
   * silent, so reading a flight costs the same requests it always did.
   */
  const documentCount = useDocumentCount(
    confirmingDelete && flight ? { type: "flight", id: flight.id } : null
  );
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
      <AppShell width="list">
        <p className="text-[var(--text-muted)]">{t("flights:table.loading")}</p>
      </AppShell>
    );
  }

  if (failure !== null || !flight) {
    const isLoadError = failure === "loadError";
    return (
      <AppShell width="reading">
        <div>
          <Link to="/flights" className="ts-back-link text-sm text-[var(--text-muted)]">
            ← {t("flights:table.title")}
          </Link>
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 p-4 text-sm text-[var(--danger)]"
          >
            {isLoadError ? t("flights:detail.loadError") : t("flights:detail.notFound")}
          </div>
          {isLoadError && (
            <div className="mt-3">
              <Button onClick={() => setReloadKey((k) => k + 1)}>
                {t("common:buttons.retry")}
              </Button>
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  const duration = getFlightDuration(flight);
  const money = (value: number | null | undefined): string | null =>
    value === null || value === undefined
      ? null
      : formatAmount(value, flight.currency, { language: i18n.language });
  const people = [...(flight.companions ?? []), ...(flight.coPassengers ?? [])];
  const distance =
    flight.routeDistance != null
      ? `${Math.round(convertDistance(flight.routeDistance, distanceUnit)).toLocaleString(
          i18n.language
        )} ${getDistanceLabel(distanceUnit, t)}`
      : null;
  /** A time in prose and a detail grid: DD.MM.YYYY, HH:MM on the airport's clock (E7). */
  const when = (iso: string | null | undefined, tz: string | null | undefined): string | null =>
    iso ? formatDateTimeInTimezone(iso, tz || "UTC", flight.depTimeSemantics) : null;

  return (
    <AppShell width="list">
      <DetailHeader
        backTo="/flights"
        backLabel={t("flights:detail.backToLogbook")}
        domain="flight"
        icon={
          <span style={{ fontFamily: "var(--ts-font-mono)", fontSize: 15, fontWeight: 800 }}>
            {resolveAirlineIata(flight) || "✈"}
          </span>
        }
        title={
          [flight.flightNumber, flight.airline].filter(Boolean).join(" · ") ||
          t("common:labels.unknown")
        }
        status={
          <>
            {flight.specialType && <SpecialTypeBadge type={flight.specialType as SpecialType} />}
            <FlightStatusCell flight={flight} />
          </>
        }
        meta={[
          flight.departureTime
            ? formatDateInTimezone(flight.departureTime, flight.depTimezone || "UTC")
            : null,
          flight.aircraft,
          flight.aircraftRegistration,
        ]
          .filter(Boolean)
          .join(" · ")}
        hero={<FlightRouteHero flight={flight} distance={distance} />}
        actions={
          <>
            <Button
              onClick={() => (flight.specialType ? setEditingSpecial(true) : setEditing(true))}
            >
              {t("common:buttons.edit")}
            </Button>
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              {t("common:buttons.delete")}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
        <div className="flex flex-col gap-6 md:col-span-3">
          <DetailSection
            title={t("flights:detail.times")}
            facts={[
              {
                label: t("flights:detail.departurePlanned"),
                value: when(flight.departureTime, flight.depTimezone),
                mono: true,
              },
              {
                label: t("flights:detail.departureActual"),
                value: when(flight.actualDeparture, flight.depTimezone),
                mono: true,
              },
              {
                label: t("flights:detail.arrivalPlanned"),
                value: when(flight.arrivalTime, flight.arrTimezone),
                mono: true,
              },
              {
                label: t("flights:detail.arrivalActual"),
                value: when(flight.actualArrival, flight.arrTimezone),
                mono: true,
              },
              {
                label: t("flights:detail.flightTime"),
                value: duration
                  ? formatDurationWithEstimate(duration.minutes, duration.estimated)
                  : null,
                mono: true,
              },
              {
                label: t("flights:detail.timezones"),
                value:
                  flight.depTimezone && flight.arrTimezone
                    ? `${flight.depTimezone} → ${flight.arrTimezone}`
                    : null,
              },
            ]}
          />

          <DetailSection
            title={t("flights:detail.route")}
            facts={[
              { label: t("flights:detail.distance"), value: distance, mono: true },
              {
                label: t("flights:form.category"),
                value: flight.category
                  ? t(`flights:category.${flight.category}`, { defaultValue: flight.category })
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

          <DetailSection
            title={t("flights:detail.booking")}
            facts={[
              {
                label: t("flights:form.bookingReference"),
                value: flight.bookingReference,
                mono: true,
              },
              { label: t("flights:form.ticketNumber"), value: flight.ticketNumber, mono: true },
              { label: t("flights:form.seat"), value: flight.seatNumber, mono: true },
              {
                label: t("flights:form.seatClass"),
                value: flight.seatClass
                  ? t(`flights:seatClass.${flight.seatClass}`, { defaultValue: flight.seatClass })
                  : null,
              },
              {
                label: t("flights:form.bookingClassLetter"),
                value: flight.bookingClassLetter,
                mono: true,
              },
              { label: t("flights:form.boardingGroup"), value: flight.boardingGroup },
              { label: t("flights:form.terminal"), value: flight.terminal },
              { label: t("flights:form.gate"), value: flight.gate, mono: true },
              { label: t("flights:form.baggageAllowance"), value: flight.baggageAllowance },
              {
                label: t("flights:form.frequentFlyerNumber"),
                value: flight.frequentFlyerNumber,
                mono: true,
              },
            ]}
          />

          <DetailSection
            title={t("flights:detail.costs")}
            facts={[
              { label: t("flights:form.price"), value: money(flight.price), mono: true },
              { label: t("flights:form.taxes"), value: money(flight.taxes), mono: true },
              { label: t("flights:form.fees"), value: money(flight.fees), mono: true },
            ]}
          />

          {/* Beside the costs, not instead of the receipt above them: the
              "Beleg" is the one file the price links to, this is the folder. */}
          <DocumentsSection
            entry={{ type: "flight", id: flight.id }}
            extract={flightExtractTarget(flight, async (updates) => {
              await flightsApi.update(flight.id, updates);
              addToast("success", t("documents:extract.applied"));
              setReloadKey((k) => k + 1);
            })}
          />
        </div>

        <aside className="flex flex-col gap-6 md:col-span-2">
          {flight.tripId && (
            <DetailSection title={t("trips:tab")}>
              <Link
                to={`/trips/${flight.tripId}`}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span style={{ fontWeight: 600, color: "var(--ts-text-bright)" }}>
                  {trip?.name ?? t("flights:detail.openTrip")}
                </span>
                <span style={{ color: "var(--ts-accent)", fontWeight: 600 }}>
                  {t("flights:detail.openTrip")}
                </span>
              </Link>
            </DetailSection>
          )}
          {flight.tripId && <TripPhotoWindowStrip entry="flights" id={flight.id} />}

          <DetailSection
            title={t("flights:form.aircraft")}
            facts={[
              { label: t("flights:form.aircraft"), value: flight.aircraft },
              {
                label: t("flights:detail.registration"),
                value: flight.aircraftRegistration,
                mono: true,
              },
              { label: t("flights:form.operatingAirline"), value: flight.operatingAirline },
            ]}
          />

          {people.length > 0 && (
            <DetailSection title={t("flights:form.companions")}>
              <PeopleList names={people} />
            </DetailSection>
          )}

          {flight.notes && (
            <DetailSection title={t("common:labels.notes")}>
              <p className="whitespace-pre-line text-sm" style={{ color: "var(--ts-text)" }}>
                {flight.notes}
              </p>
            </DetailSection>
          )}
        </aside>
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
        // Finding 3 of the write-path audit (2026-09-19): a flight's
        // documents cascade with it (`onDelete: Cascade`, proven live by
        // `backend/src/__tests__/integrity/cascades.integrity.test.ts`) and
        // the dialog named only the flight.
        message={withDocumentNote(
          t("flights:table.deleteConfirm.message", {
            name:
              [flight.flightNumber, [flight.depIata, flight.arrIata].filter(Boolean).join(" → ")]
                .filter(Boolean)
                .join(" ") || t("common:labels.unknown"),
          }),
          t,
          documentCount
        )}
        confirmText={t("flights:table.deleteConfirm.confirm")}
        cancelText={t("flights:table.deleteConfirm.cancel")}
        confirmButtonClass={DELETE_BUTTON_CLASS}
      />
    </AppShell>
  );
}
