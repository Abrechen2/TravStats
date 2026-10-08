import { Fragment } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { formatRailSpan } from "../../lib/railTime";
import { railTransfers } from "../../lib/rail/railTransfer";
import type { RailBookingLeg } from "../../types/rail";
import { RailTransferNote } from "./RailTransferNote";

interface Props {
  currentId: string;
  legs: readonly RailBookingLeg[];
  pnr: string | null;
}

/**
 * The legs of one booking, in departure order — a connection read as what it
 * is: several rides whose stations meet. The leg on screen is marked, the
 * others link to their own page. Times are on each station's clock. Between
 * two legs: the change, read by `railTransfers` (forgejo#234).
 */
export function RailConnectionLegs({ currentId, legs, pnr }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["rail"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const transfers = railTransfers(legs);
  return (
    <div className="flex flex-col gap-2">
      {pnr && <p className="t-caption">{t("rail:connection.booking", { pnr })}</p>}
      <ol className="flex flex-col gap-1" data-testid="rail-connection-legs">
        {legs.map((leg, index) => {
          const train = [leg.trainCategory, leg.trainNumber].filter(Boolean).join(" ");
          const when = formatRailSpan(leg, locale);
          const label = `${index + 1}. ${leg.depStationName} → ${leg.arrStationName}`;
          return (
            <Fragment key={leg.id}>
              {index > 0 && (
                <RailTransferNote
                  transfer={transfers[index - 1]}
                  arriving={legs[index - 1]}
                  departing={leg}
                  index={index}
                />
              )}
              <li className="text-sm">
                {leg.id === currentId ? (
                  <strong aria-current="page">{label}</strong>
                ) : (
                  <Link to={`/rail/${leg.id}`} className="underline">
                    {label}
                  </Link>
                )}
                <span className="t-caption"> · {[when, train].filter(Boolean).join(" · ")}</span>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
