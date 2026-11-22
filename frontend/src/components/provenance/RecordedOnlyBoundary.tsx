import { useLayoutEffect, useState, type ReactNode } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { setRecordedOnly } from "../../lib/stats/recordedOnly";

/**
 * The statistics page's "Nur belegte" switch. It wraps the whole page and re-mounts it when
 * flipped, so every figure — whichever card or hook fetched it — is read again under the same
 * filter and there are never two populations on one screen. The switch is held only while the
 * page is mounted (`lib/stats/recordedOnly.ts`).
 */
export default function RecordedOnlyBoundary({ children }: { children: ReactNode }): JSX.Element {
  const { t } = useTranslation(["provenance"]);
  const [on, setOn] = useState(false);

  // Layout effects of the whole tree run before any child's passive (fetching) effect.
  useLayoutEffect(() => {
    setRecordedOnly(on);
    return () => setRecordedOnly(false);
  }, [on]);

  return (
    <>
      <div
        className="flex justify-end"
        style={{ padding: "var(--ts-space-sm) var(--ts-space-lg) 0" }}
      >
        <label
          className="flex items-center gap-2 text-sm"
          title={t("provenance:stats.onlyRecordedHint")}
        >
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          {t("provenance:stats.onlyRecorded")}
        </label>
      </div>
      <div key={on ? "recorded" : "all"}>{children}</div>
    </>
  );
}
