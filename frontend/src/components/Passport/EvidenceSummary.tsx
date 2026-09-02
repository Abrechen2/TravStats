import { useTranslation } from "../../hooks/useTranslation";
import type { Passport } from "../../types/passport";
import TierBadge from "./TierBadge";

/**
 * Why the headline is the number it is.
 *
 * `countries` and `countriesTotal` differ on purpose, and a reader who sees 40
 * must be able to find out that 43 countries have evidence and that the other
 * three are connections. Left unexplained, the gap looks like a bug — which is
 * how the old number came to be trusted while it was wrong in both directions.
 *
 * The threshold is NAMED rather than implied. It is a rule, and a rule the
 * reader did not choose should at least be legible.
 *
 * ## Three tiers, and no fourth
 *
 * The band lists exactly the tiers the data can produce. The design plans a
 * `transited` rung for a border crossed by road; nothing in a flight, a cruise
 * or a hotel records one, so until GPS tracks arrive no record can carry it. It
 * is not shown, because a category that is permanently zero is indistinguishable
 * from a category that is broken.
 *
 * ## No hour buckets
 *
 * Measured on the owner's account the connection countries run 1.4 h to 4.7 h
 * and the next country is 25 h. Fixed bins ("1 h / 3 h / <10 h") would sit
 * permanently empty in the middle and hide the gap, which is the finding. The
 * server publishes no per-country ground time at all today, so none is shown —
 * an invented figure would be worse than the absent one.
 */
export default function EvidenceSummary({
  summary,
}: {
  summary: Passport["summary"];
}): JSX.Element {
  const { t } = useTranslation(["passport"]);

  const tiers = [
    { tier: "slept" as const, count: summary.byTier.slept },
    { tier: "visited" as const, count: summary.byTier.visited },
    { tier: "transit" as const, count: summary.byTier.transit },
  ];

  const kinds = [
    { kind: "flight" as const, count: summary.byEvidence.flight },
    { kind: "port" as const, count: summary.byEvidence.port },
    { kind: "place" as const, count: summary.byEvidence.place },
    { kind: "lodging" as const, count: summary.byEvidence.lodging },
  ];

  return (
    <div
      className="rounded-lg border p-4 mb-6"
      style={{ borderColor: "var(--border)" }}
      aria-labelledby="evidence-heading"
    >
      <h2
        id="evidence-heading"
        className="text-[11px] uppercase tracking-wider mb-2"
        style={{ color: "var(--text-muted)" }}
      >
        {t("passport:evidence.title")}
      </h2>

      {/* The headline, the total and the rule between them, in one sentence. */}
      <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
        {t("passport:evidence.headlineNote", {
          counted: summary.countries,
          total: summary.countriesTotal,
          threshold: t(`passport:tiers.${summary.countryThreshold}`),
        })}
      </p>

      <ul className="flex flex-wrap gap-x-4 gap-y-2 mb-3">
        {tiers.map(({ tier, count }) => (
          <li key={tier} className="flex items-center gap-1.5">
            <TierBadge tier={tier} />
            <span className="text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
              {count}
            </span>
          </li>
        ))}
      </ul>

      {/* What KIND of record proved each country — the split line the Companion
          already showed ("31 geflogen · 5 per hafen · 2 anders erreicht"). It
          sums to the TOTAL, never to the headline, and says so. */}
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {kinds.map(({ kind, count }) => `${count} ${t(`passport:kinds.${kind}`)}`).join(" · ")}
        {" — "}
        {t("passport:evidence.kindsSumNote")}
      </p>
    </div>
  );
}
