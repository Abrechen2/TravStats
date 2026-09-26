import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { airlinesApi } from "../../lib/api/catalogue";
import { ALLIANCE_IDS } from "../../types/loyalty";
import type { AllianceId, AllianceMembers } from "../../types/loyalty";
import { logger } from "../../lib/logger";

/**
 * The most codes one card may carry — the server's `airlineCodes` limit in
 * `backend/src/schemas/loyalty.ts`. Checked here so an alliance that would
 * overflow it is refused with a reason, instead of the save failing later.
 */
export const MAX_AIRLINE_CODES = 50;

interface Props {
  values: string[];
  onChange: (next: string[]) => void;
}

type LoadState =
  { kind: "loading" } | { kind: "ready"; members: AllianceMembers } | { kind: "failed" };

/**
 * One button per alliance that adds all of its full members to a frequent-
 * flyer card at once (forgejo#133). The membership comes from the server —
 * the same list the Alliance All-Star achievement reads — so the page never
 * keeps a copy of its own that could drift.
 */
export default function AlliancePicker({ values, onChange }: Props): JSX.Element | null {
  const { t } = useTranslation(["loyalty"]);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [tooMany, setTooMany] = useState(false);

  useEffect(() => {
    let alive = true;
    airlinesApi
      .alliances()
      .then((members) => {
        if (alive) setState({ kind: "ready", members });
      })
      .catch((err: unknown) => {
        logger.error("AlliancePicker: loading the alliances failed", err);
        if (alive) setState({ kind: "failed" });
      });
    return () => {
      alive = false;
    };
  }, []);

  if (state.kind === "loading") return null;
  if (state.kind === "failed") {
    return (
      <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
        {t("loyalty:alliances.loadError")}
      </p>
    );
  }

  const add = (id: AllianceId): void => {
    const present = new Set(values.map((v) => v.toUpperCase()));
    const missing = state.members[id].filter((code) => !present.has(code));
    if (values.length + missing.length > MAX_AIRLINE_CODES) {
      setTooMany(true);
      return;
    }
    setTooMany(false);
    if (missing.length > 0) onChange([...values, ...missing]);
  };

  return (
    <div className="space-y-1" data-testid="loyalty-alliance-picker">
      <div className="flex flex-wrap items-center gap-2">
        <span className="t-caption">{t("loyalty:alliances.label")}</span>
        {ALLIANCE_IDS.map((id) => {
          const members = state.members[id];
          const complete = members.every((code) => values.includes(code));
          return (
            <button
              key={id}
              type="button"
              className="btn-secondary"
              aria-pressed={complete}
              disabled={complete}
              onClick={() => add(id)}
              title={members.join(", ")}
            >
              {t(`loyalty:alliances.${id}`)}
            </button>
          );
        })}
      </div>
      {tooMany && (
        <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
          {t("loyalty:alliances.tooMany", { max: MAX_AIRLINE_CODES })}
        </p>
      )}
    </div>
  );
}
