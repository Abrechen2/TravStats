import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import DetailHeader from "../components/ui/DetailHeader";
import DetailKpis, { type DetailKpi } from "../components/ui/DetailKpis";
import DetailSection from "../components/ui/DetailSection";
import PeopleList from "../components/ui/PeopleList";
import Button from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import TripPill from "../components/Trips/TripPill";
import ConfirmModal from "../components/Training/ConfirmModal";
import DocumentsSection from "../components/documents/DocumentsSection";
import { RentalFormModal } from "../components/rental/RentalFormModal";
import { RentalSuggestionBanner } from "../components/rental/RentalSuggestionBanner";
import { RentalRouteMap } from "../components/rental/RentalRouteMap";
import { RentalPriceComparison } from "../components/rental/RentalPriceComparison";
import { useDocumentCount } from "../hooks/useDocumentCount";
import { useTranslation } from "../hooks/useTranslation";
import { rentalApi } from "../lib/api/rental";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import { DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { rentalDeleteMessage } from "../lib/rental/rentalDeleteMessage";
import { depositSummary } from "../lib/rental/rentalDeposit";
import { formatDayLong } from "../shared/time";
import { formatAmount } from "../lib/units";
import { formatStationMoment } from "../lib/rentalTime";
import type { TimeValue } from "../shared/time";
import { rentalDrivenKm } from "../shared/rentalCounting";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import type { RentalBooking } from "../types/rental";

const stationLabel = (name: string, iata: string | null): string =>
  iata ? `${name} (${iata})` : name;

/**
 * One rental (spec 2026-10-01-rental-domain-design §6; concept page
 * 2026-10-01): identity, three KPI tiles that each name their source, the
 * pickup → return band on the stations' clocks, then the fact bands. A value
 * nobody knows yet says where it will come from — the km and the car driven
 * from the invoice — rather than showing a zero.
 */
export default function RentalDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(["rental", "common", "trips", "documents"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const addToast = useToastStore((s) => s.addToast);
  const [rental, setRental] = useState<RentalBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [stationOffer, setStationOffer] = useState<string | null>(null);
  const documentCount = useDocumentCount(
    confirmingDelete && rental ? { type: "rentalBooking", id: rental.id } : null
  );

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setFailure(null);
      try {
        const loaded = await rentalApi.get(id);
        if (!cancelled) setRental(loaded);
      } catch (err: unknown) {
        logger.error("RentalDetailPage: failed to load rental", err);
        if (!cancelled) setFailure(classifyLoadFailure(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  const handleDelete = async (): Promise<void> => {
    if (!rental) return;
    setDeleting(true);
    try {
      await rentalApi.remove(rental.id);
      addToast("success", t("rental:deleted"));
      navigate("/rentals");
    } catch (err: unknown) {
      logger.error("RentalDetailPage: delete failed", err);
      addToast("error", t("rental:deleteError"));
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  if (loading) {
    return (
      <AppShell width="list">
        <p className="text-(--text-muted)">{t("rental:detail.loading")}</p>
      </AppShell>
    );
  }
  if (failure !== null || !rental) {
    const isLoadError = failure === "loadError";
    return (
      <AppShell width="reading">
        <Link to="/rentals" className="ts-back-link text-sm text-(--text-muted)">
          ← {t("rental:title")}
        </Link>
        <div
          role="alert"
          className="mt-4 rounded-md border border-(--danger)/50 bg-(--danger)/10 p-4 text-sm text-(--danger)"
        >
          {isLoadError ? t("rental:detail.loadError") : t("rental:detail.notFound")}
        </div>
        {isLoadError && (
          <div className="mt-3">
            <Button onClick={() => setReloadKey((k) => k + 1)}>{t("common:buttons.retry")}</Button>
          </div>
        )}
      </AppShell>
    );
  }

  const money = (amount: number | null, currency: string | null): string | null =>
    amount === null ? null : formatAmount(amount, currency, { language: i18n.language });
  const perDay =
    rental.cost !== null
      ? formatAmount(
          Math.round((rental.cost.amount / rental.rentalDays) * 100) / 100,
          rental.cost.currency,
          {
            language: i18n.language,
          }
        )
      : null;

  const withNeverCost = (line: string | null): string | null =>
    line === null ? null : `${line} (${t("rental:deposit.neverCost")})`;
  const driven = rentalDrivenKm(rental);
  const reading = (km: number | null): string | null =>
    km === null ? null : `${km.toLocaleString(locale)} km`;
  const kpis: DetailKpi[] = [
    { key: "days", value: String(rental.rentalDays), label: t("rental:detail.kpiDays") },
    // The one rule the list and the statistics read (`rentalDrivenKm`,
    // forgejo#206): invoice or correction, else in − out of both readings.
    {
      key: "km",
      value: driven === null ? "–" : `${driven.km.toLocaleString(locale)} km`,
      label:
        driven === null
          ? t("rental:detail.kpiKmPending")
          : t(`rental:distance.${driven.source ?? "unknown"}`),
    },
    {
      key: "perDay",
      value: perDay ?? "–",
      label:
        rental.cost === null
          ? t("rental:detail.kpiCostUnknown")
          : t(`rental:detail.kpiPerDay.${rental.cost.source}`),
    },
  ];

  const station = (value: TimeValue | null): string | null => {
    if (!value) return null;
    return `${formatStationMoment(value, locale)}${value.zone ? ` (${value.zone})` : ""}`;
  };
  const route = rental.oneWay
    ? `${rental.pickupStationName} → ${rental.returnStationName}`
    : rental.pickupStationName;
  const priceLine = [
    money(rental.price, rental.currency),
    rental.paymentTiming ? t(`rental:payment.${rental.paymentTiming}`) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <AppShell width="list">
      <DetailHeader
        backTo="/rentals"
        backLabel={t("rental:detail.back")}
        domain="rental"
        icon={<Icon name="car" size={24} />}
        title={`${rental.provider} · ${route}`}
        subtitle={
          rental.confirmationNumber ? (
            <span className="font-mono">
              {t("rental:detail.booking")} {rental.confirmationNumber}
              {rental.broker ? ` · ${t("rental:list.viaBroker", { broker: rental.broker })}` : ""}
            </span>
          ) : undefined
        }
        hero={<DetailKpis items={kpis} />}
        status={
          <span className="ts-status-pill" data-testid="rental-detail-status">
            {t(`rental:status.${rental.status}`)}
          </span>
        }
        actions={
          <>
            <Button onClick={() => setEditing(true)}>{t("rental:edit")}</Button>
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              {t("rental:delete")}
            </Button>
          </>
        }
      />

      {rental.invoiceMissing ? (
        <p className="t-caption mb-3" data-testid="rental-invoice-missing">
          {t("rental:invoiceMissing")}
        </p>
      ) : null}
      {stationOffer ? (
        <p className="t-caption mb-3" role="status" data-testid="rental-station-offer">
          {stationOffer}
        </p>
      ) : null}
      <RentalSuggestionBanner
        rental={rental}
        onChanged={() => setReloadKey((k) => k + 1)}
        onStationOffer={setStationOffer}
      />

      <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-5">
        <div className="flex flex-col gap-6 md:col-span-3">
          <DetailSection
            title={t("rental:detail.band")}
            facts={[
              {
                label: t("rental:detail.pickup", {
                  station: stationLabel(rental.pickupStationName, rental.pickupIata),
                }),
                value: station(rental.times.pickup),
              },
              {
                label: t("rental:detail.return", {
                  station: stationLabel(rental.returnStationName, rental.returnIata),
                }),
                value: station(rental.times.return),
              },
              { label: t("rental:detail.actualPickup"), value: station(rental.times.actualPickup) },
              { label: t("rental:detail.actualReturn"), value: station(rental.times.actualReturn) },
            ]}
          />
          {rental.oneWay ? <p className="t-caption">{t("rental:detail.oneWayNote")}</p> : null}

          <DetailSection
            title={t("rental:detail.vehicle")}
            facts={[
              {
                label: t("rental:detail.vehicleBooked"),
                value: [rental.vehicleClass, rental.acrissCode].filter(Boolean).join(" · ") || null,
              },
              {
                label: t("rental:detail.vehicleExample"),
                value: rental.vehicleExample
                  ? t("rental:detail.orSimilar", { example: rental.vehicleExample })
                  : null,
              },
              {
                label: t("rental:detail.vehicleTraits"),
                value: rental.vehicleTraits
                  ? `${t(`rental:transmission.${rental.vehicleTraits.transmission}`)} · ${
                      rental.vehicleTraits.airConditioning
                        ? t("rental:detail.ac")
                        : t("rental:detail.noAc")
                    }`
                  : null,
              },
              {
                label: t("rental:detail.vehicleDriven"),
                value: rental.vehicleDriven ?? t("rental:detail.fromInvoice"),
              },
              // Null hides the fact, like every other unknown here (forgejo#196).
              { label: t("rental:detail.licensePlate"), value: rental.licensePlate },
              { label: t("rental:form.odometerOutKm"), value: reading(rental.odometerOutKm) },
              { label: t("rental:form.odometerInKm"), value: reading(rental.odometerInKm) },
            ]}
          />

          <DetailSection
            title={t("rental:detail.protection")}
            facts={[
              {
                label: t("rental:form.inclusions"),
                value:
                  rental.inclusions.length > 0
                    ? rental.inclusions.map((c) => t(`rental:inclusion.${c}`)).join(", ")
                    : null,
              },
              {
                label: t("rental:detail.mileage"),
                value: rental.mileagePolicy
                  ? rental.mileagePolicy === "capped" && rental.mileageCapKm !== null
                    ? t("rental:mileage.cappedAt", { km: rental.mileageCapKm })
                    : t(`rental:mileage.${rental.mileagePolicy}`)
                  : null,
              },
              {
                label: t("rental:detail.fuel"),
                value: rental.fuelPolicy ? t(`rental:fuel.${rental.fuelPolicy}`) : null,
              },
            ]}
          />

          <DetailSection
            title={t("rental:detail.price")}
            facts={[
              { label: t("rental:detail.priceBooked"), value: priceLine || null, mono: true },
              // Held, never a cost (forgejo#238): where it stands, in its own currency.
              {
                label: t("rental:detail.deposit"),
                value: withNeverCost(
                  depositSummary(
                    t,
                    rental,
                    (amount, currency) =>
                      formatAmount(amount, currency, { language: i18n.language }),
                    (day) =>
                      formatDayLong(day, locale, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                  )
                ),
              },
            ]}
          >
            {/* Booked, final and their difference side by side (forgejo#237). */}
            <RentalPriceComparison rental={rental} />
          </DetailSection>

          <DocumentsSection entry={{ type: "rentalBooking", id: rental.id }} />
        </div>

        <aside className="flex flex-col gap-6 md:col-span-2">
          <DetailSection title={t("rental:detail.map")}>
            <RentalRouteMap rental={rental} />
          </DetailSection>
          {rental.trip && (
            <DetailSection title={t("trips:tab")}>
              <span data-testid="rental-detail-trip">
                <TripPill trip={rental.trip} />
              </span>
            </DetailSection>
          )}
          {rental.route && (
            <DetailSection title={t("rental:detail.roadtrip")}>
              <Link to={`/roadtrips/${rental.route.id}`} className="hover:underline">
                {rental.route.name ?? t("rental:detail.roadtripUnnamed")}
              </Link>
            </DetailSection>
          )}
          {rental.companions.length > 0 && (
            <DetailSection title={t("rental:detail.companions")}>
              <PeopleList names={rental.companions} />
            </DetailSection>
          )}
          {rental.notes ? (
            <DetailSection title={t("rental:form.notes")}>
              <p className="whitespace-pre-wrap text-sm">{rental.notes}</p>
            </DetailSection>
          ) : null}
          <DetailSection
            title={t("rental:detail.provenance")}
            facts={[
              {
                label: t("rental:detail.source"),
                value: rental.externalRef
                  ? t("rental:detail.sourceImport")
                  : t("rental:detail.sourceManual"),
              },
              {
                label: t("rental:detail.invoice"),
                value: rental.invoiceNumber ?? t("rental:detail.noInvoice"),
                mono: rental.invoiceNumber !== null,
              },
            ]}
          />
        </aside>
      </div>

      {editing && (
        <RentalFormModal
          rental={rental}
          afterSaveFailedKey="common:form.savedButViewRefreshFailed"
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            addToast("success", t("rental:saved"));
            setReloadKey((k) => k + 1);
          }}
        />
      )}

      <ConfirmModal
        isOpen={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => void handleDelete()}
        isLoading={deleting}
        title={t("rental:delete")}
        message={rentalDeleteMessage(t, rental, documentCount)}
        confirmText={t("common:buttons.delete")}
        confirmButtonClass={DELETE_BUTTON_CLASS}
      />
    </AppShell>
  );
}
