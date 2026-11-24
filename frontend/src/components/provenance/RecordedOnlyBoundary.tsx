import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

import HelpIcon from "../Help/HelpIcon";
import { useTranslation } from "../../hooks/useTranslation";
import { setRecordedOnly } from "../../lib/stats/recordedOnly";

/**
 * The statistics page's "Nur belegte" switch. It wraps the whole page and re-mounts it when
 * flipped, so every figure — whichever card or hook fetched it — is read again under the same
 * filter and there are never two populations on one screen. The switch is held only while the
 * page is mounted (`lib/stats/recordedOnly.ts`).
 *
 * The boundary holds the state; the CONTROL is `RecordedOnlyToggle`, drawn by the page in its own
 * toolbar. Drawn by the boundary itself it sat above the app header, outside the page (UAT rc.45).
 */
const RecordedOnlyContext = createContext<{ on: boolean; setOn: (on: boolean) => void } | null>(
  null
);

export default function RecordedOnlyBoundary({ children }: { children: ReactNode }): JSX.Element {
  const [on, setOn] = useState(false);

  // Layout effects of the whole tree run before any child's passive (fetching) effect.
  useLayoutEffect(() => {
    setRecordedOnly(on);
    return () => setRecordedOnly(false);
  }, [on]);

  return (
    <RecordedOnlyContext.Provider value={{ on, setOn }}>
      <div key={on ? "recorded" : "all"}>{children}</div>
    </RecordedOnlyContext.Provider>
  );
}

/** The "Nur belegte" checkbox; nothing outside a `RecordedOnlyBoundary`. */
export function RecordedOnlyToggle(): JSX.Element | null {
  const { t } = useTranslation(["provenance"]);
  const state = useContext(RecordedOnlyContext);
  if (!state) return null;
  return (
    <div className="flex items-center" data-testid="recorded-only-toggle">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={state.on} onChange={(e) => state.setOn(e.target.checked)} />
        {t("provenance:stats.onlyRecorded")}
      </label>
      <HelpIcon
        content={t("provenance:stats.onlyRecordedHint")}
        subject={t("provenance:stats.onlyRecorded")}
        className="ml-1"
      />
    </div>
  );
}
