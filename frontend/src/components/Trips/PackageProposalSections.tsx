import { useState } from "react";
import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatCurrency } from "../../lib/units";
import type {
  PackageEndpoint,
  PackageEntityAction,
  PackageProposal,
  PackageProposalFlight,
  PackageProposalReason,
} from "../../lib/api/tripPackage";

/**
 * The rows of a package-tour proposal: one line per entity with the badge
 * saying what the commit will do, and — for a leg whose airport the catalogue
 * could not name — the control that lets the reviewer name it. A pick carries
 * its code back to the server, which re-runs the proposal with it.
 */

const BADGE: Record<PackageEntityAction, string> = {
  create: "border border-(--ts-good) text-(--ts-good)",
  attach: "bg-(--accent-soft) text-(--accent)",
  skip: "border border-(--color-border) text-(--text-muted)",
};

export function ActionBadge({
  action,
  reason,
}: {
  action: PackageEntityAction;
  reason?: PackageProposalReason;
}): JSX.Element {
  const { t } = useTranslation(["import"]);
  return (
    <span
      className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${BADGE[action]}`}
      data-testid="package-action"
    >
      {t(`import:package.action.${action}`)}
      {reason ? ` · ${t(`import:package.reason.${reason}`)}` : ""}
    </span>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="mt-4">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-(--text-muted)">
        {title}
      </h3>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function endpointLabel(end: PackageEndpoint): string {
  if (end.iata && end.city) return `${end.city} (${end.iata})`;
  return end.iata ?? end.city ?? "?";
}

interface AirportPickerProps {
  end: PackageEndpoint;
  onPick: (city: string, iata: string) => void;
}

/** Candidates as choices when the catalogue offered some; a code field when it offered none. */
function AirportPicker({ end, onPick }: AirportPickerProps): JSX.Element | null {
  const { t } = useTranslation(["import"]);
  const [code, setCode] = useState("");
  const city = end.city;
  if (!city || (end.status !== "ambiguous" && end.status !== "unknown")) return null;
  if (end.candidates && end.candidates.length > 0) {
    return (
      <label className="mt-1 flex items-center gap-2 text-sm">
        <span>{t("import:package.airport.pick", { city })}</span>
        <select
          className="input"
          defaultValue=""
          onChange={(e) => e.target.value && onPick(city, e.target.value)}
        >
          <option value="">{t("import:package.airport.pickPlaceholder")}</option>
          {end.candidates.map((c) => (
            <option key={c.iata} value={c.iata}>
              {c.iata} — {c.name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const valid = /^[A-Za-z]{3}$/.test(code);
  return (
    <div className="mt-1 flex items-center gap-2 text-sm">
      <label className="flex items-center gap-2">
        <span>{t("import:package.airport.code", { city })}</span>
        <input
          className="input w-20 uppercase"
          maxLength={3}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn-secondary"
        disabled={!valid}
        onClick={() => onPick(city, code.toUpperCase())}
      >
        {t("import:package.airport.apply")}
      </button>
    </div>
  );
}

function FlightRow({
  flight,
  onPickAirport,
}: {
  flight: PackageProposalFlight;
  onPickAirport: (city: string, iata: string) => void;
}): JSX.Element {
  const times = [flight.depTime, flight.arrTime].filter(Boolean).join("–");
  const offset = flight.arrDayOffset > 0 ? ` +${flight.arrDayOffset}` : "";
  return (
    <li className="rounded border border-(--color-border) p-2" data-testid="package-flight">
      <div className="flex items-center justify-between gap-2">
        <span>
          <strong>{flight.flightNumber}</strong> {endpointLabel(flight.departure)} →{" "}
          {endpointLabel(flight.arrival)} · {flight.date} {times}
          {offset}
        </span>
        <ActionBadge action={flight.action} reason={flight.reason} />
      </div>
      <AirportPicker end={flight.departure} onPick={onPickAirport} />
      <AirportPicker end={flight.arrival} onPick={onPickAirport} />
    </li>
  );
}

export function ProposalBody({
  proposal,
  tripName,
  onTripName,
  onPickAirport,
}: {
  proposal: PackageProposal;
  tripName: string;
  onTripName: (name: string) => void;
  onPickAirport: (city: string, iata: string) => void;
}): JSX.Element {
  const { t } = useTranslation(["import"]);
  const { trip, booking } = proposal;
  const money = (price: number | null, currency: string | null): string | null =>
    price !== null && currency ? formatCurrency(price, currency) : null;
  const price = money(booking.price, booking.currency);
  const stored = booking.storedPrice
    ? money(booking.storedPrice.price, booking.storedPrice.currency)
    : null;

  return (
    <>
      <Section title={t("import:package.sections.trip")}>
        <li className="rounded border border-(--color-border) p-2">
          <div className="flex items-center justify-between gap-2">
            <span>{t(`import:package.tripAction.${trip.action}`)}</span>
            <ActionBadge action={trip.action} />
          </div>
          {trip.action === "create" ? (
            <label className="mt-2 flex flex-col gap-1 text-sm">
              <span>{t("import:package.tripName")}</span>
              <input
                className="input"
                value={tripName}
                maxLength={200}
                onChange={(e) => onTripName(e.target.value)}
              />
            </label>
          ) : (
            <p className="mt-1 text-sm">
              <strong>{trip.name}</strong>
              {trip.matchedBy ? ` — ${t(`import:package.matchedBy.${trip.matchedBy}`)}` : ""}
            </p>
          )}
          {trip.startDate && (
            <p className="mt-1 text-sm text-(--text-muted)">
              {trip.startDate} – {trip.endDate ?? trip.startDate}
            </p>
          )}
        </li>
      </Section>

      <Section title={t("import:package.sections.booking")}>
        <li className="rounded border border-(--color-border) p-2">
          <div className="flex items-center justify-between gap-2">
            <span>{t("import:package.reference", { reference: booking.reference })}</span>
            <ActionBadge action={booking.action} />
          </div>
          <p className="mt-1 text-sm">
            {price ? t("import:package.price", { price }) : t("import:package.noPrice")}
          </p>
          {stored && (
            <p className="mt-1 text-sm text-(--ts-warn)">
              {t("import:package.storedPrice", { price: stored })}
            </p>
          )}
        </li>
      </Section>

      {proposal.flights.length > 0 && (
        <Section title={t("import:package.sections.flights")}>
          {proposal.flights.map((f) => (
            <FlightRow key={f.index} flight={f} onPickAirport={onPickAirport} />
          ))}
        </Section>
      )}

      {proposal.stays.length > 0 && (
        <Section title={t("import:package.sections.stays")}>
          {proposal.stays.map((s) => (
            <li
              key={s.index}
              className="flex items-center justify-between gap-2 rounded border border-(--color-border) p-2"
              data-testid="package-stay"
            >
              <span>
                <strong>{s.name}</strong>
                {s.city ? `, ${s.city}` : ""} · {s.checkIn} – {s.checkOut}
                {s.lodging.action === "reuse" ? ` · ${t("import:package.lodgingReuse")}` : ""}
              </span>
              <ActionBadge action={s.action} reason={s.reason} />
            </li>
          ))}
        </Section>
      )}

      {proposal.cruise && (
        <Section title={t("import:package.sections.cruise")}>
          <li className="flex items-center justify-between gap-2 rounded border border-(--color-border) p-2">
            <span>
              <strong>{proposal.cruise.ship ?? "?"}</strong>{" "}
              {[proposal.cruise.from, proposal.cruise.to].filter(Boolean).join(" – ")}
            </span>
            <ActionBadge action={proposal.cruise.action} reason={proposal.cruise.reason} />
          </li>
        </Section>
      )}

      {proposal.document && (
        <Section title={t("import:package.sections.document")}>
          <li className="text-sm">
            {t(
              `import:package.document.${
                proposal.document.action === "file"
                  ? "file"
                  : (proposal.document.reason ?? "filedElsewhere")
              }`
            )}
          </li>
        </Section>
      )}

      {proposal.warnings.length > 0 && (
        <Section title={t("import:package.sections.warnings")}>
          {proposal.warnings.map((w, i) => (
            <li key={`${w.code}-${i}`} className="text-sm text-(--ts-warn)" role="status">
              {t(`import:package.warning.${w.code}`, { subject: w.subject })}
            </li>
          ))}
        </Section>
      )}
    </>
  );
}
