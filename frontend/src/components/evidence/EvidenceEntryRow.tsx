import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import type { Aggregation, EvidenceEntry } from "../../shared/evidence";
import { composeI18nText, formatEvidenceDate } from "./evidenceText";
import { countryName } from "../Passport/countryName";

/** The `measure.unit` whose credits are ISO 3166-1 alpha-2 country codes. */
const COUNTRY_UNIT = "countries";
const ISO_COUNTRY_CODE = /^[A-Z]{2}$/;

interface EvidenceEntryRowProps {
  entry: EvidenceEntry;
  /**
   * Decides whether `contribution` or `credits` is the row's own evidence —
   * read from `measure.aggregation`, not from which field happens to be set
   * (design, "`contribution` vs `credits`"): release 2's kinds carry neither,
   * and a presence check would silently render nothing for them instead of a
   * decision this component owns.
   */
  aggregation: Aggregation;
  /**
   * `measure.unit` — says what a credit key IS. Only a country measure's keys
   * are country codes; an airline measure credits "BA", which is British
   * Airways and not Bosnia.
   */
  unit: string;
}

/**
 * One row: title, subtitle, date, what it contributes, link.
 *
 * The link targets `entry.href`, never `entry.id` — the two differ on
 * purpose for a lodging stay (its `id` names the STAY, its `href` opens the
 * LODGING) and for a country proved by two port calls of one cruise (two
 * `id`s share one `href`). `href` can be `null` (a country proved by a
 * lodging with no stay at all); the row then renders unlinked rather than
 * pointing nowhere.
 */
export default function EvidenceEntryRow({
  entry,
  aggregation,
  unit,
}: EvidenceEntryRowProps): JSX.Element {
  const { t, i18n } = useTranslation(["evidence"]);

  const title = composeI18nText(entry.title, t);
  const subtitle = entry.subtitle ? composeI18nText(entry.subtitle, t) : null;
  const dateText = formatEvidenceDate(entry.date, i18n.language);

  // `sum` renders the raw contribution ("trägt 2 bei"); `distinct` renders the
  // units it witnesses ("belegt: DE, FR") — the same row can never carry both,
  // but the two sentences say different things and must not share a phrase.
  const contributionText =
    aggregation === "sum" && entry.contribution !== undefined
      ? t("evidence:entry.contribution", { value: roundForDisplay(entry.contribution) })
      : null;
  // A credit is an IDENTITY key — that is what makes two rows witnessing the
  // same unit count once — and for an entity-keyed measure it is a UUID. What
  // the reader needs is its name, so the row prints `creditLabels[key]` where
  // the backend supplied one. A country code is the exception among the keys
  // that are already words ("MUC", "Europe"): the server never names a country
  // (the name belongs to the reader's language), so "DE" printed raw beside
  // "Hotel Sport" — the client names it, through the passport's own helper.
  const creditName = (key: string): string =>
    entry.creditLabels?.[key] ??
    (unit === COUNTRY_UNIT && ISO_COUNTRY_CODE.test(key) ? countryName(key, i18n.language) : key);
  const creditsText =
    aggregation === "distinct" && entry.credits
      ? t("evidence:entry.credits", { list: entry.credits.map(creditName).join(", ") })
      : null;

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>
          {title}
        </span>
        <span className="shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
          {dateText ?? t("evidence:entry.undated")}
        </span>
      </div>
      {subtitle && (
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          {subtitle}
        </div>
      )}
      {(contributionText ?? creditsText) && (
        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {contributionText ?? creditsText}
        </div>
      )}
    </>
  );

  return (
    <li className="py-2" style={{ borderBottom: "1px solid var(--ts-border)" }}>
      {entry.href ? (
        <Link to={entry.href} className="block hover:underline">
          {body}
        </Link>
      ) : (
        <div>{body}</div>
      )}
    </li>
  );
}

/** Contributions are stored RAW and unrounded (design, "The contract"); the display is not the arithmetic. */
function roundForDisplay(value: number): number {
  return Math.round(value * 100) / 100;
}
