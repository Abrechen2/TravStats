import { useState } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { PassportCountry } from "../../types/passport";
import CountryProvenance from "./CountryProvenance";
import GroundTimeCell from "./GroundTimeCell";
import TierBadge from "./TierBadge";

/**
 * One country in the passport table.
 *
 * ## A country that does not reach the threshold is GREYED, never hidden
 *
 * `counted: false` exists precisely so a row stays visible. The tier is
 * inferred from records, and records are incomplete: Ethiopia shows 4.7 hours
 * of ground time in TravStats and three GPS-measured days in an independent
 * tracker. Dropping the row would delete the only place a reader could notice
 * that and fix it, which is the opposite of what the rework is for.
 *
 * ## Zero is not a synonym for unknown
 *
 * A country proved only by a hotel has flown nothing and used no airport. Its
 * entry count is not zero, it is NOT APPLICABLE, and its period is not 1970, it
 * is UNKNOWN — three states, not two. `Abstention is a result`: a value that
 * cannot be derived is absent, never zero. Writing `0` in those cells is the
 * fabrication this row exists to avoid, and it is what the table did before.
 *
 * The abstention keys on `kinds`, not on the number itself: a country with no
 * flight among its evidence has no entries to count, and that is a different
 * statement from "we counted the flights and there were none".
 *
 * ## …and the two figures beside the tier obey the SAME rule in opposite ways
 *
 * `groundTime` may abstain, and does so in two distinguishable ways — see
 * `GroundTimeCell`. `daysPresent` may NOT: it is derived, so `0` means the
 * server counted the days a record named and found none, which
 * `hasUndatedEvidence` states in words on the same row. Printing a dash there
 * would claim an abstention that did not happen, which is the same class of
 * error as printing a zero for something unmeasured — just pointing the other
 * way. Neither figure ever decides the tier; both stand beside it so a reader
 * can judge it instead of trusting it (spec §3.4b).
 */

const period = (from: number | null, to: number | null): string | null => {
  if (from === null) return null;
  return from === to ? String(from) : `${from}–${to}`;
};

export default function CountryRow({
  row,
  countryLabel,
}: {
  row: PassportCountry;
  countryLabel: string;
}): JSX.Element {
  const { t } = useTranslation(["passport"]);
  const [open, setOpen] = useState(false);

  const flown = row.kinds.includes("flight");
  const years = period(row.firstYear, row.lastYear);

  // Greyed, not removed. The muted colour is inherited by every cell, and the
  // badge below says WHY in words — colour alone would be no explanation at all.
  const rowStyle = row.counted
    ? { borderColor: "var(--border)" }
    : { borderColor: "var(--border)", color: "var(--text-muted)" };

  return (
    <>
      <tr className="border-t" style={rowStyle} data-counted={row.counted ? "true" : "false"}>
        <td className="px-6 py-2.5">
          <span className="font-mono text-xs mr-2 opacity-70">{row.code}</span>
          {countryLabel}
          {row.isHome && (
            <span
              className="ml-2 text-[10px] uppercase tracking-wide"
              style={{ color: "var(--text-muted)" }}
            >
              {t("passport:countries.home")}
            </span>
          )}
          {row.isNew && (
            <span
              className="ml-2 text-[10px] uppercase tracking-wide"
              style={{ color: "var(--accent)" }}
            >
              {t("passport:countries.new")}
            </span>
          )}
        </td>

        <td className="px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <TierBadge tier={row.tier} />
            {!row.counted && (
              <span
                className="text-[10px] uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
                title={t("passport:countries.notCountedExplained")}
              >
                {t("passport:countries.notCounted")}
              </span>
            )}
            {/* A country that can never appear in any year's figures is a fact
                about the data, not a hole in it. Saying so beats a blank. */}
            {row.hasUndatedEvidence && (
              <span
                className="text-[10px] uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
                title={t("passport:countries.undatedExplained")}
              >
                {t("passport:countries.undated")}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {row.kinds.map((kind) => t(`passport:kinds.${kind}`)).join(" · ")}
            </span>
            <button
              type="button"
              onClick={(): void => setOpen((v) => !v)}
              aria-expanded={open}
              className="text-[11px] underline print:hidden"
              style={{ color: "var(--accent)" }}
            >
              {t(open ? "passport:countries.hideRecords" : "passport:countries.showRecords")}
            </button>
          </div>
        </td>

        <td className="px-3 py-2.5 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
          {flown ? (
            row.entries
          ) : (
            <span title={t("passport:value.notApplicableEntries")}>{t("passport:value.dash")}</span>
          )}
        </td>

        {/* Days present — a plain count, zero included. See the file comment. */}
        <td className="px-3 py-2.5 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
          <span
            data-testid="days-present"
            title={
              row.daysPresent === 0
                ? t("passport:value.noDatedDays")
                : t("passport:value.daysPresentExplained")
            }
          >
            {row.daysPresent}
          </span>
        </td>

        {/* Ground time — three states, and never a dash for the actionable one. */}
        <td
          className="px-3 py-2.5 text-right whitespace-nowrap"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          <GroundTimeCell groundTime={row.groundTime} />
        </td>

        <td
          className="px-3 py-2.5 whitespace-nowrap"
          style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}
        >
          {years ?? (
            <span title={t("passport:value.unknownPeriod")}>{t("passport:value.dash")}</span>
          )}
        </td>

        <td className="px-6 py-2.5 font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
          {row.airports.length > 0 ? (
            row.airports.join(" · ")
          ) : (
            <span title={t("passport:value.notApplicableAirports")}>
              {t("passport:value.dash")}
            </span>
          )}
        </td>
      </tr>

      {open && (
        <tr className="border-t" style={{ borderColor: "var(--border)" }}>
          <td colSpan={7} className="px-6 py-3" style={{ background: "var(--bg-base)" }}>
            <CountryProvenance code={row.code} />
          </td>
        </tr>
      )}
    </>
  );
}
