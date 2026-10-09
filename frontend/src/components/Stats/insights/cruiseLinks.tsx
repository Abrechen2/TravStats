import type { JSX } from "react";
import { Link } from "react-router-dom";

import type { CruiseRef } from "../../../types/cruiseInsights";

/** A cruise by the user's own name, linked to its page — the evidence of a single voyage. */
export function CruiseLink({ cruise }: { cruise: CruiseRef }): JSX.Element {
  return (
    <Link to={`/cruises/${cruise.id}`} className="underline">
      {cruise.label}
    </Link>
  );
}

/** Several cruises, comma-separated, each linked. */
export function CruiseLinks({ cruises }: { cruises: readonly CruiseRef[] }): JSX.Element {
  return (
    <>
      {cruises.map((c, i) => (
        <span key={c.id}>
          {i > 0 && ", "}
          <CruiseLink cruise={c} />
        </span>
      ))}
    </>
  );
}
