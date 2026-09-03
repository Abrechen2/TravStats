import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { countryName } from "../../shared/geo/countryCode";
import type { DataQualityFlag, FlaggedRecord } from "../../types/dataQuality";

import { flaggedRecordPath } from "./flagLinks";

/**
 * The two values a flag holds against each other — both shown, neither marked
 * correct.
 *
 * This is the visual half of "a flag is a question, not a verdict". The two
 * sides get the SAME box, the same weight and the same colour: no
 * strikethrough, no red-to-green arrow, no "correct to". That vocabulary
 * belongs to `PendingUpdateCard`, where a provider really is proposing a
 * replacement value; here the whole point is that nobody knows yet which of the
 * two is right. The known false positive makes it concrete — an address ending
 * "…, Atlanta, Georgia" reads as Georgia the country, and the stored US is the
 * side that is correct.
 *
 * Each kind reads its own `details` directly. `DataQualityFlag` is a
 * discriminated union on `kind` and the server parses the pair through the
 * matching union before it answers, so the pairing is a promise the payload
 * makes — the three runtime guards that used to re-derive it here are gone. The
 * one fallback left is for a `kind` this build does not know, which no type can
 * exclude: a server running a newer check is a real thing.
 */

/** One side of a disagreement. Styling is identical for both sides, by design. */
function Side({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}): JSX.Element {
  return (
    <div
      className="rounded-lg p-3 flex-1 min-w-[150px]"
      style={{ background: "var(--bg-base)", border: "1px solid var(--color-border)" }}
    >
      <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
        {value}
      </div>
      {note && (
        <div className="text-xs mt-1 break-words" style={{ color: "var(--text-muted)" }}>
          {note}
        </div>
      )}
    </div>
  );
}

/** A named record with a link to the page that can edit it (design §3.4). */
export function RecordLink({ record }: { record: FlaggedRecord }): JSX.Element {
  const { t } = useTranslation(["dataQuality"]);

  return (
    <Link
      to={flaggedRecordPath(record)}
      className="text-sm underline"
      style={{ color: "var(--accent)" }}
    >
      {record.label || t("dataQuality:flag.unnamedRecord")}
    </Link>
  );
}

/** A date as stored, in the app's language. Never reformatted into a guess. */
function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
}

/** A country as `code — Localised Name`, falling back to the bare code. */
function countryLabel(code: string | null, locale: string): string {
  if (!code) return "—";
  const name = countryName(code, locale);
  return name ? `${name} (${code.toUpperCase()})` : code.toUpperCase();
}

export default function FlagContradiction({ flag }: { flag: DataQualityFlag }): JSX.Element {
  const { t, i18n } = useTranslation(["dataQuality"]);
  const locale = i18n.language;

  if (flag.kind === "address_country_mismatch") {
    const { claimedCountryCode, claimedCountryText, addressCountryCode, addressCountryText } =
      flag.details;
    return (
      <div className="space-y-3">
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
          {t("dataQuality:kinds.address_country_mismatch.question")}
        </p>
        <div className="flex flex-wrap gap-3">
          <Side
            label={t("dataQuality:kinds.address_country_mismatch.stored")}
            value={countryLabel(claimedCountryCode, locale)}
            note={claimedCountryText ?? undefined}
          />
          <Side
            label={t("dataQuality:kinds.address_country_mismatch.fromAddress")}
            value={countryLabel(addressCountryCode, locale)}
            note={addressCountryText}
          />
        </div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t("dataQuality:kinds.address_country_mismatch.addressLabel")}: {flag.details.address}
        </div>
      </div>
    );
  }

  if (flag.kind === "undated_country_evidence") {
    const { countryCode, records } = flag.details;
    return (
      <div className="space-y-3">
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
          {t("dataQuality:kinds.undated_country_evidence.question", {
            country: countryLabel(countryCode, locale),
          })}
        </p>
        <div className="flex flex-wrap gap-3">
          <Side
            label={t("dataQuality:kinds.undated_country_evidence.dated")}
            value={t("dataQuality:kinds.undated_country_evidence.datedNone")}
          />
          <Side
            label={t("dataQuality:kinds.undated_country_evidence.undated")}
            value={String(records.length)}
          />
        </div>
        {records.length > 0 && (
          <div>
            <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
              {t("dataQuality:kinds.undated_country_evidence.recordsTitle")}
            </div>
            <ul className="space-y-1">
              {records.map((record) => (
                <li key={`${record.entityType}-${record.entityId}`}>
                  <RecordLink record={record} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (flag.kind === "stay_dates_reversed") {
    return (
      <div className="space-y-3">
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
          {t("dataQuality:kinds.stay_dates_reversed.question")}
        </p>
        {flag.details.stays.map((stay) => (
          <div key={stay.stayId} className="flex flex-wrap gap-3">
            <Side
              label={t("dataQuality:kinds.stay_dates_reversed.checkIn")}
              value={formatDate(stay.checkIn, locale)}
            />
            <Side
              label={t("dataQuality:kinds.stay_dates_reversed.checkOut")}
              value={formatDate(stay.checkOut, locale)}
            />
          </div>
        ))}
      </div>
    );
  }

  if (flag.kind === "coordinates_outside_country") {
    const { claimedCountryCode, coordinateCountryCode, lat, lon } = flag.details;
    return (
      <div className="space-y-3">
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
          {t("dataQuality:kinds.coordinates_outside_country.question")}
        </p>
        <div className="flex flex-wrap gap-3">
          <Side
            label={t("dataQuality:kinds.coordinates_outside_country.stored")}
            value={countryLabel(claimedCountryCode, locale)}
          />
          <Side
            label={t("dataQuality:kinds.coordinates_outside_country.fromCoordinates")}
            value={countryLabel(coordinateCountryCode, locale)}
            // The point itself, so the user can judge instead of trusting the
            // verdict. Fixed to five decimals — about a metre, and far more
            // than the boundaries resolve; the stored float would print
            // seventeen digits of false precision.
            note={`${lat.toFixed(5)}, ${lon.toFixed(5)}`}
          />
        </div>
      </div>
    );
  }

  // A `kind` this build has no rendering for — a server running a check newer
  // than this bundle. The one thing the discriminated union cannot rule out, so
  // it is the one fallback left. Saying so is honest and keeps the two answer
  // buttons reachable: the user can still dismiss it.
  return (
    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
      {t("dataQuality:flag.unreadable")}
    </p>
  );
}
