import { useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import { rentalApi } from "../../lib/api/rental";
import { apiErrorMachineCode } from "../../lib/apiError";
import { logger } from "../../lib/logger";
import type { RentalImportCandidate, StationResolution } from "../../types/rental";
import { RentalStationPicker } from "./RentalStationPicker";
import {
  EMPTY_RENTAL_STATION,
  isPlaced,
  rentalSaveError,
  type RentalStationDraft,
} from "./rentalFormModel";

interface Props {
  candidate: RentalImportCandidate;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-(--bg-surface) px-3 py-2 text-sm text-(--text-primary)";

/** The station the review starts from: the airport the parser placed, else the printed name to answer. */
function draftOf(name: string, resolution: StationResolution | undefined): RentalStationDraft {
  if (resolution?.status === "resolved") {
    return {
      ...EMPTY_RENTAL_STATION,
      name,
      airportId: resolution.airport.airportId,
      iata: resolution.airport.iata,
      country: resolution.airport.country,
      // A placeholder position: the airport id is what the server places by.
      lat: 0,
      lon: 0,
    };
  }
  return { ...EMPTY_RENTAL_STATION, name };
}

/**
 * The review of one parsed rental document (spec 2026-10-01-rental-domain-design
 * §4.4, §4.5). Nothing is written until the user confirms. A station the mail
 * named in prose and the catalogue could not place to exactly one airport is
 * asked for here — every candidate listed (silent-failure class 1) — and the
 * save stays closed until it is answered (class 2). A cancellation or invoice
 * for a booking the account does not hold says so and offers no save.
 */
export function RentalImportPreviewModal({ candidate, onCancel, onSaved }: Props): JSX.Element {
  const { t } = useTranslation(["rental", "common"]);
  const input = candidate.input;
  const [pickup, setPickup] = useState<RentalStationDraft>(
    draftOf(input?.pickupStation.name ?? "", candidate.stations?.pickup)
  );
  const [ret, setRet] = useState<RentalStationDraft>(
    draftOf(input?.returnStation?.name ?? "", candidate.stations?.return)
  );
  const oneWay = Boolean(input?.returnStation);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kmConflict, setKmConflict] = useState(false);

  const declined = candidate.action === "declined";
  const stationsReady = !input || (isPlaced(pickup) && (!oneWay || isPlaced(ret)));

  const station = (s: RentalStationDraft) => ({
    name: s.name,
    ...(s.airportId !== null
      ? { airportId: s.airportId }
      : { lat: s.lat, lon: s.lon, country: s.country, address: s.address }),
  });

  const save = async (replaceUserDistance = false): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      if (candidate.kind === "confirmation" && input) {
        await rentalApi.importDocument({
          kind: "confirmation",
          input: {
            ...input,
            pickupStation: station(pickup),
            returnStation: oneWay ? station(ret) : null,
          },
        });
      } else if (candidate.kind === "cancellation" && candidate.confirmationNumber) {
        await rentalApi.importDocument({
          kind: "cancellation",
          provider: candidate.provider,
          confirmationNumber: candidate.confirmationNumber,
        });
      } else if (candidate.kind === "invoice" && candidate.invoice) {
        await rentalApi.importDocument({
          kind: "invoice",
          invoice: candidate.invoice,
          replaceUserDistance,
        });
      }
      await onSaved();
    } catch (err: unknown) {
      logger.error("RentalImportPreviewModal: import failed", err);
      if (apiErrorMachineCode(err) === "RENTAL_INVOICE_KM_CONFLICT") {
        setKmConflict(true);
      } else {
        setError(t(rentalSaveError(err).key));
      }
    } finally {
      setSaving(false);
    }
  };

  const resolutionPicker = (
    which: "pickup" | "return",
    value: RentalStationDraft,
    onChange: (next: RentalStationDraft) => void
  ): JSX.Element => {
    const resolution = candidate.stations?.[which];
    return (
      <div className="space-y-2">
        {resolution?.status === "ambiguous" ? (
          <p className="t-caption">{t("rental:import.ambiguous", { name: value.name })}</p>
        ) : null}
        {resolution?.status === "ambiguous"
          ? resolution.candidates.map((c) => (
              <button
                key={c.airportId}
                type="button"
                className="mr-2 rounded-full border border-border px-3 py-1 text-xs"
                onClick={() =>
                  onChange({
                    ...value,
                    airportId: c.airportId,
                    iata: c.iata,
                    country: c.country,
                    lat: 0,
                    lon: 0,
                  })
                }
              >
                {c.name} ({c.iata})
              </button>
            ))
          : null}
        <RentalStationPicker
          label={t(which === "pickup" ? "rental:form.pickupStation" : "rental:form.returnStation")}
          idPrefix={`rental-import-${which}`}
          value={value}
          onChange={onChange}
          inputClassName={INPUT_CLASS}
          error={isPlaced(value) ? null : "rental:import.stationUnplaced"}
        />
      </div>
    );
  };

  return (
    <Modal
      open
      onClose={onCancel}
      busy={saving}
      closeLabel={t("common:buttons.close")}
      title={t(`rental:import.title.${candidate.kind}`)}
      maxWidth={640}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-4 py-2 text-sm"
          >
            {t("rental:form.cancel")}
          </button>
          {!declined && !kmConflict ? (
            <button
              type="button"
              disabled={saving || !stationsReady}
              onClick={() => void save()}
              className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base) disabled:opacity-50"
            >
              {t(`rental:import.action.${candidate.action}`)}
            </button>
          ) : null}
          {kmConflict ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void save(true)}
              className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base)"
            >
              {t("rental:import.useInvoiceKm")}
            </button>
          ) : null}
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          <strong>{candidate.provider}</strong>
          {candidate.confirmationNumber ? (
            <span className="ml-2 font-mono">{candidate.confirmationNumber}</span>
          ) : null}
        </p>
        {declined ? (
          <p role="alert" className="text-(--danger)">
            {t("rental:import.unknownBooking", { number: candidate.confirmationNumber ?? "–" })}
          </p>
        ) : null}
        {candidate.action === "update" ? (
          <p className="t-caption">{t("rental:import.updateNote")}</p>
        ) : null}
        {input ? (
          <>
            {resolutionPicker("pickup", pickup, setPickup)}
            {oneWay ? resolutionPicker("return", ret, setRet) : null}
            <p>
              {t("rental:import.period", {
                pickup: input.pickupLocal.replace("T", " "),
                ret: input.returnLocal.replace("T", " "),
              })}
            </p>
            {input.vehicleExample ? (
              <p>{t("rental:detail.orSimilar", { example: input.vehicleExample })}</p>
            ) : null}
            {input.price != null ? (
              <p className="font-mono">
                {input.price.toFixed(2)} {input.currency}
                {input.paymentTiming ? ` · ${t(`rental:payment.${input.paymentTiming}`)}` : ""}
              </p>
            ) : null}
          </>
        ) : null}
        {candidate.invoice ? (
          <ul className="space-y-1">
            <li>
              {t("rental:import.invoiceKm")}:{" "}
              {candidate.invoice.distanceKm === null
                ? t("rental:list.kmOpen")
                : `${candidate.invoice.distanceKm} km`}
            </li>
            {candidate.invoice.vehicleDriven ? (
              <li>
                {t("rental:detail.vehicleDriven")}: {candidate.invoice.vehicleDriven}
              </li>
            ) : null}
            {candidate.invoice.finalAmount !== null ? (
              <li className="font-mono">
                {t("rental:detail.priceFinal")}: {candidate.invoice.finalAmount.toFixed(2)}{" "}
                {candidate.invoice.finalCurrency}
              </li>
            ) : null}
          </ul>
        ) : null}
        {kmConflict ? (
          <p role="alert" className="text-(--danger)">
            {t("rental:import.kmConflict", { km: candidate.invoice?.distanceKm ?? "–" })}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-(--danger)">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
