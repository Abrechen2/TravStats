import { useEffect, useState } from "react";
import {
  getOperatorMark,
  operatorLogoPath,
  type OperatorMarkCredit,
} from "../../../../lib/api/operators";
import type { JourneyDomain } from "./journeyTypes";

export interface OperatorLogo {
  url: string;
  /** Present for a Commons logo, which the card must credit; null for a company's own icon. */
  credit: OperatorMarkCredit | null;
}

/**
 * The logo of a journey's operator, once the server has said there is one
 * (forgejo#323) — the vendored rail and rental catalogues, else Wikidata /
 * Commons. Null until then and for good on a miss: the card draws the
 * monogram, never a broken image. A trip's airline has its own logo chain and
 * no name-keyed one, so a flight asks nothing here.
 */
export function useOperatorLogo(
  domain: JourneyDomain | "cruise",
  name: string
): OperatorLogo | null {
  const [logo, setLogo] = useState<OperatorLogo | null>(null);
  useEffect(() => {
    setLogo(null);
    if (domain === "flight" || name.trim() === "") return;
    let cancelled = false;
    void getOperatorMark(domain, name).then((mark) => {
      if (cancelled || !mark.available) return;
      setLogo({ url: operatorLogoPath(domain, name), credit: mark.credit });
    });
    return () => {
      cancelled = true;
    };
  }, [domain, name]);
  return logo;
}
