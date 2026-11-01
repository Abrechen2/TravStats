import { useEffect, useRef, useState } from "react";
import { Button, Input } from "../../../components/ui";
import { useTranslation } from "../../../hooks/useTranslation";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { apiErrorMachineCode } from "../../../lib/apiError";
import {
  travplanApi,
  type PlaceHit,
  type PlaceSearch,
  type PlanPlace,
} from "../../../lib/api/travplan";
import { PlanNotice } from "../planLayout";

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

/**
 * One place picker for destination, stations and night candidates (spec §5.6).
 *
 * It offers the real entities - the account's own places, ports, geocoder hits - and a pick hands
 * back the whole place: name, coordinates, country and zone. A source that cannot answer is NAMED,
 * so "no hits" never hides a geocoder that was down; the other sources still show.
 */
export function PlacePicker({
  onPick,
  label,
  kind = "any",
  autoFocus = false,
}: {
  onPick: (place: PlanPlace) => void;
  label: string;
  kind?: "any" | "port";
  autoFocus?: boolean;
}) {
  const { t, i18n } = useTranslation("travplan"),
    coarse = useCoarsePointer(),
    [q, setQ] = useState(""),
    [result, setResult] = useState<PlaceSearch | null>(null),
    [failure, setFailure] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    generation = useRef(0);
  const language = i18n?.language?.startsWith("en") ? "en" : "de";
  useEffect(() => {
    const term = q.trim();
    const run = ++generation.current;
    if (term.length < MIN_CHARS) {
      setResult(null);
      setFailure(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      travplanApi
        .places(term, language, kind)
        .then((found) => {
          if (run !== generation.current) return;
          setResult(found);
          setFailure(null);
        })
        .catch((cause: unknown) => {
          if (run !== generation.current) return;
          setResult(null);
          setFailure(apiErrorMachineCode(cause) ?? "unknown");
        })
        .finally(() => {
          if (run === generation.current) setBusy(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, language, kind]);
  const reason = (code: string) => t("errors." + code, { defaultValue: t("errors.unknown") });
  const pick = (hit: PlaceHit) => {
    onPick(hit.place);
    setQ("");
    setResult(null);
  };
  return (
    <div className="flex min-w-0 flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <Input
        aria-label={label}
        placeholder={label}
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
      />
      {busy && <p className="t-caption">{t("route.search.searching")}</p>}
      {failure && (
        <PlanNotice tone="bad">{t("route.search.failed", { reason: reason(failure) })}</PlanNotice>
      )}
      {result?.unavailable.map((u) => (
        <PlanNotice key={u.source}>
          {t("route.search.unavailable", {
            source: t("route.search.source." + u.source),
            reason: reason(u.code),
          })}
        </PlanNotice>
      ))}
      {result && !result.places.length && !result.unavailable.length && !busy && (
        <p className="t-caption">{t("route.search.none")}</p>
      )}
      {result?.places.map((hit) => (
        <Button
          key={hit.source + (hit.place.ref?.id ?? hit.place.name)}
          block
          style={{
            justifyContent: "space-between",
            textAlign: "left",
            minHeight: coarse ? "var(--ts-size-touch-min)" : undefined,
          }}
          onClick={() => pick(hit)}
        >
          <span className="min-w-0" style={{ overflowWrap: "anywhere" }}>
            {hit.place.name}
            <span className="t-caption" style={{ display: "block", fontWeight: 400 }}>
              {[
                hit.place.country,
                hit.place.zone,
                t("route.search.source." + hit.source),
                hit.visits ? t("route.search.visits", { count: hit.visits }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </Button>
      ))}
    </div>
  );
}
